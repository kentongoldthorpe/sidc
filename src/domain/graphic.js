// Graphic entity: a line, area or range ring drawn on a COA (decisions D15–D18).
//
//   { id, kind, side, label, color?, points }          lines and areas (points: LatLng[])
//   lines may also have annotation: a second line of text above the line (a time, H+2…)
//   { id, kind, side, label, color?, center, radius }  range rings (radius in metres)
//
// The kind fixes the shape: a line kind can become another line kind, never an area or a ring.
// The colour comes from the side unless `color` overrides it (graphicColor).
// Points are kept continuous: each longitude is within 180° of the previous one, so a line across
// the 180° meridian does not go round the world. The first point is wrapped into [-180, 180).
import { parseLatLng } from './lat-lng.js';

export const GRAPHIC_KINDS = Object.freeze({
  phaseLine: 'line', boundary: 'line', axisOfAdvance: 'line', route: 'line', line: 'line',
  objective: 'area', assemblyArea: 'area', engagementArea: 'area', area: 'area',
  rangeRing: 'circle',
  sector: 'sector',
});
export const SIDES = Object.freeze(['friendly', 'hostile', 'neutral', 'unknown']);
/** Default colour per side (friendly blue, hostile red, neutral green, unknown amber). */
export const SIDE_COLORS = Object.freeze({ friendly: '#1f4fbf', hostile: '#d0021b', neutral: '#00882e', unknown: '#b07d00' });
export const GRAPHIC_LABEL_MAX = 40;
export const ANNOTATION_MAX = 40;
export const MAX_POINTS = 500;
export const MAX_RADIUS = 5_000_000;

const MIN_POINTS = Object.freeze({ line: 2, area: 3 });
const GEOMETRY_FIELDS = Object.freeze({ line: ['points'], area: ['points'], circle: ['center', 'radius'], sector: ['center', 'radius', 'minRadius', 'bearing', 'arc'] });
const REQUIRED_GEOMETRY = Object.freeze({ line: ['points'], area: ['points'], circle: ['center', 'radius'], sector: ['center', 'radius', 'bearing', 'arc'] });
const ALL_GEOMETRY = Object.freeze(['points', 'center', 'radius', 'minRadius', 'bearing', 'arc']);
/** Fields graphic.update may change, in the order changes are reported. */
export const EDITABLE_GRAPHIC_FIELDS = Object.freeze(['kind', 'side', 'color', 'label', 'annotation', 'points', 'center', 'radius', 'minRadius', 'bearing', 'arc']);
const SHAPE_NAMES = Object.freeze({ line: 'line', area: 'area', circle: 'range ring', sector: 'sector of fire' });
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** A sector's minimum range must be inside its range. */
export function checkSectorWhole(g) {
  return g.minRadius && g.radius !== undefined && g.minRadius >= g.radius ? [{ field: 'minRadius', reason: 'must be less than the radius' }] : [];
}

/** 'line' | 'area' | 'circle' | undefined */
export const shapeOf = (kind) => (typeof kind === 'string' && Object.hasOwn(GRAPHIC_KINDS, kind) ? GRAPHIC_KINDS[kind] : undefined);

/** The colour a graphic is drawn in. */
export const graphicColor = (graphic) => graphic.color ?? SIDE_COLORS[graphic.side] ?? SIDE_COLORS.friendly;

function parsePoints(raw, shape) {
  const min = MIN_POINTS[shape] ?? 2;
  if (!Array.isArray(raw)) return { problems: [{ field: 'points', reason: 'must be a list of { lat, lng } points' }] };
  if (raw.length < min || raw.length > MAX_POINTS) {
    return { problems: [{ field: 'points', reason: `must have ${min} to ${MAX_POINTS} points for ${shape === 'area' ? 'an area' : 'a line'}` }] };
  }
  const problems = [];
  const points = [];
  raw.forEach((p, i) => {
    const parsed = parseLatLng(p, `points[${i}]`);
    if (parsed.problems) { problems.push(...parsed.problems); return; }
    let { lng } = parsed.value; // parseLatLng wraps it, so the first point is in [-180, 180)
    if (points.length > 0) {
      const prev = points.at(-1).lng;
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
    }
    points.push({ lat: parsed.value.lat, lng });
  });
  return problems.length ? { problems } : { value: points };
}

/**
 * Check and normalise whichever graphic fields are present.
 * @param {Object} fields
 * @param {'line'|'area'|'circle'|undefined} shape the shape geometry must fit (undefined: skip shape checks)
 * @param {{ forUpdate?: boolean }} [options] updates only: null removes the colour override or the minimum range
 * @returns {{ problems: {field: string, reason: string}[], value: Object }}
 */
export function parseGraphicFields(fields, shape, { forUpdate = false } = {}) {
  const problems = [];
  const value = {};
  if ('kind' in fields) {
    if (shapeOf(fields.kind)) value.kind = fields.kind;
    else problems.push({ field: 'kind', reason: `must be one of ${Object.keys(GRAPHIC_KINDS).join(', ')}` });
  }
  if ('side' in fields) {
    if (SIDES.includes(fields.side)) value.side = fields.side;
    else problems.push({ field: 'side', reason: `must be one of ${SIDES.join(', ')}` });
  }
  if ('color' in fields) {
    if (fields.color === null && forUpdate) value.color = null;
    else if (typeof fields.color === 'string' && /^#[0-9a-f]{6}$/i.test(fields.color)) value.color = fields.color.toLowerCase();
    else problems.push({ field: 'color', reason: 'must be a colour like #1f4fbf' });
  }
  if ('label' in fields) {
    if (typeof fields.label !== 'string') problems.push({ field: 'label', reason: 'must be a string' });
    else if (fields.label.trim().length > GRAPHIC_LABEL_MAX) problems.push({ field: 'label', reason: `must be at most ${GRAPHIC_LABEL_MAX} characters` });
    else value.label = fields.label.trim();
  }
  if ('annotation' in fields) {
    const a = fields.annotation;
    if (shape && shape !== 'line') problems.push({ field: 'annotation', reason: `is only for lines, not a${shape === 'area' ? 'n' : ''} ${SHAPE_NAMES[shape]}` });
    else if (a === null && forUpdate) value.annotation = null;
    else if (typeof a !== 'string') problems.push({ field: 'annotation', reason: 'must be a string' });
    else if (a.trim().length > ANNOTATION_MAX) problems.push({ field: 'annotation', reason: `must be at most ${ANNOTATION_MAX} characters` });
    else value.annotation = a.trim() === '' && forUpdate ? null : a.trim();
  }
  for (const field of ALL_GEOMETRY.filter((f) => f in fields)) {
    if (shape && !GEOMETRY_FIELDS[shape].includes(field)) {
      problems.push({ field, reason: `is not used by a ${SHAPE_NAMES[shape]}` });
      continue;
    }
    if (field === 'points') {
      const parsed = parsePoints(fields.points, shape);
      if (parsed.problems) problems.push(...parsed.problems); else value.points = parsed.value;
    } else if (field === 'center') {
      const parsed = parseLatLng(fields.center, 'center');
      if (parsed.problems) problems.push(...parsed.problems); else value.center = parsed.value;
    } else if (field === 'radius') {
      if (isNumber(fields.radius) && fields.radius > 0 && fields.radius <= MAX_RADIUS) value.radius = fields.radius;
      else problems.push({ field: 'radius', reason: `must be a number of metres, more than 0 and at most ${MAX_RADIUS}` });
    } else if (field === 'minRadius') {
      if (fields.minRadius === null && forUpdate) value.minRadius = null; // an update removing it
      else if (isNumber(fields.minRadius) && fields.minRadius >= 0 && fields.minRadius < MAX_RADIUS) value.minRadius = fields.minRadius;
      else problems.push({ field: 'minRadius', reason: 'must be a number of metres, 0 or more (the minimum range)' });
    } else if (field === 'bearing') {
      if (isNumber(fields.bearing) && fields.bearing >= 0 && fields.bearing < 360) value.bearing = fields.bearing;
      else problems.push({ field: 'bearing', reason: 'must be degrees from true north, 0 to less than 360' });
    } else if (isNumber(fields.arc) && fields.arc > 0 && fields.arc <= 360) {
      value.arc = fields.arc;
    } else {
      problems.push({ field: 'arc', reason: 'must be degrees, more than 0 and at most 360' });
    }
  }
  return { problems, value };
}

/**
 * Check a complete new graphic (kind required, geometry required for its shape).
 * @returns {{ problems: object[], value?: Object }} value without id: { kind, side, label, color?, …geometry }
 */
export function parseNewGraphic(fields) {
  const shape = shapeOf(fields.kind);
  if (!shape) {
    return { problems: [{ field: 'kind', reason: 'kind' in fields ? `must be one of ${Object.keys(GRAPHIC_KINDS).join(', ')}` : 'is required' }] };
  }
  const { problems, value } = parseGraphicFields(fields, shape);
  for (const field of REQUIRED_GEOMETRY[shape]) if (!(field in fields)) problems.push({ field, reason: 'is required' });
  if (shape === 'sector' && problems.length === 0) problems.push(...checkSectorWhole(value));
  if (problems.length) return { problems };
  const { kind, side = 'friendly', label = '', annotation, color, minRadius, ...geometry } = value;
  return { problems: [], value: { kind, side, label, ...(annotation ? { annotation } : {}), ...(color ? { color } : {}), ...geometry, ...(minRadius ? { minRadius } : {}) } };
}
