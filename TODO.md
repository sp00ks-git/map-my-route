# Map My Route — TODO

Last updated 16-10-2026 (current version: v1.2.8). Nothing below has been started unless marked.

## Bugs

1. ~~Screenshot saves a black image~~ — FIXED in v1.2.9 (see Done).
2. ~~Link shortening blocked by CORS~~ — FIXED in v1.2.9 (see Done).
3. ~~"Couldn't look up road/path types… very long route"~~ — FIXED in v1.2.9 (see Done).

## Removals / changes

4. ~~Remove Street View~~ — DONE v1.2.17 (button, handler and import removed; the now-unused `js/streetview.js` file was left in place because deleting files under /var is blocked by policy — delete it when you're happy).
5. **Start/finish photos without leaving the site.** User asked for Google Maps; needs a Google Cloud API key (see below).
   - Plan: Google Street View Static API (`<img>` on our page, no redirect) with the free metadata check first so we only show a photo where coverage exists; Maps Static API thumbnail as fallback. Key must be created by the owner, billing enabled, and restricted to our domain by HTTP referrer (it is visible in the browser). Check current Google pricing/free tier before launch.
   - If no key is supplied: fall back to Wikimedia Commons / Mapillary photos.
   - Earlier notes:
   - Google imagery needs a paid API key and its terms forbid scraping, so not Google.
   - Free options: Wikimedia Commons geosearch (nearby photos), Mapillary image API, static map thumbnail as fallback.
   - Suggested: Wikimedia/Mapillary photo where one exists, map thumbnail otherwise; load on demand when the user clicks.

## New features

6. **Save up to 5 routes** (in-memory only, lost on refresh — no accounts/storage).
   - Save current route, start a fresh one, switch back to any saved route.
   - DECIDED: saving a 6th route removes the oldest one, after an in-page confirmation popup (a styled modal, not a browser alert) saying which route will be dropped; user can cancel.
   - Open: rename/delete for saved routes?
7. **GPX export.**
   - Check the current export produces a valid file (untested).
   - Add a short "What's this?" next to the button: GPX is a standard route file; load it into Google Earth, Garmin, Komoot, OsmAnd or a phone GPS app to follow the route live. Include simple open-with steps for the common apps.

## Housekeeping

8. Mobile layout: DONE in v1.2.16 (see Done). Remaining ideas: shrink the location-blocked toast on phones; show '<1 min' in the stats panel too (it says '0 min').
9. `origin/main` is still at the first commit; the work lives on `live`. Decide whether to fast-forward `main`.
10. RULE: every update ships under a new version number (`./bump-version.sh`); the pre-commit hook enforces it.
11. Test every feature end-to-end (screenshot, share, GPX, stats) after each change, not just drawing.

## Done

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
