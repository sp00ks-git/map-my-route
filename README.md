# Map My Route

A free, open alternative to "draw a route on Google Earth and share it" -- no
Google account, no billing, no API keys needed. Live at
<https://mapmyroute.ddns.net/>.

## What it does

- **Globe view** -- a spinnable 3D globe (MapLibre GL JS + OpenFreeMap vector tiles).
- **Route Planner** -- a 2D map you *draw* on with a mouse or finger (turn on the
  pencil). The line locks to the real roads and paths under your stroke: it is
  traced from the road geometry already on screen, not guessed by a routing
  engine, so it can't wander onto a neighbouring road. Tapping point-to-point
  also works (OSRM routing).
- **One continuous route** -- lift off, pan/zoom, and start the next stroke
  anywhere near the end; the gap is joined along the road automatically.
- **Top bar** -- the live lat/lng under the pointer (click to copy) and the place
  search sit in the header, not over the map, so the whole map stays visible.
- **Stats** -- distance, estimated time and a distance breakdown by road/path
  type, computed locally from the loaded map data.
- **Saved routes** -- keep up to 5 routes while the page is open (in memory only,
  lost on refresh -- no accounts). Saving a 6th asks before removing the oldest.
- **Screenshot** -- PNG of the map with route, Start/Finish pins and the required
  OpenStreetMap credit, named `MapMyRoute_<date>_<time>_<area>.png`.
- **GPX export** -- standard GPX 1.1 track with Start/Finish waypoints; the page
  explains what GPX is and how to open it on phones, Garmin and desktop.
- **Share links** -- the whole route is packed into the URL, plus a **short link**
  (`/?s=<id>`) served by this site itself (`api/shorten.php`, `api/route.php`).
- **Start/finish photos** -- on-demand photos near each end, no key needed:
  KartaView street-level imagery first, then Wikimedia Commons (openly licensed,
  credited).
- **Phone layout** -- one compact top row (Globe/Route tabs, lat/lng, search,
  settings) and the Route panel as a pull-up bottom sheet, so the map gets the
  screen.

## Running it

It's a static site plus two small PHP endpoints for short links.

```bash
cd map-my-route
php -S localhost:8080        # serves the site AND the PHP short-link endpoints
```

(`python3 -m http.server` also works for everything except short links.)

Production is Apache with `mod_php` (see `deploy/`). Short links are stored as
small files in `/var/www/mapmyroute-data/` (outside the web root, writable by
`www-data`): ids are 10 lowercase look-alike-free characters, 40 new links per
IP per hour, 600 KB max each, deleted after 180 days unused.

## Versioning (every update gets a new version)

Run `./bump-version.sh` before committing any change to `js/`, `css/`, `api/` or
`index.html`. It updates the page header, the `?v=` cache-busters and the module
imports, and writes `version.json`. A git pre-commit hook refuses app-file
commits that keep the old version, and a running page reloads itself once if
`version.json` is newer than it is (the server sends no cache headers).

## Services used (all free, no key)

| What | Service |
|---|---|
| Basemap | OpenFreeMap "Bright" (OpenMapTiles schema) |
| Tap-to-tap routing | OSRM (project-osrm.org demo; FOSSGIS for foot/bike) |
| Place search / area names | OpenStreetMap Nominatim |
| Photos | KartaView API, then Wikimedia Commons API |
| Road data fallback | Overpass API (best effort -- often flaky/limited) |

Optional key (Settings): openrouteservice (elevation). It lives only in your
browser's `localStorage`.

## Notes and limitations

- OSRM and Overpass public servers are shared best-effort services; don't hammer them.
- Road-type breakdown for drawn routes comes from the road data loaded while you
  draw; for tap-to-tap routes through never-viewed areas it falls back to
  Overpass and may show a "not available" note if that is down.
- Map data: &copy; OpenStreetMap contributors, OpenFreeMap, OpenMapTiles. None of
  the default services are Google products.
