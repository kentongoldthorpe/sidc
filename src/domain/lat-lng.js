// LatLng value object: lat in [-90, 90]; lng normalised into [-180, 180).
import { isObject, wrapLng } from '../shared/values.js';

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** @returns {{ value: { lat: number, lng: number } } | { problems: {field:string, reason:string}[] }} */
export function parseLatLng(raw, field = 'position') {
  if (!isObject(raw)) return { problems: [{ field, reason: 'must be an object { lat, lng }' }] };
  const problems = [];
  if (!isFiniteNumber(raw.lat) || raw.lat < -90 || raw.lat > 90) {
    problems.push({ field: `${field}.lat`, reason: 'must be a number from -90 to 90' });
  }
  if (!isFiniteNumber(raw.lng)) problems.push({ field: `${field}.lng`, reason: 'must be a number' });
  for (const key of Object.keys(raw)) {
    if (key !== 'lat' && key !== 'lng') problems.push({ field: `${field}.${key}`, reason: 'unknown field' });
  }
  return problems.length ? { problems } : { value: { lat: raw.lat, lng: wrapLng(raw.lng) } };
}
