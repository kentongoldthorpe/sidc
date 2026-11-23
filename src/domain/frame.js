// Export frame value object: what a slide shows. Resolution-independent:
//   { aspect: '16:9' | '4:3' | '5:4', center: { lat, lng }, width }
// width is the frame's width in degrees of longitude (Web Mercator x is linear in longitude), so the
// same frame gives the same picture on any screen and at any slide resolution.
import { parseLatLng } from './lat-lng.js';

export const ASPECTS = Object.freeze({ '16:9': 16 / 9, '4:3': 4 / 3, '5:4': 5 / 4 });
export const MAX_WIDTH = 360;

/** @returns {{ value: object } | { problems: {field:string, reason:string}[] }} */
export function parseFrame(raw, field = 'frame') {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { problems: [{ field, reason: 'must be an object { aspect, center, width }' }] };
  const problems = [];
  if (!(raw.aspect in ASPECTS)) problems.push({ field: `${field}.aspect`, reason: `must be one of ${Object.keys(ASPECTS).join(', ')}` });
  const center = parseLatLng(raw.center, `${field}.center`);
  if (center.problems) problems.push(...center.problems);
  if (typeof raw.width !== 'number' || !Number.isFinite(raw.width) || raw.width <= 0 || raw.width > MAX_WIDTH) {
    problems.push({ field: `${field}.width`, reason: `must be a number of degrees of longitude, more than 0 and at most ${MAX_WIDTH}` });
  }
  for (const key of Object.keys(raw)) if (!['aspect', 'center', 'width'].includes(key)) problems.push({ field: `${field}.${key}`, reason: 'unknown field' });
  return problems.length ? { problems } : { value: { aspect: raw.aspect, center: center.value, width: raw.width } };
}
