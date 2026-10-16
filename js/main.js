import { initGlobe, getGlobeCenter } from "./globe.js?v=1.2.23";
import { Planner, profileHint } from "./planner.js?v=1.2.23";
import { renderStats } from "./stats.js?v=1.2.23";
import {
  encodeRouteToHash,
  decodeRouteFromHash,
  buildShareUrl,
  createShortLink,
  resolveShortLink,
  downloadBlob,
  buildGpx,
} from "./share.js?v=1.2.23";
import { searchPlaces, reverseAreaName } from "./geocode.js?v=1.2.23";
import { findPhotos } from "./photos.js?v=1.2.23";
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
} from "./config.js?v=1.2.23";

const els = {
  modeGlobe: document.getElementById("mode-globe"),
  modePlanner: document.getElementById("mode-planner"),
  viewGlobe: document.getElementById("view-globe"),
  viewPlanner: document.getElementById("view-planner"),
  useHereBtn: document.getElementById("use-here-btn"),

  profileSelect: document.getElementById("profile-select"),
  profileHint: document.getElementById("profile-hint"),
  photosBtn: document.getElementById("photos-btn"),
  photosGrid: document.getElementById("photos-grid"),
  saveRouteBtn: document.getElementById("save-route-btn"),
  newRouteBtn: document.getElementById("new-route-btn"),
  savedList: document.getElementById("saved-list"),
  savedCount: document.getElementById("saved-count"),
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
  document.body.classList.toggle("globe-view", isGlobe);
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
    window.updateSheetSummary?.(result);
    if (!result || routeSignature() !== photosForSignature) {
      clearPhotos();
      photosForSignature = routeSignature();
    }
    // Only a real change to the route counts as an edit (not a stats refresh).
    if (!restoringRoute && routeSignature() !== savedSignature) routeDirty = true;
    // Clearing/undoing everything detaches the map from its saved slot, so the
    // next route drawn can't silently overwrite it.
    if (!restoringRoute && planner.legs.length === 0 && !planner.pendingStart) {
      currentSavedId = null;
      routeDirty = false;
    }
    renderSavedRoutes();
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

// ---------- Start / finish photos ----------
/** Enlarged photo in an in-page viewer (Esc / click outside / x to close,
 *  arrows to flip through that end's photos). Never links to KartaView. */
function openPhotoViewer(label, photos, startIndex) {
  let i = startIndex;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop photo-viewer";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", `${label} photo`);
  const frame = document.createElement("div");
  frame.className = "photo-viewer-frame";
  const img = document.createElement("img");
  img.referrerPolicy = "no-referrer";
  const cap = document.createElement("div");
  cap.className = "photo-viewer-caption";
  const mk = (cls, text, aria, fn) => {
    const b = document.createElement("button");
    b.className = cls;
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-label", aria);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  };
  const show = (n) => {
    i = (n + photos.length) % photos.length;
    const p = photos[i];
    img.src = p.src;
    img.alt = `${label}: ${p.title}`;
    cap.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = label;
    cap.append(strong, ` \u00B7 ${p.title} \u00B7 ${p.distanceM < 15 ? "at this spot" : `${Math.round(p.distanceM)} m away`}`
      + (photos.length > 1 ? ` \u00B7 ${i + 1} of ${photos.length}` : ""));
    const credit = document.createElement("div");
    credit.className = "photo-viewer-credit";
    credit.append(`${p.source}${p.credit ? ` \u2014 ${p.credit}` : ""}`);
    if (p.pageUrl) {
      credit.append(" \u00B7 ");
      const a = document.createElement("a");
      a.href = p.pageUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "licence & details";
      credit.append(a);
    }
    cap.append(credit);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" && photos.length > 1) show(i + 1);
    else if (e.key === "ArrowLeft" && photos.length > 1) show(i - 1);
  };
  frame.append(img, cap, mk("photo-viewer-close", "\u00D7", "Close photo", close));
  if (photos.length > 1) {
    frame.append(mk("photo-viewer-nav prev", "\u2039", "Previous photo", () => show(i - 1)), mk("photo-viewer-nav next", "\u203A", "Next photo", () => show(i + 1)));
  }
  backdrop.append(frame);
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  show(i);
}

function photoRow(label, photos, error) {
  const row = document.createElement("div");
  row.className = "photo-row";
  const head = document.createElement("div");
  head.className = "photo-row-label";
  head.textContent = label;
  row.append(head);
  if (!photos.length) {
    const msg = document.createElement("div");
    msg.className = "photo-empty";
    msg.textContent = error ? `Couldn't load photos (${error}).` : "No photos found near here.";
    row.append(msg);
    return row;
  }
  const strip = document.createElement("div");
  strip.className = "photo-strip";
  photos.forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "photo-thumb";
    b.title = `${p.title} \u2014 click to enlarge`;
    b.setAttribute("aria-label", `Enlarge ${label} photo ${i + 1}: ${p.title}`);
    const img = document.createElement("img");
    img.src = p.thumb;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    b.append(img);
    b.addEventListener("click", () => openPhotoViewer(label, photos, i));
    strip.append(b);
  });
  row.append(strip);
  const note = document.createElement("div");
  note.className = "photo-note";
  note.textContent = `${photos[0].source} \u00B7 tap a photo to enlarge`;
  row.append(note);
  return row;
}

function clearPhotos() {
  els.photosGrid.hidden = true;
  els.photosGrid.replaceChildren();
  els.photosBtn.disabled = false;
}

els.photosBtn.addEventListener("click", async () => {
  const state = planner.getState();
  const start = state.waypoints[0];
  const end = state.waypoints[1] || state.waypoints[0];
  if (!start) return;
  els.photosBtn.disabled = true;
  els.photosGrid.hidden = false;
  els.photosGrid.replaceChildren(Object.assign(document.createElement("div"), { className: "photo-empty tiny-hint", textContent: "Looking for photos..." }));
  const lookup = async (pt) => {
    try {
      return { photos: await findPhotos(pt[0], pt[1], 3) };
    } catch (err) {
      return { photos: [], error: err.message || String(err) };
    }
  };
  const [a, b] = await Promise.all([lookup(start), lookup(end)]);
  els.photosGrid.replaceChildren(photoRow("Start", a.photos, a.error), photoRow("Finish", b.photos, b.error));
  els.photosBtn.disabled = false;
});

// ---------- In-page confirm dialog ----------
/** Styled modal (not window.confirm -- that looks wrong on phones and can be
 *  suppressed). buttons: [{ label, value, primary }]. Resolves with the chosen
 *  value, or null if dismissed (Esc / backdrop). */
function confirmDialog({ title, message, buttons }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    const modal = document.createElement("div");
    modal.className = "modal";
    const h = document.createElement("h2");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = message;
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const done = (value) => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(null);
    };
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.className = b.primary ? "primary-btn" : "secondary-btn";
      btn.textContent = b.label;
      btn.addEventListener("click", () => done(b.value));
      actions.append(btn);
    }
    modal.append(h, p, actions);
    backdrop.append(modal);
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop) done(null);
    });
    document.addEventListener("keydown", onKey);
    document.body.append(backdrop);
    actions.lastElementChild?.focus();
  });
}

// ---------- Saved routes (in memory only, max 5) ----------
const MAX_SAVED = 5;
const saved = []; // oldest first: { id, name, savedAt, snap }
let savedCounter = 0;
let currentSavedId = null; // which saved slot the route on screen came from
let routeDirty = false; // changed since it was last saved/loaded?
let restoringRoute = false;
let photosForSignature = "";
let savedSignature = ""; // fingerprint of the route as last saved/loaded, to tell real edits from stats refreshes

function hasUnsavedRoute() {
  const hasRoute = planner.legs.length > 0 || Boolean(planner.pendingStart);
  return hasRoute && (routeDirty || currentSavedId === null);
}

function routeSignature() {
  const all = planner._fullCoords();
  const last = all[all.length - 1] || planner.pendingStart || [];
  return `${planner.legs.length}|${all.length}|${last.join(",")}|${planner.profile}`;
}

function describeSaved(entry) {
  const km = entry.snap.distanceM >= 1000 ? `${(entry.snap.distanceM / 1000).toFixed(2)} km` : `${Math.round(entry.snap.distanceM)} m`;
  const t = entry.savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { km, t };
}

function renderSavedRoutes() {
  const hasRoute = planner.legs.length > 0 || Boolean(planner.pendingStart);
  els.saveRouteBtn.disabled = !hasRoute || (currentSavedId !== null && !routeDirty);
  els.saveRouteBtn.textContent = currentSavedId !== null ? "Update saved route" : "Save this route";
  els.newRouteBtn.disabled = !hasRoute;
  els.savedCount.textContent = `(${saved.length} of ${MAX_SAVED})`;
  els.savedList.innerHTML = "";
  for (const entry of saved) {
    const { km, t } = describeSaved(entry);
    const li = document.createElement("li");
    li.className = "saved-item" + (entry.id === currentSavedId ? " current" : "");
    const load = document.createElement("button");
    load.className = "saved-load";
    load.innerHTML = `${entry.name}<small>${PROFILE_LABELS[entry.snap.profile] || ""} &middot; ${km} &middot; saved ${t}${entry.id === currentSavedId ? " &middot; open now" : ""}</small>`;
    load.addEventListener("click", () => openSavedRoute(entry.id));
    const del = document.createElement("button");
    del.className = "saved-del";
    del.title = "Delete this saved route";
    del.setAttribute("aria-label", `Delete ${entry.name}`);
    del.textContent = "\u00D7";
    del.addEventListener("click", () => deleteSavedRoute(entry.id));
    li.append(load, del);
    els.savedList.append(li);
  }
}

function applyRoute(snap, id) {
  restoringRoute = true;
  try {
    planner.restore(snap);
    els.profileSelect.value = snap.profile;
    currentSavedId = id;
    routeDirty = false;
    savedSignature = routeSignature();
    refreshProfileHint();
    refreshColorDot();
  } finally {
    restoringRoute = false;
  }
  renderSavedRoutes();
}

async function saveCurrentRoute() {
  const snap = planner.snapshot();
  if (currentSavedId !== null) {
    const entry = saved.find((e) => e.id === currentSavedId);
    if (entry) {
      entry.snap = snap;
      entry.savedAt = new Date();
      routeDirty = false;
      savedSignature = routeSignature();
      renderSavedRoutes();
      els.shareStatus.textContent = `Updated "${entry.name}".`;
      return true;
    }
  }
  if (saved.length >= MAX_SAVED) {
    const oldest = saved[0];
    const choice = await confirmDialog({
      title: "Saved routes are full",
      message: `You can keep ${MAX_SAVED} routes. Saving this one will remove the oldest, "${oldest.name}" (${describeSaved(oldest).km}). Continue?`,
      buttons: [
        { label: "Cancel", value: "cancel" },
        { label: `Remove "${oldest.name}" and save`, value: "replace", primary: true },
      ],
    });
    if (choice !== "replace") return false;
    saved.shift();
  }
  const entry = { id: ++savedCounter, name: `Route ${savedCounter}`, savedAt: new Date(), snap };
  saved.push(entry);
  currentSavedId = entry.id;
  routeDirty = false;
  savedSignature = routeSignature();
  renderSavedRoutes();
  els.shareStatus.textContent = `Saved as "${entry.name}".`;
  return true;
}

async function startNewRoute() {
  if (hasUnsavedRoute()) {
    const choice = await confirmDialog({
      title: "Start a new route?",
      message: "The route on the map has changes that aren't saved.",
      buttons: [
        { label: "Cancel", value: "cancel" },
        { label: "Start new without saving", value: "discard" },
        { label: "Save, then start new", value: "save", primary: true },
      ],
    });
    if (choice === "save") {
      if (!(await saveCurrentRoute())) return; // the save was cancelled
    } else if (choice !== "discard") {
      return;
    }
  }
  restoringRoute = true;
  planner.clear();
  restoringRoute = false;
  currentSavedId = null;
  routeDirty = false;
  savedSignature = routeSignature();
  renderSavedRoutes();
}

async function openSavedRoute(id) {
  const entry = saved.find((e) => e.id === id);
  if (!entry || id === currentSavedId) return;
  if (hasUnsavedRoute()) {
    const choice = await confirmDialog({
      title: `Open "${entry.name}"?`,
      message: "The route on the map has changes that aren't saved.",
      buttons: [
        { label: "Cancel", value: "cancel" },
        { label: "Open without saving", value: "discard" },
        { label: "Save, then open", value: "save", primary: true },
      ],
    });
    if (choice === "save") {
      if (!(await saveCurrentRoute())) return;
    } else if (choice !== "discard") {
      return;
    }
  }
  const fresh = saved.find((e) => e.id === id); // the list may have changed during a save
  if (fresh) applyRoute(fresh.snap, fresh.id);
}

function deleteSavedRoute(id) {
  const i = saved.findIndex((e) => e.id === id);
  if (i === -1) return;
  const [gone] = saved.splice(i, 1);
  if (currentSavedId === gone.id) currentSavedId = null; // the route on screen stays; it's just no longer a saved slot
  renderSavedRoutes();
  els.shareStatus.textContent = `Deleted "${gone.name}".`;
}

els.saveRouteBtn.addEventListener("click", saveCurrentRoute);
els.newRouteBtn.addEventListener("click", startNewRoute);
renderSavedRoutes();

// ---------- Phone layout: compact header row + bottom sheet ----------
(function wirePhoneLayout() {
  const mq = window.matchMedia("(max-width: 820px)");
  const header = document.querySelector(".app-header");
  const settingsBtn = document.getElementById("settings-btn");
  const coords = document.getElementById("map-coords");
  const search = document.querySelector(".map-search");
  const mapWrap = document.querySelector(".map-wrap");
  const sheet = document.getElementById("route-sheet");
  const handle = document.getElementById("sheet-handle");
  const summary = document.getElementById("sheet-summary");

  // On phones the lat/lng chip and the search box live in the header row, next
  // to the Globe / Route tabs, instead of floating over (and hiding) the map.
  const place = () => {
    if (mq.matches) {
      header.insertBefore(coords, settingsBtn);
      header.insertBefore(search, settingsBtn);
    } else {
      const controls = mapWrap.querySelector(".map-controls");
      mapWrap.insertBefore(coords, controls);
      mapWrap.insertBefore(search, controls);
      setSheet(false);
    }
    planner.map.resize();
  };

  function setSheet(open) {
    sheet.classList.toggle("open", open);
    handle.setAttribute("aria-expanded", String(open));
  }
  handle.addEventListener("click", () => setSheet(!sheet.classList.contains("open")));
  // Touching the map folds the sheet away again -- more map, less fiddling.
  planner.whenReady().then(() => {
    planner.map.getContainer().addEventListener("pointerdown", () => {
      if (mq.matches) setSheet(false);
    });
  });

  // The collapsed handle doubles as a one-line route summary.
  window.updateSheetSummary = (result) => {
    if (!result) {
      summary.textContent = "Draw or tap a route";
      return;
    }
    const km = result.distanceM >= 1000 ? `${(result.distanceM / 1000).toFixed(2)} km` : `${Math.round(result.distanceM)} m`;
    const mins = Math.round(result.durationS / 60);
    const time = mins < 1 ? "<1 min" : mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
    summary.textContent = `${PROFILE_LABELS[planner.profile] || "Route"} \u00B7 ${km} \u00B7 ${time}`;
  };

  mq.addEventListener("change", place);
  place();
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

els.gpxBtn.addEventListener("click", async () => {
  const state = planner.getState();
  if (!state.result) return;
  const km = (state.result.distanceM / 1000).toFixed(2);
  const label = `${PROFILE_LABELS[state.profile] || "Route"} ${km} km`;
  const gpx = buildGpx(state.result.coords, `Map My Route - ${label}`);
  const start = planner.waypoints[0];
  const area = start ? await reverseAreaName(start[0], start[1]) : "";
  const name = ["MapMyRoute", timestampForFilename(), fileSafe(area)].filter(Boolean).join("_");
  downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), `${name}.gpx`);
  els.shareStatus.textContent = `GPX saved as ${name}.gpx -- see "What's a GPX file?" below for how to open it.`;
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
