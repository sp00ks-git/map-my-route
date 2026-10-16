// Photos of the start and finish of a route, shown on the page (nothing sends
// the user away). Both sources are free and need NO key or account:
//   1. KartaView (open street-level imagery, ex-OpenStreetCam) -- photos taken
//      from the road, often within a few metres of the point. Patchy outside towns.
//   2. Wikimedia Commons -- openly licensed photos geotagged nearby (lots of UK
//      street scenes via Geograph), used when KartaView has nothing close.

const KARTAVIEW_API = "https://api.kartaview.org/2.0/photo/";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const NEAR_M = 300;
const FAR_M = 1500;

function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Plain text of a Commons metadata value (they contain HTML). */
function plainText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function prettyTitle(fileTitle) {
  return fileTitle
    .replace(/^File:/, "")
    .replace(/\.(jpe?g|png)$/i, "")
    .replace(/\s*-\s*geograph\.org\.uk\s*-\s*\d+/i, "")
    .trim();
}

async function commonsPhoto(lat, lng, radiusM) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "geosearch",
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(radiusM),
    ggslimit: "12",
    ggsnamespace: "6",
    prop: "imageinfo|coordinates",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "480",
    iiextmetadatafilter: "Artist|LicenseShortName",
    colimit: "12",
  });
  const res = await fetch(`${COMMONS_API}?${params}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Wikimedia Commons returned ${res.status}`);
  const pages = Object.values((await res.json()).query?.pages || {});
  const candidates = pages
    .filter((p) => p.imageinfo?.[0] && /^image\/(jpeg|png)$/.test(p.imageinfo[0].mime) && p.imageinfo[0].width >= 400 && p.coordinates?.[0])
    .map((p) => ({ page: p, distanceM: haversineM(lat, lng, p.coordinates[0].lat, p.coordinates[0].lon) }))
    .sort((a, b) => a.distanceM - b.distanceM);
  if (!candidates.length) return null;
  const { page, distanceM } = candidates[0];
  const info = page.imageinfo[0];
  const meta = info.extmetadata || {};
  return {
    source: "Wikimedia Commons",
    src: info.thumburl || info.url,
    title: prettyTitle(page.title),
    distanceM,
    credit: [plainText(meta.Artist?.value), plainText(meta.LicenseShortName?.value)].filter(Boolean).join(" -- "),
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
  };
}

async function kartaviewPhoto(lat, lng, radiusM) {
  const url = `${KARTAVIEW_API}?lat=${lat}&lng=${lng}&radius=${radiusM}&itemsPerPage=10`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`KartaView returned ${res.status}`);
  const rows = (await res.json()).result?.data || [];
  const best = rows
    .filter((r) => r.autoImgProcessingStatus === "FINISHED" && (r.fileurlLTh || r.fileurlProc))
    .map((r) => ({ r, distanceM: haversineM(lat, lng, Number(r.lat), Number(r.lng)) }))
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  if (!best) return null;
  const when = best.r.shotDate ? new Date(best.r.shotDate.replace(" ", "T")) : null;
  return {
    source: "KartaView",
    src: best.r.fileurlLTh || best.r.fileurlProc,
    title: when && !Number.isNaN(when.getTime()) ? `Street-level photo, ${when.getFullYear()}` : "Street-level photo",
    distanceM: best.distanceM,
    credit: "contributors, CC BY-SA 4.0",
    pageUrl: null,
  };
}

/**
 * Best photo near a point, or null: KartaView street-level first (within 50 m,
 * then 200 m), then Wikimedia Commons (within ~300 m, then ~1.5 km). A source
 * that errors is skipped; throws only if every source errored.
 */
export async function findPhoto(lat, lng) {
  const attempts = [
    () => kartaviewPhoto(lat, lng, 50),
    () => kartaviewPhoto(lat, lng, 200),
    () => commonsPhoto(lat, lng, NEAR_M),
    () => commonsPhoto(lat, lng, FAR_M),
  ];
  let errors = 0;
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const photo = await attempt();
      if (photo) return photo;
    } catch (err) {
      errors++;
      lastError = err;
    }
  }
  if (errors === attempts.length) throw lastError;
  return null;
}
