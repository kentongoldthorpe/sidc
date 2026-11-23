// Data export (COA-1.23): COAs → the text of a JSON, GeoJSON or CSV file.
//   json    – the coa-builder/import document (docs/IMPORT-FORMAT.md): everything, re-importable.
//   geojson – one RFC 7946 FeatureCollection for GIS tools: units as Points { coa, sidc, label, …modifiers },
//             lines as LineStrings, areas as Polygons, range rings as Points with a radius
//             { coa, kind, side, label, color?, radius? }. Re-importable; COAs with nothing on them,
//             descriptions and frames are not kept.
//   csv     – units only, one row per unit, columns named like the import fields, for spreadsheets.
//             Re-importable, with the same limits as GeoJSON.
import { writeCsv } from './csv.js';
import { graphicToFeature } from '../persistence/geojson-coa.js';
import { VERSION } from '../../shared/version.js';

export const CSV_COLUMNS = Object.freeze(['coa', 'sidc', 'lat', 'lng', 'label', 'higherFormation', 'additionalInformation', 'staffComments', 'dtg', 'quantity', 'direction']);

const unitOf = (s) => ({
  sidc: s.sidc, lat: s.position.lat, lng: s.position.lng,
  ...(s.label ? { label: s.label } : {}),
  ...Object.fromEntries(Object.entries(s.modifiers).filter(([, v]) => v !== '' && v !== undefined)),
});

function toImportDocument(coas) {
  return {
    format: 'coa-builder/import',
    version: 1,
    source: `COA Builder ${VERSION} export`,
    coas: coas.map((c) => ({
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      ...(c.frame ? { frame: c.frame } : {}),
      units: c.symbols.map(unitOf),
      ...(c.graphics.length ? { graphics: c.graphics.map(({ id, ...g }) => g) } : {}),
    })),
  };
}

function toGeoJson(coas) {
  return {
    type: 'FeatureCollection',
    features: coas.flatMap((c) => c.symbols.map((s) => {
      const { lat, lng, ...properties } = unitOf(s);
      return { type: 'Feature', id: s.id, geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { coa: c.name, ...properties } };
    }).concat(c.graphics.map((g) => {
      const feature = graphicToFeature(g);
      return { ...feature, properties: { coa: c.name, ...feature.properties } };
    }))),
  };
}

function toCsv(coas) {
  const rows = coas.flatMap((c) => c.symbols.map((s) => {
    const unit = { coa: c.name, ...unitOf(s) };
    return CSV_COLUMNS.map((col) => unit[col]);
  }));
  return writeCsv(CSV_COLUMNS, rows);
}

export const DATA_FORMATS = Object.freeze({
  json: Object.freeze({ label: 'JSON (complete, re-importable)', extension: 'json', mimeType: 'application/json', write: (coas) => `${JSON.stringify(toImportDocument(coas), null, 2)}\n` }),
  geojson: Object.freeze({ label: 'GeoJSON (GIS)', extension: 'geojson', mimeType: 'application/geo+json', write: (coas) => `${JSON.stringify(toGeoJson(coas), null, 2)}\n` }),
  csv: Object.freeze({ label: 'CSV (spreadsheet)', extension: 'csv', mimeType: 'text/csv', write: toCsv }),
});

/** @param {'json'|'geojson'|'csv'} format @param {import('../../domain/coa.js').Coa[]} coas @returns {string} */
export function writeCoaData(format, coas) {
  const f = Object.hasOwn(DATA_FORMATS, format) ? DATA_FORMATS[format] : null;
  if (!f) throw new Error(`Unknown data format "${format}"`);
  return f.write(coas);
}
