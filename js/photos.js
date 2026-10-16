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

async function commonsPhotos(lat, lng, radiusM) {
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
  return pages
    .filter((p) => p.imageinfo?.[0] && /^image\/(jpeg|png)$/.test(p.imageinfo[0].mime) && p.imageinfo[0].width >= 400 && p.coordinates?.[0])
    .map((page) => {
      const info = page.imageinfo[0];
      const meta = info.extmetadata || {};
      return {
        source: "Wikimedia Commons",
        thumb: info.thumburl || info.url,
        src: info.thumburl || info.url,
        title: prettyTitle(page.title),
        distanceM: haversineM(lat, lng, page.coordinates[0].lat, page.coordinates[0].lon),
        credit: [plainText(meta.Artist?.value), plainText(meta.LicenseShortName?.value)].filter(Boolean).join(" -- "),
        // Only shown inside the enlarged view, as the licence's attribution link.
        pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
      };
    });
}

async function kartaviewPhotos(lat, lng, radiusM) {
  const url = `${KARTAVIEW_API}?lat=${lat}&lng=${lng}&radius=${radiusM}&itemsPerPage=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`KartaView returned ${res.status}`);
  const rows = (await res.json()).result?.data || [];
  return rows
    .filter((r) => r.autoImgProcessingStatus === "FINISHED" && (r.fileurlLTh || r.fileurlProc))
    .map((r) => {
      const when = r.shotDate ? new Date(r.shotDate.replace(" ", "T")) : null;
      return {
        source: "KartaView",
        thumb: r.fileurlTh || r.fileurlLTh || r.fileurlProc,
        src: r.fileurlLTh || r.fileurlProc,
        title: when && !Number.isNaN(when.getTime()) ? `Street-level photo, ${when.getFullYear()}` : "Street-level photo",
        distanceM: haversineM(lat, lng, Number(r.lat), Number(r.lng)),
        credit: "contributors, CC BY-SA 4.0",
        pageUrl: null, // deliberately no link back to KartaView
      };
    });
}

/** Nearest first, dropping near-duplicates (shots a few metres apart), up to `max`. */
function pickDistinct(photos, max) {
  const picked = [];
  for (const p of [...photos].sort((a, b) => a.distanceM - b.distanceM)) {
    if (picked.length >= max) break;
    if (picked.some((q) => Math.abs(q.distanceM - p.distanceM) < 8 && q.title === p.title)) continue;
    picked.push(p);
  }
  return picked;
}

/**
 * Up to `max` photos near a point: KartaView street-level first (within 200 m),
 * else Wikimedia Commons (within ~300 m, then ~1.5 km). Returns [] when there
 * are none; a source that errors is skipped, and it throws only if every
 * source errored.
 */
export async function findPhotos(lat, lng, max = 3) {
  const attempts = [
    () => kartaviewPhotos(lat, lng, 200),
    () => commonsPhotos(lat, lng, NEAR_M),
    () => commonsPhotos(lat, lng, FAR_M),
  ];
  let errors = 0;
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const picked = pickDistinct(await attempt(), max);
      if (picked.length) return picked;
    } catch (err) {
      errors++;
      lastError = err;
    }
  }
  if (errors === attempts.length) throw lastError;
  return [];
}
