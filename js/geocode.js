// Free, key-less place/postcode/address search via OpenStreetMap's public
// Nominatim service. No signup, but its usage policy asks for a real
// identifying value in the query string (not user-agent spoofing) and no
// hammering it -- fine for someone occasionally searching a place while
// planning a route.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/**
 * Search for a place, postcode, address, or road name.
 * Returns up to `limit` results as
 * { label, lat, lon, bounds: [[south,west],[north,east]] | null }.
 */
export async function searchPlaces(query, limit = 5) {
  const q = query.trim();
  if (!q) return [];

  const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=0&limit=${limit}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();

  return data.map((item) => ({
    label: item.display_name,
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    bounds: item.boundingbox
      ? [
          [parseFloat(item.boundingbox[0]), parseFloat(item.boundingbox[2])],
          [parseFloat(item.boundingbox[1]), parseFloat(item.boundingbox[3])],
        ]
      : null,
  }));
}
