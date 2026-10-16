// Turns the current route into a self-contained link (no backend, no
// database -- the whole computed route is packed into the URL hash), plus
// a screenshot and a GPX file export.

function toBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function gzip(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Encode {profile, waypoints, result} into a URL hash fragment.
 *  Includes the fully computed route so a recipient can view it with zero
 *  routing-API calls (and zero API key) on their end. */
export async function encodeRouteToHash(state) {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  const compressed = await gzip(bytes).catch(() => null);
  if (compressed) {
    return `gz1.${toBase64Url(compressed)}`;
  }
  return `raw1.${toBase64Url(bytes)}`;
}

export async function decodeRouteFromHash(hash) {
  const [tag, payload] = hash.split(/\.(.+)/s);
  if (!payload) return null;
  const bytes = fromBase64Url(payload);
  let jsonBytes = bytes;
  if (tag === "gz1") {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser can't decompress shared route links -- try a recent Chrome, Edge, or Firefox.");
    }
    jsonBytes = await gunzip(bytes);
  }
  const json = new TextDecoder().decode(jsonBytes);
  return JSON.parse(json);
}

export function buildShareUrl(hashPayload) {
  const url = new URL(window.location.href);
  url.hash = `r=${hashPayload}`;
  return url.toString();
}

/** Short links are served by OUR OWN site (api/shorten.php + api/route.php),
 *  not a third-party shortener: those block cross-origin browser calls (CORS)
 *  and reject long URLs. Same-origin means it just works.
 *  `hashPayload` is the string after "#r=" in the full link. Returns the short
 *  URL, <site>/?s=<id>. */
export async function createShortLink(hashPayload) {
  const res = await fetch(new URL("api/shorten.php", window.location.href), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: hashPayload }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(data.error || `Short link service returned ${res.status}`);
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = `?s=${data.id}`;
  return url.toString();
}

/** Fetch the route behind a short link id (see createShortLink). Returns
 *  { payload, json } -- `json` is the already-decompressed route when the
 *  server could provide it, so older browsers needn't gunzip anything. */
export async function resolveShortLink(id) {
  const res = await fetch(new URL(`api/route.php?id=${encodeURIComponent(id)}`, window.location.href), {
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.payload) throw new Error(data.error || `Short link service returned ${res.status}`);
  return { payload: data.payload, json: data.json || null };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function buildGpx(coords, name = "Map My Route") {
  const points = coords
    .map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Map My Route" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name></metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}
