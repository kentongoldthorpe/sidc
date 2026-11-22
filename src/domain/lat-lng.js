// LatLng value object: lat in [-90, 90]; lng normalised into [-180, 180).

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Wrap a longitude into [-180, 180). In-range values are returned untouched (no float drift). */
const normaliseLng = (lng) => (lng >= -180 && lng < 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180);

/** @returns {{ value: { lat: number, lng: number } } | { problems: {field:string, reason:string}[] }} */
export function parseLatLng(raw, field = 'position') {
  if (!isPlainObject(raw)) return { problems: [{ field, reason: 'must be an object { lat, lng }' }] };
  const problems = [];
  if (!isFiniteNumber(raw.lat) || raw.lat < -90 || raw.lat > 90) {
    problems.push({ field: `${field}.lat`, reason: 'must be a number from -90 to 90' });
  }
  if (!isFiniteNumber(raw.lng)) problems.push({ field: `${field}.lng`, reason: 'must be a number' });
  for (const key of Object.keys(raw)) {
    if (key !== 'lat' && key !== 'lng') problems.push({ field: `${field}.${key}`, reason: 'unknown field' });
  }
  return problems.length ? { problems } : { value: { lat: raw.lat, lng: normaliseLng(raw.lng) } };
}
