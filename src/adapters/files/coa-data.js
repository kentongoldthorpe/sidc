// Data export (COA-1.23): COAs → the text of a JSON, GeoJSON or CSV file.
//   json    – the coa-builder/import document (docs/IMPORT-FORMAT.md): everything, re-importable.
//   geojson – GeoJSON v2 (Epic 5 X-2): one RFC 7946 FeatureCollection for GIS tools, from
//             exchange/features.js: units as Points with flat fields (weapon1_name …), lines,
//             areas, and range rings, sectors and weapon ranges as Polygons, with simplestyle
//             colours. Re-importable; COAs with nothing on them, descriptions and frames are not kept.
//   weapons – one CSV row per weapon per unit, keyed by unit id (for GIS joins). Not re-importable.
//   kml     – KML 2.2 (exchange/kml.js): a folder per COA, styled, every field in ExtendedData, the
//             marking in the document. KMZ (with 2525 symbol icons) is built in the export view.
//   nvg     – NATO Vector Graphics 2.0 (exchange/nvg.js) for C2 systems: a group per COA, units with
//             their symbol code. A TAK data package (CoT) is built in the export view (binary).
//   csv     – units only, one row per unit, columns named like the import fields, for spreadsheets.
//             Re-importable, with the same limits as GeoJSON; of the unit extras it keeps facing and hvt.
import { writeCsv } from './csv.js';
import { unitExtras } from '../persistence/geojson-coa.js';
import { coaFeatures } from '../exchange/features.js';
import { writeKml } from '../exchange/kml.js';
import { writeNvg } from '../exchange/nvg.js';

/** The KML document's title. */
export const titleOf = (coas) => (coas.length === 1 ? coas[0].name : `${coas.length} COAs`);
/** A header for a file written without one (tests, scripts): says so, rather than inventing a marking. */
const UNMARKED = Object.freeze({ classification: 'NO MARKING GIVEN', classificationColor: '#5b6157', project: '', exportedAt: '', dtg: '', application: 'COA Builder', format: 'kml', formatVersion: 1 });
import { VERSION } from '../../shared/version.js';
import { headerLine } from '../../domain/export-header.js';
import { mgrsOf } from '../../domain/mgrs.js';

export const CSV_COLUMNS = Object.freeze(['coa', 'sidc', 'lat', 'lng', 'mgrs', 'label', 'higherFormation', 'additionalInformation', 'staffComments', 'dtg', 'quantity', 'direction', 'facing', 'hvt']);

const unitOf = (s) => ({
  sidc: s.sidc, lat: s.position.lat, lng: s.position.lng,
  ...(s.label ? { label: s.label } : {}),
  ...Object.fromEntries(Object.entries(s.modifiers).filter(([, v]) => v !== '' && v !== undefined)),
  ...unitExtras(s), // facing, hvt, weapons, details (D28); CSV keeps facing and hvt only
});

function toImportDocument(coas, header) {
  return {
    format: 'coa-builder/import',
    version: 1,
    ...(header ? { header } : {}),
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

/** GeoJSON v2 (Epic 5 X-2): flat properties, rings, sectors and weapon ranges as polygons (exchange/features.js). */
function toGeoJson(coas, header) {
  return {
    type: 'FeatureCollection',
    ...(header ? { header } : {}), // a foreign member (RFC 7946 §6.1): GIS tools ignore it, readers can show the marking
    features: coaFeatures(coas),
  };
}

export const WEAPON_CSV_COLUMNS = Object.freeze(['coa', 'unit_id', 'unit_label', 'sidc', 'hvt', 'lat', 'lng', 'facing_deg', 'weapon', 'role', 'max_m', 'min_m', 'arc_deg']);
/** One row per weapon per unit, keyed by unit id: the weapons table GIS joins to the units. */
function toWeaponsCsv(coas, header) {
  const rows = coas.flatMap((c) => c.symbols.flatMap((u) => (u.weapons ?? []).map((w) => [
    c.name, u.id, u.label, u.sidc, u.hvt === true, u.position.lat, u.position.lng, u.facing ?? '', w.name, w.role, w.maxRange, w.minRange ?? '', w.arc,
  ])));
  return withHeaderLine(writeCsv(WEAPON_CSV_COLUMNS, rows), header);
}

const withHeaderLine = (csv, header) => {
  if (!header) return csv;
  const bom = csv.startsWith('\uFEFF') ? '\uFEFF' : '';
  const versions = (header.versions ?? []).map((v) => `# version ${String(v.coa).replace(/[\r\n]/g, ' ')}: ${v.fingerprint}\r\n`).join(''); // E6-3
  return `${bom}${headerLine(header)}\r\n${versions}${csv.slice(bom.length)}`; // the marking as the first line
};

function toCsv(coas, header) {
  const rows = coas.flatMap((c) => c.symbols.map((s) => {
    const unit = { coa: c.name, ...unitOf(s), mgrs: mgrsOf(s.position) ?? '' }; // MGRS too, for spreadsheets and printed lists (E6-1)
    return CSV_COLUMNS.map((col) => unit[col]);
  }));
  return withHeaderLine(writeCsv(CSV_COLUMNS, rows), header);
}

export const DATA_FORMATS = Object.freeze({
  json: Object.freeze({ label: 'JSON (complete, re-importable)', extension: 'json', mimeType: 'application/json', write: (coas, header) => `${JSON.stringify(toImportDocument(coas, header), null, 2)}\n` }),
  geojson: Object.freeze({ label: 'GeoJSON (GIS)', extension: 'geojson', mimeType: 'application/geo+json', write: (coas, header) => `${JSON.stringify(toGeoJson(coas, header), null, 2)}\n` }),
  csv: Object.freeze({ label: 'CSV (spreadsheet)', extension: 'csv', mimeType: 'text/csv', write: toCsv }),
  weapons: Object.freeze({ label: 'Weapons (CSV)', extension: 'csv', mimeType: 'text/csv', write: toWeaponsCsv }),
  kml: Object.freeze({ label: 'KML (Google Earth, TAK)', extension: 'kml', mimeType: 'application/vnd.google-earth.kml+xml', write: (coas, header) => writeKml(coaFeatures(coas), { header: header ?? UNMARKED, title: titleOf(coas) }) }),
  nvg: Object.freeze({ label: 'NVG 2.0 (C2 systems)', extension: 'nvg', mimeType: 'application/xml', write: (coas, header) => writeNvg(coaFeatures(coas), { header: header ?? UNMARKED, title: titleOf(coas) }) }),
});

/**
 * @param {'json'|'geojson'|'csv'} format @param {import('../../domain/coa.js').Coa[]} coas
 * @param {{ header?: object }} [options] header: from export.header (marking, project, DTG); every file the app writes has one
 * @returns {string}
 */
export function writeCoaData(format, coas, { header = null } = {}) {
  const f = Object.hasOwn(DATA_FORMATS, format) ? DATA_FORMATS[format] : null;
  if (!f) throw new Error(`Unknown data format "${format}"`);
  return f.write(coas, header);
}
