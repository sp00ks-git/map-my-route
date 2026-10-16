// The route planner: a MapLibre GL map you draw on. Built on MapLibre (not
// Leaflet) so two-finger rotation/pinch work natively.
//
// The core idea, and the reason drawing is reliable: a finger-DRAWN stroke is
// turned into a route entirely CLIENT-SIDE, by tracing along the real road
// network geometry (fetched once from OpenStreetMap via Overpass) between the
// points the finger snapped to -- see waytype.buildTraceGeometry. No routing
// engine is involved for a drawn stroke, on purpose: a routing/map-matching
// engine fills the gaps between points with its own pathfinding, and that
// gap-filling is exactly what makes a drawn line wander onto a neighbouring
// road, detour into a cul-de-sac, or loop. Tracing the actual road vertices
// the finger crossed structurally cannot do that.
//
// Tap-to-tap legs (tap a point, tap another) DO use real routing (OSRM) --
// there "find me the way from A to B" is the correct behaviour.

import { getRoute, matchGesture } from "./routing.js?v=1.2.8";
import { getOrsKey, PROFILE_LABELS, getProfileColor } from "./config.js?v=1.2.8";
import { fetchWaysInBbox, snapToNearestWay, bboxFromMapBounds, buildTraceGeometry, pathLengthM, findNetworkPath } from "./waytype.js?v=1.2.8";

// Keep drawing available from a country view down to street level. At low
// zooms the vector tiles contain fewer minor roads, so release-time matching
// uses the full gesture with the routing graph rather than refusing the draw.
const MIN_SNAP_ZOOM = 3;

// A new stroke that starts away from the end of the route so far is JOINED on
// along the road network (see Planner._bridgeFromRouteEnd). Gaps beyond this
// are left as a straight join; the detour allowance stops a wild "shortest
// path" around a block being drawn for what was really a short hop.
const MAX_BRIDGE_M = 400;
const MIN_BRIDGE_M = 1.5;
const MAX_NETWORK_CACHE = 8000;

// Rough travel speeds (m/s) for estimating a drawn route's duration, since a
// client-side trace has no routing engine to report one.
const PROFILE_SPEED_MPS = {
  "driving-car": 12.5,
  "foot-walking": 1.35,
  "foot-hiking": 1.2,
  "cycling-regular": 4.5,
  "dog-walking": 1.2,
};

/** Does bbox `outer` ([s,w,n,e]) fully cover bbox `inner`? */
function boundsContain(outer, inner) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

// "Bright" is OpenFreeMap's Google-Maps-like style: warm cream land, white
// streets, yellow/orange arterials, building footprints and road name labels
// at street level. Free, keyless, no rate limits.
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/bright";

function visibleRoadType(properties = {}) {
  const roadClass = properties.class;
  if (roadClass === "path" || roadClass === "pedestrian") return 7;
  if (roadClass === "track") return 5;
  if (roadClass === "cycleway") return 6;
  if (["motorway", "trunk", "primary"].includes(roadClass)) return 1;
  if (["secondary", "tertiary"].includes(roadClass)) return 2;
  return 3;
}

function toLineString(points, properties = {}) {
  return { type: "Feature", properties, geometry: { type: "LineString", coordinates: points.map(([lat, lng]) => [lng, lat]) } };
}
function emptyFC() {
  return { type: "FeatureCollection", features: [] };
}

function markerElement(dotSize, color) {
  const el = document.createElement("div");
  el.style.cssText = `width:44px;height:44px;display:flex;align-items:center;justify-content:center;pointer-events:none;`;
  el.innerHTML = `<div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 2px rgba(0,0,0,.3)"></div>`;
  return el;
}

export class Planner {
  constructor(containerId, { onRouteChange, onRouteError, onBusyChange }) {
    this.onRouteChange = onRouteChange;
    this.onRouteError = onRouteError;
    this.onBusyChange = onBusyChange || (() => {});

    // The route is an ordered list of legs; each leg has coords ([[lat,lng]]).
    // kind 'trace' = finger-drawn (client-traced), 'route' = tap-to-tap
    // (OSRM), 'loaded' = restored from a shared link. Plus an optional single
    // tapped start point that has no leg yet.
    this.legs = [];
    this.pendingStart = null;
    this.waypoints = []; // [start] or [start, end] -- lightweight, for markers/share/main.js

    this.profile = "driving-car";
    this.markers = [];
    this.lastResult = null;
    this.routeToken = 0; // guards async tap-routing / profile re-routing
    this.drawMode = false;

    this.map = new maplibregl.Map({
      container: containerId,
      // OpenFreeMap is the single authoritative vector basemap. The same
      // visible road geometry is used by the gesture snapper below.
      style: OPENFREEMAP_STYLE,
      center: [-1.5, 52.5],
      zoom: 6,
      attributionControl: true,
      touchZoomRotate: true,
      dragRotate: true,
      pitchWithRotate: false,
      touchPitch: false,
      preserveDrawingBuffer: true, // so the screenshot button can read the canvas
    });
    this.map.touchZoomRotate.enableRotation();

    if (this.map.loaded()) this._onLoad();
    else this.map.once("load", () => this._onLoad());
  }

  _onLoad() {
    this._setupLayers();
    this._wireDrawing();

    this._roadWays = [];
    this._roadNetworkBbox = null;
    this._roadNetworkPromise = null;
    let moveendTimer = null;
    this.map.on("moveend", () => {
      clearTimeout(moveendTimer);
      moveendTimer = setTimeout(() => this._refreshRoadNetwork(), 400);
    });
    this._refreshRoadNetwork();
    // Vector tiles arrive asynchronously after the style load. Refresh once
    // the visible tile set is idle so the snap network exists on page load,
    // not only after the user pans the map.
    this.map.on("idle", () => this._refreshRoadNetwork());

    this._layersReady = true;
    if (this._ready) this._ready();
  }

  whenReady() {
    if (this._layersReady) return Promise.resolve();
    return new Promise((resolve) => {
      this._ready = resolve;
    });
  }

  _setupLayers() {
    const map = this.map;
    map.addSource("route", { type: "geojson", data: emptyFC() });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 6, "line-opacity": 0.55 },
    });

    map.addSource("preview", { type: "geojson", data: emptyFC() });
    map.addLayer({
      id: "preview-line",
      type: "line",
      source: "preview",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.85 },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
  }

  /** (Re)fetch the free OSM road/path network for the current view, cached
   *  until you pan/zoom far enough away that it no longer covers where you're
   *  drawing. Silent best-effort: on failure, drawing falls back to following
   *  the raw finger line (unsnapped) until the next successful fetch. */
  _collectVisibleRoadNetwork() {
    if (this.map.getZoom() < MIN_SNAP_ZOOM) return [];
    // Style-agnostic: match every rendered line layer that reads roads from
    // an OpenMapTiles-schema "transportation" source-layer, whatever the
    // style names its sources (OpenFreeMap uses "openmaptiles", CARTO uses
    // "carto"). Our own route/preview layers have no source-layer, so the
    // check below already excludes them.
    const roadLayers = this.map
      .getStyle()
      .layers
      .filter((layer) =>
        layer.type === "line" &&
        layer["source-layer"] === "transportation" &&
        !layer.id.includes("casing") &&
        !layer.id.includes("hatching")
      )
      .map((layer) => layer.id);
    if (!roadLayers.length) return [];

    const features = this.map.queryRenderedFeatures({ layers: roadLayers });
    const ways = [];
    const seen = new Set();
    for (const feature of features) {
      const geometries = feature.geometry?.type === "MultiLineString"
        ? feature.geometry.coordinates
        : feature.geometry?.type === "LineString"
          ? [feature.geometry.coordinates]
          : [];
      for (const geometry of geometries) {
        const points = geometry
          .filter((point) => Array.isArray(point) && point.length >= 2)
          .map(([lng, lat]) => [lat, lng]);
        if (points.length < 2) continue;
        // Dedupe per LINESTRING by geometry, never by feature id: a vector-tile
        // feature id is shared by every tile piece of the same OSM way (and by
        // every sub-line of a MultiLineString), so keying on it silently drops
        // all but one piece -- leaving gaps in the snap network where the line
        // then refuses to follow the road.
        const a = points[0], z = points[points.length - 1];
        const key = [points.length, a[0].toFixed(7), a[1].toFixed(7), z[0].toFixed(7), z[1].toFixed(7)].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        ways.push({ key, points, waytypeId: visibleRoadType(feature.properties) });
      }
    }
    return ways;
  }

  /** Keep roads from every view the user has visited (bounded, oldest first
   *  out) so a new stroke can be joined to the route's end even after the map
   *  was panned/zoomed away from it. Used only for joining -- live snapping
   *  still uses just the current view (_roadWays), which stays fast. */
  _rememberWays(ways) {
    if (!this._networkCache) this._networkCache = new Map();
    for (const way of ways) {
      const key = way.key || `${way.points.length}|${way.points[0]}|${way.points[way.points.length - 1]}`;
      this._networkCache.delete(key); // re-insert so recently seen ways are newest
      this._networkCache.set(key, way);
    }
    while (this._networkCache.size > MAX_NETWORK_CACHE) {
      this._networkCache.delete(this._networkCache.keys().next().value);
    }
  }

  /** Road-following join from the end of the route so far to where a new
   *  stroke starts, so drawing again after lifting (to pan past the controls,
   *  or just a bit off the red dot) extends ONE route instead of leaving a
   *  straight-line gap. Returns [] when there's nothing sensible to add. */
  _bridgeFromRouteEnd(firstPoint) {
    if (!this.legs.length || !this._networkCache?.size) return [];
    const lastLeg = this.legs[this.legs.length - 1].coords;
    const anchor = lastLeg[lastLeg.length - 1];
    const gapM = pathLengthM([anchor, firstPoint]);
    if (gapM < MIN_BRIDGE_M || gapM > MAX_BRIDGE_M) return [];
    const path = findNetworkPath([...this._networkCache.values()], anchor, firstPoint);
    if (!path || path.length < 2) return [];
    return pathLengthM(path) <= Math.max(40, gapM * 3) ? path : [];
  }

  async _refreshRoadNetwork() {
    if (this.map.getZoom() < MIN_SNAP_ZOOM) return;
    const b = this.map.getBounds();
    const view = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];

    // Prefer the vector geometry already loaded by MapLibre. This is local,
    // immediate, and cannot be rate-limited like an Overpass request.
    const visibleWays = this._collectVisibleRoadNetwork();
    if (visibleWays.length) {
      this._rememberWays(visibleWays);
      this._roadWays = visibleWays;
      this._roadNetworkBbox = view;
      return;
    }

    if (this._roadNetworkBbox && boundsContain(this._roadNetworkBbox, view)) return;
    if (this._roadNetworkPromise) return this._roadNetworkPromise;

    this._roadNetworkPromise = (async () => {
      try {
        const bbox = bboxFromMapBounds(b);
        this._roadWays = await fetchWaysInBbox(bbox);
        this._rememberWays(this._roadWays);
        this._roadNetworkBbox = bbox;
      } catch (err) {
        console.error("Visible/vector road lookup and Overpass fallback failed:", err);
      } finally {
        this._roadNetworkPromise = null;
      }
    })();
    return this._roadNetworkPromise;
  }

  // ---------- Pointer drawing ----------

  _wireDrawing() {
    const MIN_SAMPLE_PX = 4;
    const container = this.map.getContainer();
    container.style.touchAction = "none";

    this._activePointers = new Set();
    this._drawPointerId = null;
    this._dragSnapped = null; // per-point snap results for the in-progress stroke (null when no road network)
    this._dragRaw = null; // original finger positions, retained for fallback routing
    this._dragLastPx = null;
    this._previewFrameQueued = false;

    // The live preview follows the ROADS as you draw (not your raw finger
    // squiggle) whenever the road network is available -- so you see the line
    // lock to the road in real time. Only when no road data is loaded does it
    // fall back to showing the raw finger line.
    const buildPreviewLine = () => {
      if (this._canSnap && this._dragSnapped && this._dragSnapped.length >= 2) {
        return buildTraceGeometry(this._dragSnapped, this._strokeWays);
      }
      return this._dragRaw || [];
    };
    const renderPreview = () => {
      const src = this.map.getSource("preview");
      const line = buildPreviewLine();
      src.setData(
        line.length >= 2
          ? { type: "FeatureCollection", features: [toLineString(line, { color: getProfileColor(this.profile) })] }
          : emptyFC()
      );
    };

    const scheduleRedraw = () => {
      if (this._previewFrameQueued) return;
      this._previewFrameQueued = true;
      requestAnimationFrame(() => {
        this._previewFrameQueued = false;
        if (this._dragRaw) renderPreview();
      });
    };

    const beginDraw = (e) => {
      this._drawPointerId = e.pointerId;
      this._lockedWayIndex = null;
      this._lockedArcM = null;
      this._lastSnappedPoint = null;
      const firstRaw = this._eventToLatLng(e);
      // Snap live if we have road data; otherwise capture raw and match on
      // release. Either way the gesture is always captured -- a network hiccup
      // can never prevent drawing.
      // Freeze the network for the whole stroke: _roadWays is replaced on every
      // map idle/moveend, and wayIndex values are indices into it, so swapping
      // it mid-stroke would point the lock/trace at the wrong roads.
      this._strokeWays = this._roadWays;
      this._canSnap = !!(this._strokeWays && this._strokeWays.length);
      this._dragRaw = [firstRaw];
      this._dragSnapped = this._canSnap ? [this._snapFull(firstRaw)] : null;
      this._dragLastPx = [e.clientX, e.clientY];
      renderPreview();
    };

    const finishDraw = () => {
      const raw = this._dragRaw;
      const snapped = this._dragSnapped;
      this._dragSnapped = null;
      this._dragRaw = null;
      this._drawPointerId = null;
      this.map.getSource("preview").setData(emptyFC());
      if (!raw) return;
      if (raw.length < 2) this._handleTap(raw[0]);
      else this._commitFreehandStroke(raw, snapped);
    };

    const cancelDraw = () => {
      this._dragSnapped = null;
      this._dragRaw = null;
      this._drawPointerId = null;
      this.map.getSource("preview").setData(emptyFC());
    };

    container.addEventListener("pointerdown", (e) => {
      if (!this.drawMode) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest(".maplibregl-ctrl")) return;
      this._activePointers.add(e.pointerId);
      if (this._activePointers.size > 1) {
        if (this._dragRaw && this._dragRaw.length >= 2) finishDraw();
        else cancelDraw();
        return;
      }
      // setPointerCapture can throw if the pointer vanished between the
      // event and this call (edge-case timing) -- losing capture only costs
      // us "draw continues outside the map", not the whole gesture.
      try { container.setPointerCapture?.(e.pointerId); } catch {}
      beginDraw(e);
    });

    container.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this._drawPointerId || !this._dragRaw) return;
      const dx = e.clientX - this._dragLastPx[0];
      const dy = e.clientY - this._dragLastPx[1];
      if (dx * dx + dy * dy < MIN_SAMPLE_PX * MIN_SAMPLE_PX) return;
      this._dragLastPx = [e.clientX, e.clientY];
      const raw = this._eventToLatLng(e);
      this._dragRaw.push(raw);
      if (this._canSnap) this._dragSnapped.push(this._snapFull(raw));
      scheduleRedraw();
    });

    const onPointerEnd = (e) => {
      this._activePointers.delete(e.pointerId);
      if (e.pointerId === this._drawPointerId) finishDraw();
    };
    container.addEventListener("pointerup", onPointerEnd);
    container.addEventListener("pointercancel", onPointerEnd);
    container.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && e.pointerId === this._drawPointerId) cancelDraw();
    });
  }

  async setDrawMode(enabled) {
    if (!enabled) {
      this.drawMode = false;
      this.map.dragPan.enable();
      if (this._dragRaw) {
        this._dragSnapped = null;
        this._dragRaw = null;
        this._drawPointerId = null;
        this.map.getSource("preview").setData(emptyFC());
      }
      return false;
    }

    // Enable immediately. Overpass is only an enhancement for live snapping;
    // it must never block the pen or make the first gesture disappear. If its
    // data is unavailable, the gesture is routed through OSRM on release.
    if (this.map.getZoom() < MIN_SNAP_ZOOM) return false;
    this.drawMode = true;
    this.map.dragPan.disable();
    this._refreshRoadNetwork();
    return true;
  }

  _eventToLatLng(e) {
    const rect = this.map.getContainer().getBoundingClientRect();
    const { lng, lat } = this.map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    return [lat, lng];
  }

  /** Snap one finger point to the road it's on, keeping the stroke locked to
   *  the road it started on (stickiness + along-road continuity, see
   *  snapToNearestWay). Returns a snap result with wayIndex/segmentIndex so
   *  buildTraceGeometry can follow the road. */

  _snapFull(latlng) {
    const raw = { lat: latlng[0], lng: latlng[1], wayIndex: -1, segmentIndex: -1, arcM: null };
    const ways = this._strokeWays || this._roadWays;
    if (!ways || !ways.length) return raw;

    const s = snapToNearestWay(latlng, ways, {
      maxM: 40,
      arcWindowM: 90,
      stickyMarginM: 18,
      preferWayIndex: this._lockedWayIndex,
      preferArcM: this._lockedArcM,
    });
    if (s) {
      this._lockedWayIndex = s.wayIndex;
      this._lockedArcM = s.arcM;
      this._lastSnappedPoint = s;
      return s;
    }

    // A single noisy finger sample should not pull the rendered line off the
    // road. Hold the last valid road position until the gesture comes back
    // within snapping range or reaches a mapped road at a junction.
    return this._lastSnappedPoint ? { ...this._lastSnappedPoint, stale: true } : raw;
  }

  // ---------- Route legs ----------

  _lastAnchor() {
    if (this.legs.length) {
      const c = this.legs[this.legs.length - 1].coords;
      return c[c.length - 1];
    }
    return this.pendingStart;
  }

  _handleTap(pt) {
    const anchor = this._lastAnchor();
    if (!anchor) {
      this.pendingStart = pt;
      this._rebuild();
      return;
    }
    this._addRouteLeg(anchor, pt);
  }

  async _addRouteLeg(from, to) {
    this.onBusyChange(true);
    const token = ++this.routeToken;
    try {
      const r = await getRoute(this.profile, [from, to], getOrsKey(), this._roadWays, this._roadNetworkBbox);
      if (token !== this.routeToken) return;
      if (this.pendingStart && this.legs.length === 0) this.pendingStart = null;
      this.legs.push({ kind: "route", coords: r.coords, from, to });
      this._rebuild();
    } catch (err) {
      if (token === this.routeToken) this.onRouteError(err.message || String(err));
    } finally {
      if (token === this.routeToken) this.onBusyChange(false);
    }
  }

  _commitFreehandStroke(raw, snapped) {
    // Reuse the snap results already computed live during the drag (identical
    // to what the preview showed) when we have them; otherwise snap now.
    if (!snapped && this._strokeWays?.length) {
      this._lockedWayIndex = null;
      this._lockedArcM = null;
      this._lastSnappedPoint = null;
      snapped = raw.map((point) => this._snapFull(point));
    }
    if (!snapped) {
      this._addFallbackStroke(raw);
      return;
    }
    const validSnaps = snapped.filter((point) => point.wayIndex >= 0);
    if (validSnaps.length < 2) {
      this._addFallbackStroke(raw);
      return;
    }
    const coords = buildTraceGeometry(snapped, this._strokeWays);
    if (coords.length < 2) {
      this._addFallbackStroke(raw);
      return;
    }
    this._addTraceStroke(snapped);
  }

  async _addFallbackStroke(raw) {
    if (!raw || raw.length < 2) return;
    const waypoints = [raw[0]];
    // Keep intentional bends, but cap the number of OSRM waypoints so a long
    // finger gesture stays within a practical URL/request size.
    const stride = Math.max(1, Math.ceil((raw.length - 2) / 6));
    for (let i = stride; i < raw.length - 1; i += stride) waypoints.push(raw[i]);
    waypoints.push(raw[raw.length - 1]);

    this.onBusyChange(true);
    try {
      let result;
      try {
        result = await matchGesture(this.profile, waypoints, getOrsKey());
      } catch (firstError) {
        // A finger endpoint or intermediate sample can be just outside the
        // router's snapping radius. Retry with only the endpoints rather than
        // losing the whole gesture.
        result = await matchGesture(this.profile, [raw[0], raw[raw.length - 1]], getOrsKey());
      }
      this.legs.push({ kind: "route", coords: result.coords, from: raw[0], to: raw[raw.length - 1] });
      this._rebuild();
    } catch (err) {
      this.onRouteError(`Road snap is temporarily unavailable: ${err.message || err}`);
    } finally {
      this.onBusyChange(false);
    }
  }

  _addTraceStroke(snapped) {
    const traced = buildTraceGeometry(snapped, this._strokeWays);
    if (traced.length < 2) {
      this._handleTap([snapped[0].lat, snapped[0].lng]);
      return;
    }
    if (this.pendingStart && this.legs.length === 0) this.pendingStart = null;
    // Part of the same leg, so Undo removes the stroke and its join together.
    const coords = [...this._bridgeFromRouteEnd(traced[0]), ...traced];
    this.legs.push({ kind: "trace", coords });
    this._rebuild();
  }

  _fullCoords() {
    const all = [];
    for (const leg of this.legs) {
      for (const c of leg.coords) {
        const last = all[all.length - 1];
        if (!last || last[0] !== c[0] || last[1] !== c[1]) all.push(c);
      }
    }
    return all;
  }

  /** Recompute markers + rendered route from the current legs. Renders the
   *  geometry instantly in a single colour, then upgrades to per-path-type
   *  colours asynchronously (classification is a local computation over the
   *  already-cached road network, no routing round-trip). */
  _rebuild() {
    const coords = this._fullCoords();
    const start = this.pendingStart || (coords.length ? coords[0] : null);
    const end = coords.length >= 2 ? coords[coords.length - 1] : null;
    this._redrawMarkers(start, end);
    this.waypoints = start ? (end ? [start, end] : [start]) : [];

    if (coords.length < 2) {
      this.map.getSource("route").setData(emptyFC());
      this.lastResult = null;
      this.onRouteChange(null);
      return;
    }

    const distanceM = pathLengthM(coords);
    const durationS = distanceM / (PROFILE_SPEED_MPS[this.profile] || 1.35);
    const color = getProfileColor(this.profile);
    const label = PROFILE_LABELS[this.profile] || "Route";
    const result = {
      coords,
      distanceM,
      durationS,
      ascentM: null,
      descentM: null,
      segments: [{ coords, waytypeId: null, label, color, distanceM }],
      breakdown: [{ waytypeId: null, label, color, distanceM }],
      classified: false,
    };
    this.lastResult = result;
    this._renderRoute(result);
    this.onRouteChange(result);
    // NOTE: deliberately a single solid colour -- no per-road-type recolour.
    // The route line must be one clear, read-through colour so road/place
    // labels stay legible underneath it (per operator direction). The
    // colour is the user's chosen route colour (getProfileColor).
  }

  // ---------- Public API used by main.js ----------

  setView(latlng, zoom = 15) {
    this.map.jumpTo({ center: [latlng[1], latlng[0]], zoom });
  }

  setProfile(profile) {
    if (this.profile === profile) return;
    this.profile = profile;
    // Trace legs are geometry (profile only changes their colour, handled by
    // _rebuild's reclassification). Route legs' actual path can differ by
    // profile (a walking vs driving route), so re-fetch those first.
    this._refetchRouteLegsThenRebuild();
  }

  async _refetchRouteLegsThenRebuild() {
    const hasRouteLegs = this.legs.some((l) => l.kind === "route");
    if (hasRouteLegs) {
      this.onBusyChange(true);
      const token = ++this.routeToken;
      try {
        for (const leg of this.legs) {
          if (leg.kind !== "route") continue;
          const r = await getRoute(this.profile, [leg.from, leg.to], getOrsKey(), this._roadWays, this._roadNetworkBbox);
          if (token !== this.routeToken) return;
          leg.coords = r.coords;
        }
      } catch (err) {
        console.error("Re-routing after profile change failed, keeping previous paths:", err);
      } finally {
        if (token === this.routeToken) this.onBusyChange(false);
      }
      if (token !== this.routeToken) return;
    }
    this._rebuild();
  }

  /** Re-colour the current route from today's colour setting, no network --
   *  used after the user tweaks the route colour. The line is a single solid
   *  colour, so this just restyles it. */
  refresh() {
    if (!this.lastResult) return;
    const color = getProfileColor(this.profile);
    for (const seg of this.lastResult.segments) seg.color = color;
    for (const b of this.lastResult.breakdown) b.color = color;
    this._renderRoute(this.lastResult);
    this.onRouteChange(this.lastResult);
  }

  undo() {
    if (this.legs.length) this.legs.pop();
    else if (this.pendingStart) this.pendingStart = null;
    else return;
    this._rebuild();
  }

  clear() {
    this.legs = [];
    this.pendingStart = null;
    this._rebuild();
  }

  loadPrecomputed(profile, waypoints, result) {
    this.profile = profile;
    this.legs = [{ kind: "loaded", coords: result.coords }];
    this.pendingStart = null;
    this.lastResult = result;
    const start = result.coords[0];
    const end = result.coords[result.coords.length - 1];
    this.waypoints = [start, end];
    this._redrawMarkers(start, end);
    this._renderRoute(result);
    this.onRouteChange(result);

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lat, lng] of result.coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    this.map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40 });
  }

  getState() {
    return { profile: this.profile, waypoints: this.waypoints, result: this.lastResult };
  }

  _redrawMarkers(start, end) {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    if (start) {
      this.markers.push(new maplibregl.Marker({ element: markerElement(18, "#22c55e"), anchor: "center" }).setLngLat([start[1], start[0]]).addTo(this.map));
    }
    if (end) {
      this.markers.push(new maplibregl.Marker({ element: markerElement(18, "#ef4444"), anchor: "center" }).setLngLat([end[1], end[0]]).addTo(this.map));
    }
  }

  _renderRoute(result) {
    const features = result.segments.map((seg) => toLineString(seg.coords, { color: seg.color }));
    this.map.getSource("route").setData({ type: "FeatureCollection", features });
  }
}

export function profileHint(profile, hasKey) {
  if (hasKey) {
    return `${PROFILE_LABELS[profile]} -- turn on draw mode (pencil) and trace your route with a finger/mouse; it locks to roads & paths. Tap-to-tap uses openrouteservice routing.`;
  }
  return `${PROFILE_LABELS[profile]} -- turn on draw mode (pencil) and trace your route with a finger/mouse; it locks precisely to the roads and paths you draw over. All free, no account needed.`;
}
