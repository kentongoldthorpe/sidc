// Import file adapter: the text of a file the user picked → the coa.import document
// (docs/IMPORT-FORMAT.md). Two kinds of file are understood:
//   - a coa-builder/import document: passed on as it is; the application validates it;
//   - a COA Builder GeoJSON file (one FeatureCollection per COA, as serve.ps1 stores): read with the
//     same rules as storage, then turned into an import document, so it is imported as a new copy.
// Anything else that is JSON is passed on too, so the application can say what the format must be.
import { geoJsonToCoa } from './geojson-coa.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @param {string} text @returns {import('../../shared/result.js').Result<object>} the import document */
export function readImportFile(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return err(ErrorCode.IMPORT_INVALID, 'The file is not JSON; see docs/IMPORT-FORMAT.md for the import format', {
      problems: [{ field: '(file)', reason: 'is not JSON' }],
    });
  }
  if (!isObject(doc) || doc.type !== 'FeatureCollection') return ok(doc);

  const read = geoJsonToCoa(doc);
  if (!read.ok) return read;
  const coa = read.value;
  return ok({
    format: 'coa-builder/import',
    version: 1,
    source: 'COA Builder GeoJSON file',
    coas: [{
      name: coa.name,
      description: coa.description,
      ...(coa.frame ? { frame: coa.frame } : {}),
      units: coa.symbols.map((s) => ({ sidc: s.sidc, lat: s.position.lat, lng: s.position.lng, label: s.label, ...s.modifiers })),
    }],
  });
}
