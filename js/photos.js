// Photos of the start and finish of a route, shown on the page (nothing sends
// the user away). Two sources:
//   * Wikimedia Commons -- free, key-less, openly licensed photos geotagged near
//     the point (lots of UK street scenes via Geograph). The default.
//   * Google Street View Static API -- only if the owner has put their own
//     Google API key in Settings (Google imagery is never free/key-less).

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

async function googlePhoto(lat, lng, key) {
  const loc = `${lat},${lng}`;
  const meta = await fetch(
    `https://maps.googleapis.com/maps/api/streetview/metadata?location=${loc}&radius=100&source=outdoor&key=${encodeURIComponent(key)}`,
    { signal: AbortSignal.timeout(10000) }
  ).then((r) => r.json());
  if (meta.status !== "OK") {
    if (meta.status === "ZERO_RESULTS") return null;
    throw new Error(meta.error_message || `Google Street View: ${meta.status}`);
  }
  return {
    source: "Google Street View",
    src: `https://maps.googleapis.com/maps/api/streetview?size=480x300&location=${loc}&radius=100&source=outdoor&key=${encodeURIComponent(key)}`,
    title: "Street-level view",
    distanceM: meta.location ? haversineM(lat, lng, meta.location.lat, meta.location.lng) : 0,
    credit: "© Google",
    pageUrl: null,
  };
}

/**
 * Best photo near a point, or null. Uses Google if a key is supplied (falling
 * back to Commons when Google has nothing), otherwise Commons: first within
 * ~300 m, then widening to ~1.5 km. Throws only if every source errored.
 */
export async function findPhoto(lat, lng, googleKey = "") {
  let lastError = null;
  if (googleKey) {
    try {
      const g = await googlePhoto(lat, lng, googleKey);
      if (g) return g;
    } catch (err) {
      lastError = err;
    }
  }
  try {
    return (await commonsPhoto(lat, lng, NEAR_M)) || (await commonsPhoto(lat, lng, FAR_M));
  } catch (err) {
    if (lastError) throw lastError;
    throw err;
  }
}
