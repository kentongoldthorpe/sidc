// The area of operations (Epic 6 E6-6, D47): one per project, kept with its settings. Items outside it
// are flagged (never refused): a transposed grid digit usually puts a point kilometres away, outside
// the AO, where it shows at once.
//
//   ao = { name, points: LatLng[] }   a polygon of 3 to 200 points (WGS 84), in order
import { parseLatLng } from './lat-lng.js';
import { toUtmInZone, fromUtm, zoneOf } from './mgrs.js';
import { shapeOf } from './graphic.js';
import { isObject } from '../shared/values.js';

export const AO_NAME_MAX = 60;
export const AO_POINTS_MAX = 200;

/** Check an area of operations { name?, points } (points may be { lat, lng } or { mgrs }). */
export function parseAo(raw, field = 'ao') {
  if (!isObject(raw)) return { problems: [{ field, reason: 'must be an object { name?, points } (or null to clear it)' }] };
  const problems = Object.keys(raw).filter((k) => k !== 'name' && k !== 'points').map((k) => ({ field: `${field}.${k}`, reason: 'unknown field' }));
  const name = raw.name ?? '';
  if (typeof name !== 'string' || name.trim().length > AO_NAME_MAX) problems.push({ field: `${field}.name`, reason: `must be text of at most ${AO_NAME_MAX} characters` });
  if (!Array.isArray(raw.points) || raw.points.length < 3 || raw.points.length > AO_POINTS_MAX) {
    problems.push({ field: `${field}.points`, reason: `must be a list of 3 to ${AO_POINTS_MAX} points (two corners make a box: see boxAo)` });
    return { problems };
  }
  const points = raw.points.map((p, i) => {
    const parsed = parseLatLng(p, `${field}.points[${i}]`);
    if (parsed.problems) problems.push(...parsed.problems);
    return parsed.value;
  });
  return problems.length ? { problems } : { problems: [], value: { name: name.trim(), points } };
}

/**
 * A box from two opposite corners, square to the UTM grid of the first (as a map sheet is).
 * @returns {{ lat: number, lng: number }[]} SW, SE, NE, NW
 */
export function boxAo(a, b) {
  const zone = zoneOf(a.lat, a.lng);
  const hemisphere = a.lat < 0 ? 'S' : 'N';
  const [ua, ub] = [toUtmInZone(a, zone), toUtmInZone(b, zone)];
  const [e0, e1] = [Math.min(ua.easting, ub.easting), Math.max(ua.easting, ub.easting)];
  const [n0, n1] = [Math.min(ua.northing, ub.northing), Math.max(ua.northing, ub.northing)];
  return [[e0, n0], [e1, n0], [e1, n1], [e0, n1]].map(([easting, northing]) => fromUtm({ zone, hemisphere, easting, northing }));
}

/** Is a position inside (or on the edge of) the area? Ray casting in degrees; AOs are small. */
export function insideAo(position, ao) {
  const pts = ao.points;
  let inside = false;
  const { lat: y, lng: x } = position;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi, xj, yj] = [pts[i].lng, pts[i].lat, pts[j].lng, pts[j].lat];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A COA's units, lines and areas with a point outside the AO.
 * @returns {{ kind: 'unit'|'line', id: string, name: string, position: { lat, lng } }[]} position: the first point outside
 */
export function itemsOutside(coa, ao) {
  if (!ao) return [];
  const out = [];
  for (const u of coa.symbols) if (!insideAo(u.position, ao)) out.push({ kind: 'unit', id: u.id, name: u.label, position: u.position });
  for (const g of coa.graphics) {
    const pts = shapeOf(g.kind) === 'circle' || shapeOf(g.kind) === 'sector' ? [g.center] : g.points;
    const first = pts.find((p) => !insideAo(p, ao));
    if (first) out.push({ kind: 'line', id: g.id, name: g.label, position: first });
  }
  return out;
}
