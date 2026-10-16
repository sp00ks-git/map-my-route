// Talks to the two free routing backends and turns their responses into a
// single normalized shape the rest of the app renders:
//
// {
//   coords: [[lat,lng], ...],           // full snapped-to-road geometry
//   distanceM: number,
//   durationS: number,
//   ascentM: number | null,
//   descentM: number | null,
//   segments: [                         // colored polyline pieces
//     { coords: [[lat,lng],...], waytypeId, label, color, distanceM }
//   ],
//   breakdown: [ { waytypeId, label, color, distanceM } ],  // summed per type
//   classified: boolean,                // false = plain OSRM route, no road-type info
// }

import {
  OSRM_DEMO_URL,
  OSRM_FOOT_URL,
  OSRM_BIKE_URL,
  ORS_BASE_URL,
  WAYTYPE_STYLES,
  DEFAULT_ROUTE_COLOR,
  PROFILE_LABELS,
  getWaytypeColor,
  getProfileColor,
} from "./config.js?v=1.2.8";
import { classifyRoute } from "./waytype.js?v=1.2.8";

/** Turn a set of [fromIndex, toIndex, waytypeId] ranges (ORS's own shape, or
 *  our own free OSM-based classifier's output) into rendered segments +
 *  a distance breakdown, using the user's customizable waytype colors. */
export function buildSegmentsFromRanges(coords, ranges) {
  const segments = [];
  const totalsByType = new Map();
  for (const [from, to, typeId] of ranges) {
    const segCoords = coords.slice(from, to + 1);
    if (segCoords.length < 2) continue;
    const distanceM = pathLengthM(segCoords);
    const style = WAYTYPE_STYLES[typeId] || WAYTYPE_STYLES[0];
    segments.push({ coords: segCoords, waytypeId: typeId, label: style.label, color: getWaytypeColor(typeId), distanceM });
    totalsByType.set(typeId, (totalsByType.get(typeId) || 0) + distanceM);
  }
  const breakdown = [...totalsByType.entries()]
    .map(([typeId, distanceM]) => {
      const style = WAYTYPE_STYLES[typeId] || WAYTYPE_STYLES[0];
      return { waytypeId: typeId, label: style.label, color: getWaytypeColor(typeId), distanceM };
    })
    .sort((a, b) => b.distanceM - a.distanceM);
  return { segments, breakdown };
}

// "dog-walking" is a UI label, not a real routing network -- it rides on the
// same foot/path network as walking. hiking also just uses the foot network
// on the free keyless backends (only ORS distinguishes foot-walking vs
// foot-hiking as separate profiles).
const OSRM_PROFILE_URL = {
  "driving-car": OSRM_DEMO_URL,
  "foot-walking": OSRM_FOOT_URL,
  "foot-hiking": OSRM_FOOT_URL,
  "dog-walking": OSRM_FOOT_URL,
  "cycling-regular": OSRM_BIKE_URL,
};

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function pathLengthM(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversineM(coords[i - 1], coords[i]);
  return d;
}

/** One retry after a short delay for transient connection drops (flaky wifi,
 *  a mobile network hiccup, ...). Only retries actual network failures --
 *  an HTTP error response from the server comes back normally and is left
 *  to the caller to interpret. */
async function fetchWithRetry(url, options, retries = 1) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, 600));
    return fetchWithRetry(url, options, retries - 1);
  }
}

/** A normal OSRM route between deliberately-placed points -- finds the
 *  engine's own best path between them. This is ONLY used for tap-to-tap
 *  legs (get me from this tapped point to that one); finger-DRAWN strokes
 *  never touch OSRM at all -- they're traced along the real road network
 *  client-side (see waytype.buildTraceGeometry) precisely so the engine's
 *  gap-filling can't make the line wander off the road you drew. */
async function fetchOSRMRoute(baseUrl, waypoints) {
  const coordStr = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `${baseUrl}/${coordStr}?overview=full&geometries=geojson`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Routing request failed (${res.status})`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(data.message || "No route found between those points");
  }
  const route = data.routes[0];
  return { coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distanceM: route.distance, durationS: route.duration };
}

async function fetchOSRMMatch(baseUrl, points) {
  const matchBase = baseUrl.replace("/route/v1/", "/match/v1/");
  const coordStr = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const radiuses = points.map(() => 100).join(";");
  const url = `${matchBase}/${coordStr}?overview=full&geometries=geojson&tidy=true&radiuses=${radiuses}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Map matching failed (${res.status})`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.matchings?.length) {
    throw new Error(data.message || "No mapped road matched the gesture");
  }
  const match = data.matchings[0];
  return { coords: match.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distanceM: match.distance, durationS: match.duration };
}

/** Match a freehand gesture against the routing engine's road graph. This
 * is preferred to independently snapping every finger sample because the
 * engine can choose one connected road sequence across junctions and bends.
 */
export async function matchGesture(profile, points, orsApiKey = "") {
  if (orsApiKey || points.length < 2) return getRoute(profile, points, orsApiKey);
  const baseUrl = OSRM_PROFILE_URL[profile] || OSRM_DEMO_URL;
  try {
    const { coords, distanceM, durationS } = await fetchOSRMMatch(baseUrl, points);
    const color = getProfileColor(profile);
    const label = PROFILE_LABELS[profile] || "Route";
    return {
      coords,
      distanceM,
      durationS,
      ascentM: null,
      descentM: null,
      segments: [{ coords, waytypeId: null, label, color, distanceM }],
      breakdown: [{ waytypeId: null, label, color, distanceM }],
      classified: false,
    };
  } catch (err) {
    console.warn("OSRM map matching failed; falling back to waypoint routing:", err);
    return routeWithOSRM(profile, points, null, null);
  }
}

/** Fetch a route via a free key-less OSRM instance -- the public
 *  project-osrm.org demo (driving only) or FOSSGIS's routed-foot/routed-bike
 *  mirrors (walking/hiking/dog-walking/cycling). OSRM's own response has no
 *  road-type info, so we separately (and for free) ask OpenStreetMap itself,
 *  via Overpass, what each stretch of the route actually is -- footway,
 *  bridleway, cycleway, track, road -- so this works exactly like the ORS
 *  path below, no API key required. If that classification isn't possible
 *  (huge route, Overpass unreachable) it falls back to one color for the
 *  whole route, picked by travel profile so different modes stay distinct. */
async function routeWithOSRM(profile, waypoints, cachedWays, cachedBounds) {
  const baseUrl = OSRM_PROFILE_URL[profile] || OSRM_DEMO_URL;
  const { coords, distanceM, durationS } = await fetchOSRMRoute(baseUrl, waypoints);

  let ranges = null;
  if (cachedWays?.length) {
    try {
      // Reuses the planner's already-loaded local road network when it covers
      // this route, instead of firing a second, redundant Overpass query --
      // that duplicate round-trip was the multi-second "hang" after drawing.
      ranges = await classifyRoute(coords, cachedWays, cachedBounds);
    } catch (err) {
      console.error("Free OSM waytype classification failed, showing a single color instead:", err);
    }
  }

  if (ranges?.length) {
    const { segments, breakdown } = buildSegmentsFromRanges(coords, ranges);
    return { coords, distanceM, durationS, ascentM: null, descentM: null, segments, breakdown, classified: true };
  }

  const color = getProfileColor(profile);
  const label = PROFILE_LABELS[profile] || "Route";
  return {
    coords,
    distanceM,
    durationS,
    ascentM: null,
    descentM: null,
    segments: [{ coords, waytypeId: null, label, color, distanceM }],
    breakdown: [{ waytypeId: null, label, color, distanceM }],
    classified: false,
  };
}

/** Fetch a route from openrouteservice, which supports walking/hiking/cycling
 *  profiles and returns extra_info so we can color each stretch of the route
 *  by road/track/footway/cycleway/steps. Requires the user's own free API key. */
async function routeWithORS(profile, waypoints, apiKey) {
  // ORS has no "dog-walking" profile -- it's a UI label for the foot network.
  const orsProfile = profile === "dog-walking" ? "foot-walking" : profile;
  const url = `${ORS_BASE_URL}/${orsProfile}/geojson`;
  const body = {
    coordinates: waypoints.map(([lat, lng]) => [lng, lat]),
    extra_info: ["waytype", "surface"],
    elevation: true,
  };

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const msg = errBody?.error?.message || `openrouteservice request failed (${res.status})`;
    throw new Error(msg);
  }

  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error("No route found between those points");

  const rawCoords = feature.geometry.coordinates; // [lng, lat, elevation?]
  const coords = rawCoords.map(([lng, lat]) => [lat, lng]);
  const props = feature.properties;
  const summary = props.summary;

  let ascentM = null;
  let descentM = null;
  if (rawCoords[0]?.length === 3) {
    ascentM = 0;
    descentM = 0;
    for (let i = 1; i < rawCoords.length; i++) {
      const diff = rawCoords[i][2] - rawCoords[i - 1][2];
      if (diff > 0) ascentM += diff;
      else descentM += -diff;
    }
  }

  const waytypeRanges = props.extras?.waytype?.values || [];

  let segments, breakdown;
  if (waytypeRanges.length) {
    ({ segments, breakdown } = buildSegmentsFromRanges(coords, waytypeRanges));
  } else {
    // Some profiles/instances omit extras entirely -- still show the route.
    const color = getProfileColor(profile);
    segments = [{ coords, waytypeId: null, label: "Route", color, distanceM: summary.distance }];
    breakdown = [{ waytypeId: null, label: "Route", color, distanceM: summary.distance }];
  }

  return {
    coords,
    distanceM: summary.distance,
    durationS: summary.duration,
    ascentM,
    descentM,
    segments,
    breakdown,
    classified: waytypeRanges.length > 0,
  };
}

/**
 * Get a route between 2+ waypoints ([lat,lng] pairs), snapped to roads/paths.
 * With an openrouteservice API key configured, every profile gets full
 * road/track/footway/cycleway/steps coloring. Without one, every profile
 * still works and still snaps to the real road/foot/cycle network (via free
 * key-less OSRM instances) -- just as a single color per travel mode instead
 * of a full waytype breakdown.
 */
export async function getRoute(profile, waypoints, orsApiKey, cachedWays, cachedBounds) {
  if (waypoints.length < 2) throw new Error("Need at least two points");

  if (orsApiKey) {
    return routeWithORS(profile, waypoints, orsApiKey);
  }
  return routeWithOSRM(profile, waypoints, cachedWays, cachedBounds);
}
