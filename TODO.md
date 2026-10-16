# Map My Route — TODO

Last updated 16-10-2026 (current version: v1.2.26). Every item below is done; the only leftovers are the optional ideas in "Still open".

## Bugs

1. ~~Screenshot saves a black image~~ — FIXED in v1.2.9 (see Done).
2. ~~Link shortening blocked by CORS~~ — FIXED in v1.2.9 (see Done).
3. ~~"Couldn't look up road/path types… very long route"~~ — FIXED in v1.2.9 (see Done).

## Removals / changes

4. ~~Remove Street View~~ — DONE v1.2.17 (button, handler and import removed; the now-unused `js/streetview.js` file was left in place because deleting files under /var is blocked by policy — delete it when you're happy).
5. ~~Start/finish photos~~ — DONE v1.2.20, switched to key-less KartaView + Wikimedia Commons in v1.2.22. Google dropped (needs an API key).

## New features

6. ~~Save up to 5 routes~~ — DONE v1.2.18 (see Done). Open idea: rename saved routes.
7. ~~GPX export~~ — DONE v1.2.19 (see Done).

## Housekeeping

8. ~~Mobile layout~~ — DONE v1.2.16, polished in v1.2.21 and v1.2.26.
9. ~~`origin/main` behind `live`~~ — fast-forwarded `main` to `live` (v1.2.21). Day-to-day work still happens on `live`.
10. RULE: every update ships under a new version number (`./bump-version.sh`); the pre-commit hook enforces it.
11. Test every feature end-to-end (screenshot, share, GPX, stats) after each change, not just drawing.

## Still open (optional)

- Rename saved routes (names are "Route 1", "Route 2"...).
- Delete the unused `js/streetview.js` (left in place: deleting under /var needs your OK).
- Test on a real phone (everything so far was checked in a desktop browser and a phone emulator).
- Overpass (road-type fallback for tap-to-tap routes through never-viewed areas) is flaky and can fail.

## Done

- v1.2.26: search box and live lat/lng moved off the map into the top bar on every screen size (brand | lat/lng | search ... tabs | settings; labels trim at ≤1180px; phones keep their compact row). Header no longer wraps. (v1.2.24/25 were intermediate builds of this.)

- v1.2.23: start/finish photos are now mini thumbnails (up to 3 per end, nearest first) that open in an in-page viewer (arrows / Esc / click outside to close). No link back to KartaView anywhere; Commons photos keep a small licence/details link inside the viewer only.

- v1.2.22: start/finish photos now use KartaView street-level imagery first (free, no key; photos taken from the road, often within metres) and fall back to Wikimedia Commons. The Google Street View code and Settings key field were removed. Mapillary was ruled out (needs a token).

- v1.2.21: README rewritten to match the app (was describing Leaflet/html2canvas/TinyURL); stats show "<1 min"; smaller location-blocked pop-up on phones.

- v1.2.20: "Photos of start & finish" button — shows the nearest openly-licensed photo (Wikimedia Commons / Geograph, with distance, author, licence and a details link) for each end, on the page, loaded on demand; clears when the route changes; clear message if the lookup fails. Optional Google Maps API key in Settings switches to Google Street View where Google has coverage, falling back to Commons (that Google path has not been tested — needs a real key).

- v1.2.19: GPX export checked and improved: valid GPX 1.1 (parsed + point count verified), Start/Finish waypoints, timestamp, XML-escaped names, filename `MapMyRoute_<date>_<time>_<area>.gpx`; plus a "What's a GPX file?" panel explaining the benefit and how to open it on Android, iPhone, Garmin and desktop.

- v1.2.18: Saved routes (max 5, in memory only): Save/Update, New route, open any saved route, delete. Saving a 6th shows a styled confirm popup naming the oldest route that will be removed. Unsaved changes prompt (Cancel / without saving / save first). Modal z-index raised above the phone header and sheet.
- v1.2.17: Street View button removed.

- v1.2.16: phone layout — one compact top row (tiny Globe/Route tabs, live lat/lng, search, settings gear; logo + version stacked at the left), and the Route panel is now a bottom sheet (tap the bar to open, tap the map or the bar to close; the collapsed bar shows `Driving · 140 m · <1 min`). Map is full height. Also fixed `Planner.whenReady()` so several callers can wait on it (only the last was released before).

- v1.2.14: short links retyped on a phone failed (server log showed the phone requesting `lzx1NZhb`, lowercase L, for `Izx1NZhb`, capital i). New ids use a no-look-alike lowercase alphabet (10 chars); lookups also accept wrong case / I-l-1 / O-0 mix-ups when the match is unique, so old links keep working.

- v1.2.13: shared/short links on phones: self-healing cache check (`version.json` vs the page's version, one reload max), short links open without needing browser gunzip support, and a failed link open now shows a visible message instead of silently showing the UK.

- v1.2.10: live latitude/longitude readout (top-left of the map; below the search bar on phones) that follows the mouse/finger, click to copy. Also `bump-version.sh` + a pre-commit hook that blocks commits changing app files without a new version.

- v1.2.9:
  - Screenshot: was black because MapLibre 5 ignores `preserveDrawingBuffer`; now copied inside a render event, with Start/Finish pins and the OSM credit drawn on. Saved as `MapMyRoute_YYYY-MM-DD_HH-MM_<Area>.png`.
  - Short links: self-hosted (`api/shorten.php`, `api/route.php`, data in `/var/www/mapmyroute-data`, outside the web root; link form `/?s=<id>`), 40 new links/IP/hour, 600 KB max, expires after 180 days unused. No third party, no CORS.
  - Road/path breakdown: computed locally from loaded road data (instant); falls back to chunked OpenStreetMap lookups when <90% of the route is covered; honest message if neither works.
  - Known limit: Overpass mirrors are flaky and most don't allow browser (CORS) calls, so the fallback can fail.

- v1.2.7: draw mode no longer loses road segments (dedupe by geometry, not vector-tile id; road list frozen per stroke).
- v1.2.8: a new stroke is joined to the route's end along the road network instead of a straight gap.
