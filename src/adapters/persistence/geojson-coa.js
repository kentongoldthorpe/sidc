// The COA document format: one COA = one GeoJSON FeatureCollection (RFC 7946).
//
//   {
//     "type": "FeatureCollection",
//     "coa": { "schemaVersion": 1, "id", "name", "description", "revision", "createdAt", "updatedAt" },
//     "features": [
//       { "type": "Feature", "id": "<symbol id>",
//         "geometry": { "type": "Point", "coordinates": [lng, lat] },
//         "properties": { "sidc", "label", ...modifiers } },         // modifiers flattened (GIS/CSV friendly)
//       { "type": "Feature", "id": "<graphic id>",                      // lines, areas, range rings, after the units:
//         "geometry": LineString [[lng, lat], …] | Polygon [[…closed ring…]] | Point [lng, lat] (ring centre),
//         "properties": { "kind", "side", "label", "color"?, "radius"? } } // "kind" marks a graphic
//     ]
//   }
//
// Used for files written by serve.ps1, browser storage, and import/export. Reading never trusts the
// document: every field goes through the same domain rules the app applies to commands.
import { checkCoaFields } from '../../domain/coa.js';
import { parseFrame } from '../../domain/frame.js';
import { parseSymbolFields } from '../../domain/map-symbol.js';
import { parseNewGraphic, shapeOf } from '../../domain/graphic.js';
import { isIsoUtcTimestamp } from '../../shared/envelope.js';
import { deepFreeze } from '../../shared/freeze.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { isObject } from '../../shared/values.js';

export const COA_SCHEMA_VERSION = 1;

const COA_KEYS = Object.freeze(['schemaVersion', 'id', 'name', 'description', 'revision', 'createdAt', 'updatedAt', 'frame']);
const isId = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= 128;

/** @param {import('../../domain/coa.js').Coa} coa @returns {Object} plain GeoJSON */
export function coaToGeoJson(coa) {
  return {
    type: 'FeatureCollection',
    coa: {
      schemaVersion: COA_SCHEMA_VERSION,
      id: coa.id, name: coa.name, description: coa.description, revision: coa.revision,
      createdAt: coa.createdAt, updatedAt: coa.updatedAt,
      ...(coa.frame ? { frame: coa.frame } : {}),
    },
    features: coa.symbols.map((s) => ({
      type: 'Feature',
      id: s.id,
      geometry: { type: 'Point', coordinates: [s.position.lng, s.position.lat] },
      properties: { sidc: s.sidc, label: s.label, ...s.modifiers },
    })).concat(coa.graphics.map(graphicToFeature)),
  };
}

const position = (p) => [p.lng, p.lat];
const GEOMETRY_TYPES = Object.freeze({ line: 'LineString', area: 'Polygon', circle: 'Point' });

/** A graphic as a GeoJSON Feature (also used by data export). */
export function graphicToFeature(g) {
  const shape = shapeOf(g.kind);
  const coordinates = shape === 'circle' ? position(g.center)
    : shape === 'area' ? [[...g.points, g.points[0]].map(position)]
      : g.points.map(position);
  return {
    type: 'Feature',
    id: g.id,
    geometry: { type: GEOMETRY_TYPES[shape], coordinates },
    properties: { kind: g.kind, side: g.side, label: g.label, ...(g.color ? { color: g.color } : {}), ...(shape === 'circle' ? { radius: g.radius } : {}) },
  };
}

const GRAPHIC_PROPERTIES = Object.freeze(['kind', 'side', 'label', 'color', 'radius']);
const isPosition = (c) => Array.isArray(c) && c.length === 2 && c.every((n) => typeof n === 'number');

/**
 * A feature whose properties carry "kind": a line, area or range ring (also used by file import).
 * Problems are pushed with paths under `at`. @returns {{ graphic } | null}
 */
export function readGraphicFeature(feature, at, problems) {
  const props = feature.properties;
  for (const key of Object.keys(props)) if (!GRAPHIC_PROPERTIES.includes(key)) problems.push({ field: `${at}.properties.${key}`, reason: 'unknown field' });
  const shape = shapeOf(props.kind);
  if (!shape) { problems.push({ field: `${at}.properties.kind`, reason: 'is not a known line, area or range ring kind' }); return null; }
  const g = feature.geometry;
  if (!isObject(g) || g.type !== GEOMETRY_TYPES[shape]) { problems.push({ field: `${at}.geometry`, reason: `must be a ${GEOMETRY_TYPES[shape]} for ${props.kind}` }); return null; }

  const { kind, side, label, color, radius } = props;
  const fields = { kind, ...(side === undefined ? {} : { side }), ...(label === undefined ? {} : { label }), ...(color === undefined ? {} : { color }) };
  let base;
  if (shape === 'circle') {
    if (!isPosition(g.coordinates)) { problems.push({ field: `${at}.geometry.coordinates`, reason: 'must be [longitude, latitude]' }); return null; }
    Object.assign(fields, { center: { lng: g.coordinates[0], lat: g.coordinates[1] }, ...(radius === undefined ? {} : { radius }) });
  } else {
    let ring = shape === 'area' ? (Array.isArray(g.coordinates) ? g.coordinates[0] : undefined) : g.coordinates;
    base = shape === 'area' ? `${at}.geometry.coordinates[0]` : `${at}.geometry.coordinates`;
    if (!Array.isArray(ring) || !ring.every(isPosition)) { problems.push({ field: base, reason: 'must be a list of [longitude, latitude] positions' }); return null; }
    const closed = shape === 'area' && ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
    if (closed) ring = ring.slice(0, -1);
    fields.points = ring.map(([lng, lat]) => ({ lat, lng }));
  }
  const parsed = parseNewGraphic(fields);
  const where = (field) => {
    const point = /^points\[(\d+)\]\.(lat|lng)$/.exec(field);
    if (point) return `${base}[${point[1]}][${point[2] === 'lng' ? 0 : 1}]`;
    if (field === 'points') return base;
    if (field === 'center.lng') return `${at}.geometry.coordinates[0]`;
    if (field === 'center.lat') return `${at}.geometry.coordinates[1]`;
    return `${at}.properties.${field}`;
  };
  problems.push(...parsed.problems.map((p) => ({ ...p, field: where(p.field) })));
  return parsed.problems.length ? null : { graphic: { id: feature.id, ...parsed.value } };
}

/** Domain field names (position.lat, modifiers.dtg, …) → paths inside a feature. */
function featurePath(index, field) {
  const base = `features[${index}]`;
  if (field === 'position.lng') return `${base}.geometry.coordinates[0]`;
  if (field === 'position.lat') return `${base}.geometry.coordinates[1]`;
  if (field.startsWith('modifiers.')) return `${base}.properties.${field.slice('modifiers.'.length)}`;
  return `${base}.properties.${field}`;
}

function readCoaMember(coa, problems) {
  if (!isObject(coa)) { problems.push({ field: 'coa', reason: 'must be an object with the COA details' }); return; }
  if (!Number.isInteger(coa.schemaVersion)) problems.push({ field: 'coa.schemaVersion', reason: 'must be an integer' });
  if (!isId(coa.id)) problems.push({ field: 'coa.id', reason: 'must be a non-blank id' });
  for (const p of checkCoaFields({ name: coa.name, description: coa.description })) problems.push({ ...p, field: `coa.${p.field}` });
  if (!Number.isInteger(coa.revision) || coa.revision < 1) problems.push({ field: 'coa.revision', reason: 'must be an integer ≥ 1' });
  for (const key of ['createdAt', 'updatedAt']) {
    if (!isIsoUtcTimestamp(coa[key])) problems.push({ field: `coa.${key}`, reason: 'must be an ISO-8601 UTC timestamp' });
  }
  if ('frame' in coa) problems.push(...(parseFrame(coa.frame, 'coa.frame').problems ?? []));
  for (const key of Object.keys(coa)) if (!COA_KEYS.includes(key)) problems.push({ field: `coa.${key}`, reason: 'unknown field' });
}

function readFeature(feature, index, seenIds, problems) {
  const at = `features[${index}]`;
  if (!isObject(feature) || feature.type !== 'Feature') { problems.push({ field: `${at}.type`, reason: 'must be a Feature' }); return null; }

  if (!isId(feature.id)) problems.push({ field: `${at}.id`, reason: 'must be a non-blank id' });
  else if (seenIds.has(feature.id)) problems.push({ field: `${at}.id`, reason: 'is used by another feature' });
  else seenIds.add(feature.id);

  if (isObject(feature.properties) && 'kind' in feature.properties) return readGraphicFeature(feature, at, problems);

  const g = feature.geometry;
  if (!isObject(g) || g.type !== 'Point') { problems.push({ field: `${at}.geometry`, reason: 'must be a Point' }); return null; }
  if (!Array.isArray(g.coordinates) || g.coordinates.length !== 2 || !g.coordinates.every((n) => typeof n === 'number')) {
    problems.push({ field: `${at}.geometry.coordinates`, reason: 'must be [longitude, latitude]' });
    return null;
  }
  if (!isObject(feature.properties)) { problems.push({ field: `${at}.properties`, reason: 'must be an object' }); return null; }

  const { sidc, label = '', ...modifiers } = feature.properties;
  if (!('sidc' in feature.properties)) { problems.push({ field: `${at}.properties.sidc`, reason: 'is required' }); return null; }
  const [lng, lat] = g.coordinates;
  const parsed = parseSymbolFields({ sidc, position: { lat, lng }, label, modifiers });
  problems.push(...parsed.problems.map((p) => ({ ...p, field: featurePath(index, p.field) })));
  return parsed.problems.length ? null : { symbol: { id: feature.id, ...parsed.value } };
}

/**
 * @param {unknown} doc parsed JSON
 * @returns {import('../../shared/result.js').Result<import('../../domain/coa.js').Coa>}
 *   IMPORT_INVALID { problems: [{ field, reason }] } | UNSUPPORTED_VERSION { found, supported }
 */
export function geoJsonToCoa(doc) {
  const invalid = (problems) => err(ErrorCode.IMPORT_INVALID, 'Not a valid COA document', { problems });
  if (!isObject(doc)) return invalid([{ field: '(root)', reason: 'must be a GeoJSON object' }]);
  if (isObject(doc.coa) && Number.isInteger(doc.coa.schemaVersion) && doc.coa.schemaVersion > COA_SCHEMA_VERSION) {
    return err(ErrorCode.UNSUPPORTED_VERSION, `COA document schema v${doc.coa.schemaVersion} is newer than this app supports`, {
      found: doc.coa.schemaVersion, supported: [COA_SCHEMA_VERSION],
    });
  }

  const problems = [];
  if (doc.type !== 'FeatureCollection') problems.push({ field: 'type', reason: 'must be "FeatureCollection"' });
  readCoaMember(doc.coa, problems);
  if (!Array.isArray(doc.features)) problems.push({ field: 'features', reason: 'must be an array' });

  const seenIds = new Set();
  const read = (Array.isArray(doc.features) ? doc.features : []).map((f, i) => readFeature(f, i, seenIds, problems));
  if (problems.length) return invalid(problems);
  const symbols = read.filter((r) => r.symbol).map((r) => r.symbol);
  const graphics = read.filter((r) => r.graphic).map((r) => r.graphic);

  const { id, name, description, revision, createdAt, updatedAt } = doc.coa;
  return ok(deepFreeze({
    id, name: name.trim(), description: description.trim(), createdAt, updatedAt, revision,
    ...('frame' in doc.coa ? { frame: parseFrame(doc.coa.frame).value } : {}),
    symbols: symbols.map(({ id: symbolId, sidc, position, label, modifiers }) => ({ id: symbolId, sidc, position, label, modifiers })),
    graphics,
  }));
}
