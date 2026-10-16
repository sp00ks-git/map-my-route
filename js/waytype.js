// Free, key-less road/path-type classification for routes that come back
// from OSRM (which gives geometry but no highway tag). Queries OpenStreetMap
// itself via the public, key-less Overpass API for the real highway="..."
// tags of every way inside the route's bounding box, then matches each point
// of the route to its nearest way. This is what gets a plain walking/cycling
// route (no ORS key, ever) colored by footway/bridleway/cycleway/track/road
// just like the paid ORS path does -- Overpass is free and needs no signup.

// Several public Overpass mirrors -- the main one (overpass-api.de) is often
// rate-limited/slow, and when it fails the road network silently doesn't load,
// which shows up as drawing NOT snapping to roads. Try each in turn.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Route length above which we skip Overpass classification (huge bbox query,
// slow, and not the use case this app is for -- short local routes / dog
// walks / school-run shortcuts). Falls back to a flat single color.
const MAX_CLASSIFY_KM = 60;

// highway=* (and a couple of access/surface hints) -> our WAYTYPE_STYLES ids.
function classifyHighwayTag(tags) {
  const h = tags.highway;
  if (!h) return 0;
  if (h === "steps") return 8;
  if (h === "footway" || h === "pedestrian") return 7;
  if (h === "cycleway") return 6;
  if (h === "bridleway") return 4;
  if (h === "path") {
    // Bare "path" is ambiguous in OSM -- lean on the access tags actually
    // present to pick the closest bucket.
    if (tags.bicycle === "designated") return 6;
    if (tags.horse === "designated") return 4;
    return 7; // most unclassified paths in the UK/EU are walked, not ridden
  }
  if (h === "track") return 5;
  if (h === "ferry") return 9;
  if (h === "construction") return 10;
  if (["motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"].includes(h)) return 1;
  if (["secondary", "tertiary", "secondary_link", "tertiary_link"].includes(h)) return 2;
  // residential, unclassified, living_street, service, road, etc.
  return 3;
}

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

/** Closest point on segment [a,b] to p, and the distance to it in meters --
 *  close enough at road/footpath scale, no need for a full geodesic
 *  projection. */
function projectToSegment(p, a, b) {
  const [px, py] = [p[1], p[0]]; // lng, lat as x, y for a flat local projection
  const [ax, ay] = [a[1], a[0]];
  const [bx, by] = [b[1], b[0]];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { point, distanceM: haversineM(p, point), t };
}

function pointToSegmentM(p, a, b) {
  return projectToSegment(p, a, b).distanceM;
}

function pathLengthM(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversineM(coords[i - 1], coords[i]);
  return d;
}

/** Does bbox `outer` ([s,w,n,e]) fully cover bbox `inner`? */
function boundsContainBbox(outer, inner) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

function boundingBox(coords, padDeg = 0.003) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [minLat - padDeg, minLng - padDeg, maxLat + padDeg, maxLng + padDeg];
}

export async function fetchWaysInBbox(bbox) {
  const [s, w, n, e] = bbox;
  const query = `[out:json][timeout:20];way[highway](${s},${w},${n},${e});out tags geom;`;

  let data = null;
  let lastErr = null;
  for (const endpoint of OVERPASS_URLS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Overpass request failed (${res.status})`);
      data = await res.json();
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!data) throw lastErr || new Error("All Overpass mirrors failed");

  return (data.elements || [])
    .filter((el) => el.geometry && el.tags)
    .map((el) => ({
      points: el.geometry.filter(Boolean).map((g) => [g.lat, g.lon]),
      waytypeId: classifyHighwayTag(el.tags),
    }))
    .filter((w) => w.points.length >= 2);
}

/** For one route point, find the nearest way and return its waytype id. */
function nearestWaytypeId(point, ways) {
  let best = Infinity;
  let bestId = 0;
  for (const way of ways) {
    for (let i = 1; i < way.points.length; i++) {
      const d = pointToSegmentM(point, way.points[i - 1], way.points[i]);
      if (d < best) {
        best = d;
        bestId = way.waytypeId;
      }
    }
  }
  // Further than ~25m from any tagged way -- probably a private
  // driveway/informal path OSM doesn't have. Leave unclassified rather than
  // guessing.
  return best <= 25 ? bestId : 0;
}

/** Cumulative distance-along-the-way (meters) at each point index, cached on
 *  the way object itself since it never changes for a given fetch. Real
 *  distance, not point count, is what "how far along this road" should mean
 *  -- a tight bend/roundabout can cram many OSM points into a few meters
 *  while a straight road has few points over a long distance, so a
 *  point-count window would be wildly inconsistent between the two. */
function cumulativeDistances(way) {
  if (way._cumDist) return way._cumDist;
  const cum = [0];
  for (let i = 1; i < way.points.length; i++) {
    cum.push(cum[i - 1] + haversineM(way.points[i - 1], way.points[i]));
  }
  way._cumDist = cum;
  return cum;
}

/**
 * Snap one point to a real road/path in `ways`, for live drawing feedback
 * (no routing-API round trip needed). Returns null if nothing tagged is
 * within `maxM` -- e.g. off the mapped network entirely, drawing across a
 * field, or the network just hasn't loaded for this area yet -- so the
 * caller can fall back to the raw point.
 *
 * `preferWayIndex` (the way index this stroke was already locked onto, if
 * any) adds "stickiness": near a junction or a parallel side street, the
 * globally-nearest road for one single sample can be the *wrong* one even
 * though you're clearly still tracing the road you started on. Once locked
 * onto a way, a competing way only wins if it's genuinely closer by more
 * than `stickyMarginM` -- not just marginally closer for one sample.
 *
 * `preferArcM` (how far along that way, in meters, the previous sample
 * landed) adds path *continuity* on top of that: a way that curves back
 * near itself (a loop, a hairpin, a nearby spur/junction) can have some
 * distant part of its own geometry be the closest point to a single sample,
 * even though it's nowhere near where the stroke actually is along that
 * road -- that's what shows up as a spike/drift off the road. When given,
 * only points within `arcWindowM` meters of it (measured along the road,
 * not point count) are considered for the preferred way, so it can only
 * advance along the road you're actually on.
 *
 * Returns { lat, lng, wayIndex, arcM } so the caller can pass
 * wayIndex/arcM back in for the next point in the same stroke.
 */
export function snapToNearestWay(
  point,
  ways,
  { maxM = 25, preferWayIndex = null, preferArcM = null, arcWindowM = 40, stickyMarginM = 12 } = {}
) {
  let best = Infinity;
  let bestPoint = null;
  let bestWayIndex = -1;
  let bestArcM = 0;
  let bestSeg = -1;
  let preferredBest = Infinity;
  let preferredPoint = null;
  let preferredArcM = 0;
  let preferredSeg = -1;

  ways.forEach((way, wayIndex) => {
    const cum = cumulativeDistances(way); // cheap after the first call, cached on the way
    for (let i = 1; i < way.points.length; i++) {
      const { point: proj, distanceM, t } = projectToSegment(point, way.points[i - 1], way.points[i]);
      const segmentLengthM = haversineM(way.points[i - 1], way.points[i]);
      const arcHere = cum[i - 1] + t * segmentLengthM;
      if (distanceM < best) {
        best = distanceM;
        bestPoint = proj;
        bestWayIndex = wayIndex;
        bestArcM = arcHere;
        bestSeg = i;
      }
      if (wayIndex !== preferWayIndex) continue;
      if (preferArcM !== null && Math.abs(arcHere - preferArcM) > arcWindowM) continue;
      if (distanceM < preferredBest) {
        preferredBest = distanceM;
        preferredPoint = proj;
        preferredArcM = arcHere;
        preferredSeg = i;
      }
    }
  });

  if (preferredPoint && preferredBest <= maxM && preferredBest <= best + stickyMarginM) {
    return { lat: preferredPoint[0], lng: preferredPoint[1], wayIndex: preferWayIndex, arcM: preferredArcM, segmentIndex: preferredSeg };
  }
  if (bestPoint && best <= maxM) {
    return { lat: bestPoint[0], lng: bestPoint[1], wayIndex: bestWayIndex, arcM: bestArcM, segmentIndex: bestSeg };
  }
  return null;
}

/**
 * Build a road-following polyline from a sequence of snapped finger points,
 * with NO routing engine involved -- this is the whole point of the drawing
 * tool. Each item is a snap result ({lat,lng,wayIndex,segmentIndex} from
 * snapToNearestWay, or an unsnapped {lat,lng,wayIndex:-1} raw point).
 *
 * The output is exactly the road geometry the finger traced: for each pair
 * of consecutive points that landed on the SAME way, the way's own vertices
 * between the two projections are inserted (so the line follows the road's
 * real curve, forward or backward), and the projection points themselves are
 * kept. Points on different ways (a junction crossing) are joined directly --
 * a short hop, since finger samples are dense.
 *
 * Because it only ever emits (a) points the finger snapped to and (b) way
 * vertices strictly between them on the same road, it CANNOT wander onto a
 * neighbouring road, detour into a cul-de-sac, or loop -- unlike an engine
 * that fills the gaps with its own pathfinding.
 */
export function buildTraceGeometry(snapped, ways) {
  const out = [];
  const push = (lat, lng) => {
    const last = out[out.length - 1];
    if (!last || last[0] !== lat || last[1] !== lng) out.push([lat, lng]);
  };
  if (!snapped.length) return out;

  push(snapped[0].lat, snapped[0].lng);
  for (let i = 1; i < snapped.length; i++) {
    const prev = snapped[i - 1];
    const cur = snapped[i];
    const sameWay =
      prev.wayIndex >= 0 &&
      prev.wayIndex === cur.wayIndex &&
      Number.isInteger(prev.segmentIndex) &&
      Number.isInteger(cur.segmentIndex);
    if (sameWay) {
      const way = ways[cur.wayIndex];
      if (way) insertWayVertices(push, way, prev.segmentIndex, cur.segmentIndex);
    }
    push(cur.lat, cur.lng);
  }
  return out;
}

/** Push a way's own vertices that lie strictly between two projection points,
 *  following the way in whichever direction the finger moved along it.
 *  segmentIndex i = the projection sits on the segment (vertex i-1 -> vertex i). */
function insertWayVertices(push, way, segStart, segEnd) {
  if (segStart === segEnd) return; // both on the same segment -- straight line between them is the road
  if (segStart < segEnd) {
    for (let v = segStart; v <= segEnd - 1; v++) push(way.points[v][0], way.points[v][1]);
  } else {
    for (let v = segStart - 1; v >= segEnd; v--) push(way.points[v][0], way.points[v][1]);
  }
}

export { pathLengthM };

/**
 * Split a route's length by road/path type using ONLY already-loaded way
 * geometry -- no network, so it's instant and can't "fail to look up". Each
 * route segment takes the waytype of the nearest way within `maxM` of its
 * midpoint (waytype 0 = not on any loaded way). Returns
 * { byType: Map<waytypeId, meters>, coveredM, totalM }.
 */
export function distanceByWaytype(coords, ways, { maxM = 25 } = {}) {
  const byType = new Map();
  let totalM = 0;
  let coveredM = 0;
  if (coords.length < 2) return { byType, coveredM, totalM };

  // Prefilter to ways that can touch the route at all, with a cached bbox each.
  const padDeg = maxM / 111000 + 0.00005;
  const box = boundingBox(coords, padDeg * 1.7);
  const candidates = [];
  for (const way of ways) {
    if (!way._bbox) {
      let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
      for (const [lat, lng] of way.points) {
        if (lat < s) s = lat; if (lat > n) n = lat;
        if (lng < w) w = lng; if (lng > e) e = lng;
      }
      way._bbox = [s, w, n, e];
    }
    const b = way._bbox;
    if (b[2] >= box[0] && b[0] <= box[2] && b[3] >= box[1] && b[1] <= box[3]) candidates.push(way);
  }

  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const len = haversineM(a, b);
    if (!len) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let best = Infinity, id = 0;
    for (const way of candidates) {
      const bb = way._bbox;
      if (mid[0] < bb[0] - padDeg || mid[0] > bb[2] + padDeg || mid[1] < bb[1] - padDeg * 1.7 || mid[1] > bb[3] + padDeg * 1.7) continue;
      for (let j = 1; j < way.points.length; j++) {
        const d = pointToSegmentM(mid, way.points[j - 1], way.points[j]);
        if (d < best) { best = d; id = way.waytypeId; }
      }
    }
    const type = best <= maxM ? id : 0;
    totalM += len;
    if (type) coveredM += len;
    byType.set(type, (byType.get(type) || 0) + len);
  }
  return { byType, coveredM, totalM };
}

/**
 * Shortest road-following path between two points over the loaded way
 * geometry -- no routing API, so it is instant and works offline of OSRM.
 * Used to JOIN a new drawn stroke onto the end of the route so far: the user
 * lifts off (to pan/zoom past the controls, or just by imprecision) and
 * starts again a little way along the road; the gap is filled by following the
 * actual road, not a straight chord, and not as a separate "new" path.
 *
 * Graph: every way vertex is a node (vertices within JOIN_TOL_M of each other
 * are the same node, so ways meet at junctions even if tile simplification
 * left them a metre apart); edges join consecutive vertices. `from`/`to` are
 * projected onto their nearest segment (<= maxSnapM) as virtual nodes.
 * Returns [[lat,lng],...] or null if either end is off-network, or no
 * connected path exists in the loaded data.
 */
const JOIN_TOL_M = 2.5;

export function findNetworkPath(ways, from, to, { maxSnapM = 20, padM = 150 } = {}) {
  const padDeg = padM / 111000;
  const south = Math.min(from[0], to[0]) - padDeg, north = Math.max(from[0], to[0]) + padDeg;
  const west = Math.min(from[1], to[1]) - padDeg * 1.7, east = Math.max(from[1], to[1]) + padDeg * 1.7;
  const local = ways.filter((w) =>
    w.points.some(([lat, lng]) => lat >= south && lat <= north && lng >= west && lng <= east));
  if (!local.length) return null;

  const a = snapToNearestWay(from, local, { maxM: maxSnapM });
  const b = snapToNearestWay(to, local, { maxM: maxSnapM });
  if (!a || !b) return null;

  // Node table with ~JOIN_TOL_M merging via a spatial hash.
  const cell = JOIN_TOL_M / 111000;
  const nodes = []; // [lat,lng]
  const grid = new Map();
  const nodeAt = (lat, lng) => {
    const cy = Math.floor(lat / cell), cx = Math.floor(lng / (cell * 1.6));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const id of grid.get(`${cy + dy},${cx + dx}`) || []) {
          if (haversineM(nodes[id], [lat, lng]) <= JOIN_TOL_M) return id;
        }
      }
    }
    const id = nodes.length;
    nodes.push([lat, lng]);
    const k = `${cy},${cx}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(id);
    return id;
  };

  const adj = []; // adj[id] = [[otherId, meters], ...]
  const link = (i, j) => {
    if (i === j) return;
    const m = haversineM(nodes[i], nodes[j]);
    (adj[i] ||= []).push([j, m]);
    (adj[j] ||= []).push([i, m]);
  };
  local.forEach((w) => {
    let prev = nodeAt(w.points[0][0], w.points[0][1]);
    for (let i = 1; i < w.points.length; i++) {
      const cur = nodeAt(w.points[i][0], w.points[i][1]);
      link(prev, cur);
      prev = cur;
    }
  });

  // Virtual start/end nodes sitting on their segments.
  const virtual = (snap) => {
    const way = local[snap.wayIndex];
    const id = nodes.length;
    nodes.push([snap.lat, snap.lng]);
    link(id, nodeAt(way.points[snap.segmentIndex - 1][0], way.points[snap.segmentIndex - 1][1]));
    link(id, nodeAt(way.points[snap.segmentIndex][0], way.points[snap.segmentIndex][1]));
    return id;
  };
  const start = virtual(a);
  const goal = virtual(b);
  if (a.wayIndex === b.wayIndex && a.segmentIndex === b.segmentIndex) link(start, goal);

  // Dijkstra (graph is a few hundred nodes -- an array scan is plenty).
  const dist = new Array(nodes.length).fill(Infinity);
  const prevNode = new Array(nodes.length).fill(-1);
  const done = new Array(nodes.length).fill(false);
  dist[start] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u === -1 || u === goal) break;
    done[u] = true;
    for (const [v, m] of adj[u] || []) {
      if (dist[u] + m < dist[v]) { dist[v] = dist[u] + m; prevNode[v] = u; }
    }
  }
  if (!Number.isFinite(dist[goal])) return null;
  const path = [];
  for (let n = goal; n !== -1; n = prevNode[n]) path.push(nodes[n]);
  return path.reverse();
}


/** Bounding box (as fetchWaysInBbox wants: [south, west, north, east]) for a
 *  MapLibre map's current view, padded so panning slightly while drawing
 *  doesn't immediately fall outside the cached network. */
export function bboxFromMapBounds(bounds, padFraction = 0.5) {
  const s = bounds.getSouth(), w = bounds.getWest(), n = bounds.getNorth(), e = bounds.getEast();
  const padLat = (n - s) * padFraction;
  const padLng = (e - w) * padFraction;
  return [s - padLat, w - padLng, n + padLat, e + padLng];
}

/**
 * Classify a route's coordinates by real OSM road/path type, for free, no
 * API key. Returns waytypeRanges in the same [fromIndex, toIndex, waytypeId]
 * shape openrouteservice's extra_info.waytype uses, or null if classification
 * wasn't possible/worth it (route too long, Overpass unreachable, etc) --
 * callers should fall back to a flat single color in that case.
 *
 * `cachedWays` lets a caller that already has the local road network loaded
 * (e.g. the planner's live snap-while-drawing cache) skip a second, redundant
 * Overpass round-trip entirely -- only used if it actually covers the route.
 */
export async function classifyRoute(coords, cachedWays = null, cachedBounds = null) {
  if (coords.length < 2) return null;
  if (pathLengthM(coords) / 1000 > MAX_CLASSIFY_KM) return null;

  // Cache check uses the route's EXACT bbox: a drawn stroke was snapped to
  // ways from the cached network, so the network always covers it -- padding
  // here (as opposed to for the Overpass fetch below) needlessly rejects the
  // cache whenever the stroke runs near the edge of the loaded view, and
  // then a slow/unreachable Overpass would downgrade the route to a flat
  // single colour even though all the data needed is already in memory.
  const exactBbox = boundingBox(coords, 0);
  const overpassBbox = boundingBox(coords);
  const ways =
    cachedWays?.length && cachedBounds && boundsContainBbox(cachedBounds, exactBbox)
      ? cachedWays
      : await fetchWaysInBbox(overpassBbox);
  if (!ways.length) return null;

  const ids = coords.map((pt) => nearestWaytypeId(pt, ways));

  const ranges = [];
  let start = 0;
  for (let i = 1; i <= ids.length; i++) {
    if (i === ids.length || ids[i] !== ids[start]) {
      ranges.push([start, i - 1, ids[start]]);
      start = i;
    }
  }
  return ranges;
}
