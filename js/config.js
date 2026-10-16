// Shared constants and small storage helpers. No build step, no bundler --
// this file is loaded as a plain ES module straight from the browser.

export const ORS_KEY_STORAGE = "mapmyroute.orsApiKey";
export const COLOR_OVERRIDES_STORAGE = "mapmyroute.colorOverrides";

export const OSRM_DEMO_URL = "https://router.project-osrm.org/route/v1/driving";
// FOSSGIS's public OSRM mirrors -- the *only* free, key-less way to get real
// road/footpath/bridleway-snapped walking & cycling routes. The official
// project-osrm.org demo only ever hosts the driving profile.
export const OSRM_FOOT_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
export const OSRM_BIKE_URL = "https://routing.openstreetmap.de/routed-bike/route/v1/bike";
export const ORS_BASE_URL = "https://api.openrouteservice.org/v2/directions";

// openrouteservice "extra_info=waytype" numeric IDs -> human label + default
// line color (overridable -- see COLOR_OVERRIDES_STORAGE below).
// Reference: https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/waytype
// Coverage is coarse (it's a routing engine, not a full OSM tag dump) so a
// bridleway and a hiking path can both land under "Path" -- the legend says so.
export const WAYTYPE_STYLES = {
  0: { label: "Unknown", color: "#6b7280" },
  1: { label: "State road", color: "#1d4ed8" },
  2: { label: "Road", color: "#2563eb" },
  3: { label: "Street", color: "#3b82f6" },
  4: { label: "Path / bridleway", color: "#9333ea" },
  5: { label: "Track (unpaved)", color: "#d97706" },
  6: { label: "Cycleway", color: "#16a34a" },
  7: { label: "Footway", color: "#db2777" },
  8: { label: "Steps", color: "#dc2626" },
  9: { label: "Ferry", color: "#0891b2" },
  10: { label: "Construction", color: "#78716c" },
};

// Fallback single color used when we only have an unclassified OSRM route
// (no ORS key configured yet, so no per-segment road-type breakdown).
export const DEFAULT_ROUTE_COLOR = "#2563eb";

export const PROFILE_LABELS = {
  "driving-car": "Driving",
  "foot-walking": "Walking",
  "foot-hiking": "Hiking",
  "cycling-regular": "Cycling",
  "dog-walking": "Dog walk",
};

// Without an ORS key we can't get a per-segment road-type breakdown, but we
// can still make each travel mode visually distinct on the map.
export const PROFILE_COLORS = {
  "driving-car": "#2563eb",
  "foot-walking": "#db2777",
  "foot-hiking": "#9333ea",
  "cycling-regular": "#16a34a",
  "dog-walking": "#ea580c",
};

export function getOrsKey() {
  try {
    return localStorage.getItem(ORS_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

export function setOrsKey(key) {
  try {
    if (key) localStorage.setItem(ORS_KEY_STORAGE, key);
    else localStorage.removeItem(ORS_KEY_STORAGE);
  } catch {
    // localStorage unavailable (private mode etc) -- key just won't persist.
  }
}

// ---------- User-customizable colors ----------
// Overrides layer on top of WAYTYPE_STYLES / PROFILE_COLORS defaults, stored
// as { waytype: {id: color}, profile: {profileKey: color} }. Never mutates
// the exported default objects above -- callers read through the getters.

function loadColorOverrides() {
  try {
    return JSON.parse(localStorage.getItem(COLOR_OVERRIDES_STORAGE)) || { waytype: {}, profile: {} };
  } catch {
    return { waytype: {}, profile: {} };
  }
}

function saveColorOverrides(overrides) {
  try {
    localStorage.setItem(COLOR_OVERRIDES_STORAGE, JSON.stringify(overrides));
  } catch {
    // localStorage unavailable -- overrides just won't persist.
  }
}

export function getWaytypeColor(waytypeId) {
  const overrides = loadColorOverrides();
  return overrides.waytype?.[waytypeId] || WAYTYPE_STYLES[waytypeId]?.color || DEFAULT_ROUTE_COLOR;
}

export function setWaytypeColor(waytypeId, color) {
  const overrides = loadColorOverrides();
  overrides.waytype = overrides.waytype || {};
  overrides.waytype[waytypeId] = color;
  saveColorOverrides(overrides);
}

export function getProfileColor(profile) {
  const overrides = loadColorOverrides();
  return overrides.profile?.[profile] || PROFILE_COLORS[profile] || DEFAULT_ROUTE_COLOR;
}

export function setProfileColor(profile, color) {
  const overrides = loadColorOverrides();
  overrides.profile = overrides.profile || {};
  overrides.profile[profile] = color;
  saveColorOverrides(overrides);
}

export function resetColorOverrides() {
  saveColorOverrides({ waytype: {}, profile: {} });
}
