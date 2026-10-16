import { initGlobe, getGlobeCenter } from "./globe.js?v=1.2.13";
import { Planner, profileHint } from "./planner.js?v=1.2.13";
import { renderStats } from "./stats.js?v=1.2.13";
import {
  encodeRouteToHash,
  decodeRouteFromHash,
  buildShareUrl,
  createShortLink,
  resolveShortLink,
  downloadBlob,
  buildGpx,
} from "./share.js?v=1.2.13";
import { openStreetLevelView } from "./streetview.js?v=1.2.13";
import { searchPlaces, reverseAreaName } from "./geocode.js?v=1.2.13";
import {
  getOrsKey,
  setOrsKey,
  PROFILE_LABELS,
  PROFILE_COLORS,
  WAYTYPE_STYLES,
  getProfileColor,
  setProfileColor,
  getWaytypeColor,
  setWaytypeColor,
  resetColorOverrides,
} from "./config.js?v=1.2.13";

const els = {
  modeGlobe: document.getElementById("mode-globe"),
  modePlanner: document.getElementById("mode-planner"),
  viewGlobe: document.getElementById("view-globe"),
  viewPlanner: document.getElementById("view-planner"),
  useHereBtn: document.getElementById("use-here-btn"),

  profileSelect: document.getElementById("profile-select"),
  profileHint: document.getElementById("profile-hint"),
  undoBtn: document.getElementById("undo-point-btn"),
  clearBtn: document.getElementById("clear-route-btn"),

  statsBlock: document.getElementById("stats-block"),
  actionsBlock: document.getElementById("actions-block"),
  statDistance: document.getElementById("stat-distance"),
  statDuration: document.getElementById("stat-duration"),
  statElevationRow: document.getElementById("stat-elevation-row"),
  statElevation: document.getElementById("stat-elevation"),
  waytypeBreakdown: document.getElementById("waytype-breakdown"),

  screenshotBtn: document.getElementById("screenshot-btn"),
  gpxBtn: document.getElementById("gpx-btn"),
  streetviewBtn: document.getElementById("streetview-btn"),
  shareLink: document.getElementById("share-link"),
  copyLinkBtn: document.getElementById("copy-link-btn"),
  shortenBtn: document.getElementById("shorten-btn"),
  shareStatus: document.getElementById("share-status"),

  settingsBtn: document.getElementById("settings-btn"),
  settingsModal: document.getElementById("settings-modal"),
  orsKeyInput: document.getElementById("ors-key-input"),
  saveKeyBtn: document.getElementById("save-key-btn"),
  closeSettingsBtn: document.getElementById("close-settings-btn"),
  profileColorList: document.getElementById("profile-color-list"),
  waytypeColorList: document.getElementById("waytype-color-list"),
  resetColorsBtn: document.getElementById("reset-colors-btn"),
  colorPickerBtn: document.getElementById("color-picker-btn"),
  colorPickerDot: document.getElementById("color-picker-dot"),
  colorSwatches: document.getElementById("color-swatches"),
  drawModeBtn: document.getElementById("draw-mode-btn"),
  undoFabBtn: document.getElementById("undo-fab-btn"),
  resetFabBtn: document.getElementById("reset-fab-btn"),

  placeSearchInput: document.getElementById("place-search-input"),
  placeSearchBtn: document.getElementById("place-search-btn"),
  placeSearchResults: document.getElementById("place-search-results"),

  panUpBtn: document.getElementById("pan-up-btn"),
  panDownBtn: document.getElementById("pan-down-btn"),
  panLeftBtn: document.getElementById("pan-left-btn"),
  panRightBtn: document.getElementById("pan-right-btn"),
};

// ---------- Mode switching ----------
function setMode(mode) {
  const isGlobe = mode === "globe";
  els.viewGlobe.classList.toggle("active", isGlobe);
  els.viewPlanner.classList.toggle("active", !isGlobe);
  els.modeGlobe.classList.toggle("active", isGlobe);
  els.modePlanner.classList.toggle("active", !isGlobe);
  els.modeGlobe.setAttribute("aria-selected", String(isGlobe));
  els.modePlanner.setAttribute("aria-selected", String(!isGlobe));
  if (!isGlobe) setTimeout(() => planner.map.resize(), 50);
  else if (globeMap) setTimeout(() => globeMap.resize(), 50);
}
els.modeGlobe.addEventListener("click", () => setMode("globe"));
els.modePlanner.addEventListener("click", () => setMode("planner"));

// ---------- Globe view ----------
// Isolated in its own try/catch: if the globe library fails to load (flaky
// network, ad blocker, offline CDN) the route planner -- the core feature --
// must still work.
let globeMap = null;
try {
  globeMap = initGlobe("globe-map");
  els.useHereBtn.addEventListener("click", () => {
    const [lat, lng] = getGlobeCenter(globeMap);
    setMode("planner");
    planner.setView([lat, lng], 15);
  });
} catch (err) {
  console.error("Globe view failed to initialize:", err);
  els.viewGlobe.innerHTML =
    '<div class="globe-hint" style="position:static;margin:40px auto;max-width:420px;text-align:center">' +
    "The globe view couldn't load (probably a network hiccup fetching MapLibre). " +
    'The Route Planner still works -- <button id="fallback-to-planner" class="link-btn">open it</button>.</div>';
  document.getElementById("fallback-to-planner")?.addEventListener("click", () => setMode("planner"));
}

// ---------- Planner view ----------
function updateShareLink() {
  const state = planner.getState();
  if (!state.result) {
    els.shareLink.value = "";
    return;
  }
  // Deliberately does NOT touch the browser's address bar (no
  // history.replaceState) -- the whole route used to get written into the
  // URL hash on every single change, which meant reloading the page (or
  // even just fully editing a route) auto-restored whatever was drawn last
  // session. The planner should always start blank on a fresh load; the
  // link below is purely for deliberately sharing this specific route.
  encodeRouteToHash({ v: 1, profile: state.profile, waypoints: state.waypoints, result: state.result }).then(
    (payload) => {
      els.shareLink.value = buildShareUrl(payload);
    }
  );
}

const planner = new Planner("planner-map", {
  onRouteChange: (result) => {
    renderStats(result, els);
    els.undoBtn.disabled = planner.waypoints.length === 0;
    els.clearBtn.disabled = planner.waypoints.length === 0;
    els.shareStatus.textContent = "";
    updateShareLink();
  },
  onRouteError: (msg) => {
    els.shareStatus.textContent = "";
    alert(`Couldn't compute that route: ${msg}`);
  },
  onBusyChange: (busy) => {
    document.body.style.cursor = busy ? "progress" : "";
  },
});

function refreshProfileHint() {
  els.profileHint.textContent = profileHint(els.profileSelect.value, Boolean(getOrsKey()));
}
refreshProfileHint();

// ---------- Live pointer coordinates ----------
// Shows the exact latitude/longitude under the mouse (or finger) as it moves
// over the map; click/tap the readout to copy "lat, lng".
(function wireCoordinateReadout() {
  const box = document.getElementById("map-coords");
  const latEl = document.getElementById("coord-lat");
  const lngEl = document.getElementById("coord-lng");
  box.classList.add("idle");
  let last = null;
  let queued = false;

  const show = () => {
    queued = false;
    if (!last) return;
    latEl.textContent = last.lat.toFixed(6);
    lngEl.textContent = last.lng.toFixed(6);
    box.classList.remove("idle");
  };

  planner.whenReady().then(() => {
    const container = planner.map.getContainer();
    container.addEventListener("pointermove", (e) => {
      const rect = container.getBoundingClientRect();
      const { lat, lng } = planner.map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      last = { lat, lng: ((((lng + 180) % 360) + 360) % 360) - 180 }; // wrap if the world is panned past the antimeridian
      if (!queued) {
        queued = true;
        requestAnimationFrame(show);
      }
    });
  });

  box.addEventListener("click", async () => {
    if (!last) return;
    const text = `${last.lat.toFixed(6)}, ${last.lng.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(text);
      els.shareStatus.textContent = `Copied ${text}`;
    } catch {
      els.shareStatus.textContent = `Coordinates: ${text}`;
    }
  });
})();

// Exposed for debugging/automated tests (console, Playwright). Not used by
// the app itself.
window.mapmyroute = { planner };

els.profileSelect.addEventListener("change", () => {
  planner.setProfile(els.profileSelect.value);
  refreshProfileHint();
  refreshColorDot();
});

els.undoBtn.addEventListener("click", () => planner.undo());
els.clearBtn.addEventListener("click", () => planner.clear());

// ---------- Floating on-map controls (color / undo / reset) ----------
// A quick-access preset palette -- click the dot to expand these above it,
// pick one, and it collapses back down to save map space. Full custom colors
// still live in Settings.
const QUICK_COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c"];

function refreshColorDot() {
  els.colorPickerDot.style.background = getProfileColor(planner.profile);
}
refreshColorDot();

function closeColorSwatches() {
  els.colorSwatches.hidden = true;
  els.colorSwatches.innerHTML = "";
}

els.colorPickerBtn.addEventListener("click", () => {
  if (!els.colorSwatches.hidden) {
    closeColorSwatches();
    return;
  }
  els.colorSwatches.innerHTML = "";
  for (const color of QUICK_COLORS) {
    const btn = document.createElement("button");
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener("click", () => {
      setProfileColor(planner.profile, color);
      refreshColorDot();
      closeColorSwatches();
      planner.refresh();
    });
    els.colorSwatches.appendChild(btn);
  }
  els.colorSwatches.hidden = false;
});

// ---------- Draw mode toggle ----------
// Off by default -- one-finger/left-drag just pans, like every other map.
// Only while this is on does dragging draw a route instead.
els.drawModeBtn.addEventListener("click", async () => {
  const enabled = !planner.drawMode;
  els.drawModeBtn.disabled = enabled;
  const active = await planner.setDrawMode(enabled);
  els.drawModeBtn.disabled = false;
  els.drawModeBtn.classList.toggle("active", active);

  if (enabled && !active) {
    els.drawModeBtn.title = planner.map.getZoom() < 3
      ? "Zoom in closer to a road or path before drawing"
      : "Road data is not available yet - try again in a moment";
    return;
  }
  els.drawModeBtn.title = active ? "Turn off draw mode" : "Toggle draw mode";
});

els.undoFabBtn.addEventListener("click", () => planner.undo());
els.resetFabBtn.addEventListener("click", () => planner.clear());

// ---------- Pan buttons ----------
// A discoverable, always-visible way to pan now that left-drag draws
// instead -- right-click-drag/two-finger-drag work too, but aren't obvious.
const PAN_PX = 120;
els.panUpBtn.addEventListener("click", () => planner.map.panBy([0, -PAN_PX]));
els.panDownBtn.addEventListener("click", () => planner.map.panBy([0, PAN_PX]));
els.panLeftBtn.addEventListener("click", () => planner.map.panBy([-PAN_PX, 0]));
els.panRightBtn.addEventListener("click", () => planner.map.panBy([PAN_PX, 0]));

// ---------- Place search (name, postcode, address, road...) ----------
function closeSearchResults() {
  els.placeSearchResults.hidden = true;
  els.placeSearchResults.innerHTML = "";
}

function goToPlace(place) {
  if (place.bounds) {
    // place.bounds is [[south,west],[north,east]]; MapLibre wants
    // [[west,south],[east,north]] and a plain number for uniform padding.
    const [[south, west], [north, east]] = place.bounds;
    planner.map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 40 }
    );
  } else {
    planner.setView([place.lat, place.lon], 16);
  }
  closeSearchResults();
}

async function runSearch() {
  const query = els.placeSearchInput.value.trim();
  if (!query) return;
  try {
    const results = await searchPlaces(query);
    if (!results.length) {
      els.placeSearchResults.innerHTML = '<li class="tiny-hint">No matches found.</li>';
      els.placeSearchResults.hidden = false;
      return;
    }
    if (results.length === 1) {
      goToPlace(results[0]);
      return;
    }
    els.placeSearchResults.innerHTML = "";
    for (const place of results) {
      const li = document.createElement("li");
      li.textContent = place.label;
      li.addEventListener("click", () => goToPlace(place));
      els.placeSearchResults.appendChild(li);
    }
    els.placeSearchResults.hidden = false;
  } catch (err) {
    els.placeSearchResults.innerHTML = `<li class="tiny-hint">Search failed: ${err.message || err}</li>`;
    els.placeSearchResults.hidden = false;
  }
}

els.placeSearchBtn.addEventListener("click", runSearch);
els.placeSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
  if (e.key === "Escape") closeSearchResults();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".map-search")) closeSearchResults();
});

// ---------- Start zoomed into the user's actual location ----------
// Without this the planner opens at zoom 6 (whole country) and the globe at
// zoom 1.5 (whole world) -- useless for actually drawing a route until you
// manually zoom/pan in. A shared link overrides this once it loads (below).
const geoStatus = document.getElementById("geo-status");
const geoStatusText = document.getElementById("geo-status-text");
document.getElementById("geo-retry-btn")?.addEventListener("click", () => locateMe());
document.getElementById("geo-dismiss-btn")?.addEventListener("click", () => (geoStatus.hidden = true));

function showGeoStatus(message, { retry = true } = {}) {
  geoStatusText.textContent = message;
  document.getElementById("geo-retry-btn").hidden = !retry;
  geoStatus.hidden = false;
}

function geoErrorMessage(err) {
  // GeolocationPositionError codes: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
  if (err.code === 1) {
    return "Location access was blocked -- allow it in your browser's site settings, then try again.";
  }
  if (err.code === 3) {
    return "Location is still unavailable after trying GPS and Wi-Fi. Try again, or pan/zoom in manually.";
  }
  return "Couldn't get your location (GPS/network issue). Try again, or pan/zoom in manually.";
}

function locateMe() {
  if (!navigator.geolocation) {
    showGeoStatus("This browser doesn't support geolocation -- pan/zoom in manually.");
    return;
  }
  if (!window.isSecureContext) {
    showGeoStatus("Location needs a secure (HTTPS) connection -- this page isn't loaded over HTTPS, so the browser blocks it.");
    return;
  }

  // A fresh high-accuracy fix can take longer than a few seconds on mobile,
  // even when Wi-Fi reception is excellent. Try a recent cached fix first,
  // then allow GPS more time, and finally fall back to network/Wi-Fi location
  // before telling the user that location failed.
  const attempts = [
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 },
    { enableHighAccuracy: false, timeout: 30000, maximumAge: 600000 },
  ];

  const applyPosition = (pos) => {
    const { latitude, longitude } = pos.coords;
    planner.setView([latitude, longitude], 16);
    if (globeMap) globeMap.jumpTo({ center: [longitude, latitude], zoom: 12 });
    geoStatus.hidden = true;
  };

  const tryPosition = (attemptIndex) => {
    showGeoStatus(attemptIndex === 0 ? "Finding your location..." : "GPS is taking a moment -- trying Wi-Fi/network location...");
    navigator.geolocation.getCurrentPosition(
      applyPosition,
      (err) => {
        // Permission denied is definitive. Timeout/unavailable can be caused
        // by a slow mobile GPS provider, so retry with the more reliable
        // network-based provider before showing an error.
        if (err.code !== 1 && attemptIndex < attempts.length - 1) {
          tryPosition(attemptIndex + 1);
          return;
        }
        showGeoStatus(geoErrorMessage(err));
      },
      attempts[attemptIndex]
    );
  };

  tryPosition(0);
}

const hasSharedRoute = /^#r=/.test(window.location.hash) || new URLSearchParams(window.location.search).has("s");
if (!hasSharedRoute) locateMe();

// ---------- Sidebar actions ----------
/** "Rodney Road" -> "Rodney-Road": keep file names portable. */
function fileSafe(text) {
  return text.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40);
}

function timestampForFilename(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

/** MapLibre's WebGL canvas is cleared as soon as a frame is presented unless
 *  the context was created with preserveDrawingBuffer -- and MapLibre 5
 *  ignores the old top-level `preserveDrawingBuffer` option, so reading the
 *  canvas later (toBlob) returned solid black. Copy it into a 2D canvas
 *  *inside* a render event, while the frame is still valid; that works
 *  whatever the context attributes are. The Start/Finish pins are DOM
 *  elements, so they're drawn on, along with the map-data credit that
 *  OpenStreetMap's licence requires on a copy of the map. */
function captureMapCanvas(map, markers) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Map did not render in time")), 5000);
    map.once("render", () => {
      try {
        clearTimeout(timer);
        const gl = map.getCanvas();
        const out = document.createElement("canvas");
        out.width = gl.width;
        out.height = gl.height;
        const ctx = out.getContext("2d");
        ctx.drawImage(gl, 0, 0);

        const scale = gl.width / gl.clientWidth;
        const pins = [["#22c55e", markers[0]], ["#ef4444", markers[1]]];
        for (const [color, marker] of pins) {
          if (!marker) continue;
          const pt = map.project(marker.getLngLat());
          ctx.beginPath();
          ctx.arc(pt.x * scale, pt.y * scale, 9 * scale, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 2.5 * scale;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        }

        const credit = "Map My Route  |  \u00A9 OpenStreetMap contributors, OpenFreeMap, OpenMapTiles";
        const fontPx = Math.round(12 * scale);
        ctx.font = `${fontPx}px system-ui, sans-serif`;
        const barH = Math.round(fontPx * 1.9);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(0, out.height - barH, out.width, barH);
        ctx.fillStyle = "#111827";
        ctx.textBaseline = "middle";
        ctx.fillText(credit, Math.round(fontPx * 0.6), out.height - barH / 2);

        out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Capture produced no image"))), "image/png");
      } catch (err) {
        reject(err);
      }
    });
    map.triggerRepaint();
  });
}

els.screenshotBtn.addEventListener("click", async () => {
  els.shareStatus.textContent = "Capturing screenshot...";
  try {
    const [blob, area] = await Promise.all([
      captureMapCanvas(planner.map, planner.markers),
      (async () => {
        const start = planner.waypoints[0];
        return start ? reverseAreaName(start[0], start[1]) : "";
      })(),
    ]);
    const name = ["MapMyRoute", timestampForFilename(), fileSafe(area)].filter(Boolean).join("_");
    downloadBlob(blob, `${name}.png`);
    els.shareStatus.textContent = `Screenshot saved as ${name}.png`;
  } catch (err) {
    console.error("Screenshot failed:", err);
    els.shareStatus.textContent = `Couldn't capture the map (${err.message || err}). Use your OS screenshot tool (Win+Shift+S / Cmd+Shift+4) instead.`;
  }
});

els.gpxBtn.addEventListener("click", () => {
  const state = planner.getState();
  if (!state.result) return;
  const gpx = buildGpx(state.result.coords);
  downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), "map-my-route.gpx");
});

els.streetviewBtn.addEventListener("click", () => {
  const state = planner.getState();
  const point = state.waypoints[0] || [planner.map.getCenter().lat, planner.map.getCenter().lng];
  openStreetLevelView(point[0], point[1]);
});

els.copyLinkBtn.addEventListener("click", async () => {
  if (!els.shareLink.value) return;
  try {
    await navigator.clipboard.writeText(els.shareLink.value);
    els.shareStatus.textContent = "Link copied to clipboard.";
  } catch {
    els.shareLink.select();
    document.execCommand("copy");
    els.shareStatus.textContent = "Link copied.";
  }
});

els.shortenBtn.addEventListener("click", async () => {
  const match = els.shareLink.value.match(/#r=(.+)$/);
  if (!match) {
    els.shareStatus.textContent = "This link is already short.";
    return;
  }
  els.shortenBtn.disabled = true;
  els.shareStatus.textContent = "Shortening...";
  try {
    els.shareLink.value = await createShortLink(match[1]);
    els.shareStatus.textContent = "Short link ready -- copy it and share it.";
  } catch (err) {
    console.error("Shortening failed:", err);
    els.shareStatus.textContent = `Couldn't make a short link (${err.message || err}). The full link above still works -- copy that instead.`;
  } finally {
    els.shortenBtn.disabled = false;
  }
});

// ---------- Settings modal ----------
function renderColorLists() {
  els.profileColorList.innerHTML = "";
  for (const profile of Object.keys(PROFILE_COLORS)) {
    const li = document.createElement("li");
    li.innerHTML = `
      <input type="color" value="${getProfileColor(profile)}" data-profile="${profile}" />
      <span>${PROFILE_LABELS[profile] || profile}</span>
    `;
    li.querySelector("input").addEventListener("input", (e) => {
      setProfileColor(profile, e.target.value);
      refreshColorDot();
      planner.refresh();
    });
    els.profileColorList.appendChild(li);
  }

  els.waytypeColorList.innerHTML = "";
  for (const [id, style] of Object.entries(WAYTYPE_STYLES)) {
    const li = document.createElement("li");
    li.innerHTML = `
      <input type="color" value="${getWaytypeColor(id)}" data-waytype="${id}" />
      <span>${style.label}</span>
    `;
    li.querySelector("input").addEventListener("input", (e) => {
      setWaytypeColor(id, e.target.value);
      planner.refresh();
    });
    els.waytypeColorList.appendChild(li);
  }
}

function openSettings() {
  els.orsKeyInput.value = getOrsKey();
  renderColorLists();
  els.settingsModal.hidden = false;
}
els.settingsBtn.addEventListener("click", openSettings);
els.closeSettingsBtn.addEventListener("click", () => (els.settingsModal.hidden = true));
els.saveKeyBtn.addEventListener("click", () => {
  setOrsKey(els.orsKeyInput.value.trim());
  els.settingsModal.hidden = true;
  refreshProfileHint();
});
els.resetColorsBtn.addEventListener("click", () => {
  resetColorOverrides();
  renderColorLists();
  refreshColorDot();
  planner.refresh();
});

// ---------- Load a shared route from the URL, if present ----------
(async function loadSharedRoute() {
  try {
    let payload = window.location.hash.replace(/^#/, "").match(/^r=(.+)$/)?.[1] || null;
    let state = null;
    const shortId = new URLSearchParams(window.location.search).get("s");
    if (!payload && shortId) {
      const resolved = await resolveShortLink(shortId);
      if (resolved.json) state = JSON.parse(resolved.json);
      else payload = resolved.payload;
    }
    if (!state && payload) state = await decodeRouteFromHash(payload);
    if (!state) return;
    els.profileSelect.value = state.profile;
    setMode("planner");
    await planner.whenReady(); // the map's route/marker layers might not exist yet this early
    planner.loadPrecomputed(state.profile, state.waypoints, state.result);
    els.undoBtn.disabled = false;
    els.clearBtn.disabled = false;
    refreshProfileHint();
    refreshColorDot();
  } catch (err) {
    console.error("Failed to load shared route:", err);
    // Visible on every screen size -- the sidebar status line is below the
    // fold on phones, which made a failed load look like "nothing happened".
    showGeoStatus(`Couldn't open that shared route: ${err.message || err}`, { retry: false });
  }
})();
