// How each collection is kept by the browser-storage and file adapters (D31: one storage port).
// Most collections are plain JSON documents. Two keep the places and formats they had before the
// port was unified, so existing data reads as it is:
//   coas      one GeoJSON FeatureCollection per COA (files: data/<id>.geojson, /api/coas;
//             browser: "<prefix>:coa:<id>")
//   settings  one document, id "settings" (files: data/settings.json, /api/settings;
//             browser: "<prefix>:settings"); stored without its id
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { coaToGeoJson, geoJsonToCoa } from './geojson-coa.js';

/** A stored value that cannot be read as a document of its collection. list() skips these. */
export const unreadable = (collection, id, problems = []) =>
  err(ErrorCode.STORAGE_UNAVAILABLE, `The stored ${collection}/${id} is not valid`, { collection, id, unreadable: true, problems });

const plain = { encode: (doc) => doc, decode: (stored) => ok(stored) };

const CODECS = {
  coas: {
    encode: coaToGeoJson,
    decode: (stored) => geoJsonToCoa(stored),
    contentType: 'application/geo+json',
  },
  settings: {
    encode: ({ id, ...settings }) => settings,
    decode: (stored) => (stored && typeof stored === 'object' && !Array.isArray(stored) ? ok({ id: 'settings', ...stored }) : err(ErrorCode.VALIDATION_FAILED, 'not an object')),
  },
};

/** { encode(doc) → stored JSON, decode(stored) → Result<doc>, contentType } for a collection. */
export function codecFor(collection) {
  return { contentType: 'application/json', ...plain, ...CODECS[collection] };
}

/** Decode a stored JSON text; an unreadable value gives the `unreadable` failure. */
export function decodeText(collection, id, text) {
  let stored;
  try { stored = JSON.parse(text); } catch { return unreadable(collection, id, [{ field: '(root)', reason: 'not valid JSON' }]); }
  const decoded = codecFor(collection).decode(stored);
  return decoded.ok ? decoded : unreadable(collection, id, decoded.error.details?.problems ?? []);
}

export const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
