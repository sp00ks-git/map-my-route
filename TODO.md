# Map My Route — TODO

Last updated 16-10-2026 (current version: v1.2.8). Nothing below has been started unless marked.

## Bugs (do first)

1. **Screenshot saves a black image.**
   - Find the cause (`preserveDrawingBuffer` is already on, so look at how the capture is composed).
   - Filename: `MapMyRoute_YYYY-MM-DD_HH-MM_<Area>.png`, area from a reverse-geocode of the route start; fall back to date+time only if the lookup fails.
   - Verify the saved file opens and shows map + route.
2. **Link shortening blocked by CORS.**
   - Shorten server-side (small endpoint on our own Apache host that calls a shortener), not from the browser.
   - Alternative: self-hosted shortener (needs storage + uptime). Decide when starting.
   - Remove the "blocked by the browser/network (CORS)" message once fixed.
3. **"Couldn't look up road/path types… very long route" shown on a 6 km route.**
   - Suspected cause (unchecked): drawn routes are always `classified: false`, so the panel shows this for every drawn route; 6 km is well under the 60 km limit in `waytype.js`.
   - Fix: classify locally from the road data already loaded (no Overpass call) and show a real breakdown; make any remaining failure message honest.

## Removals / changes

4. **Remove Street View** (button, `js/streetview.js`, its import in `js/main.js`).
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

8. Mobile layout: controls (search, pan arrows, pop-ups) cover the small map; map area is short because the route panel takes the rest of the screen.
9. `origin/main` is still at the first commit; the work lives on `live`. Decide whether to fast-forward `main`.
10. Test every feature end-to-end (screenshot, share, GPX, stats) after each change, not just drawing.

## Done

- v1.2.7: draw mode no longer loses road segments (dedupe by geometry, not vector-tile id; road list frozen per stroke).
- v1.2.8: a new stroke is joined to the route's end along the road network instead of a straight gap.
