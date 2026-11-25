// Import file adapter: the text of a file the user picked → the coa.import document
// (docs/IMPORT-FORMAT.md), plus `where(field)`, which turns a problem's document path back into a
// place in the file (CSV row and column, GeoJSON feature). Understood:
//   - a coa-builder/import document: passed on as it is; the application validates it;
//   - a COA Builder storage file (one FeatureCollection with a "coa" member, as serve.ps1 stores);
//   - a FeatureCollection of Points whose properties name their "coa" (our GeoJSON export, GIS tools);
//   - CSV with a header row: coa, sidc, and lat + lng or mgrs (or all three, if they agree), then
//     optional label and modifier columns.
// Anything else that is JSON is passed on too, so the application can say what the format must be.
// Every import makes new COAs; units (and lines, areas, range rings from GeoJSON) are grouped into
// COAs by their COA name, in file order.
import { geoJsonToCoa, readGraphicFeature, unitExtras } from '../persistence/geojson-coa.js';
import { readCsv, undefuse } from './csv.js';
import { fromExchangeFeature } from '../exchange/features.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { isObject } from '../../shared/values.js';

const invalid = (message, problems) => err(ErrorCode.IMPORT_INVALID, message, { problems });
const same = (field) => field;
const IMPORT_HEADER = { format: 'coa-builder/import', version: 1 };
const UNIT_PATH = /^coas\[(\d+)\]\.units\[(\d+)\](?:\.(.+))?$/;
const GRAPHIC_PATH = /^coas\[(\d+)\]\.graphics\[(\d+)\](?:\.(.+))?$/;

/** Groups units by COA name (file order) and remembers where each unit came from. */
function grouper() {
  const coas = new Map();
  const group = (name) => {
    if (!coas.has(name)) coas.set(name, { units: [], origins: [], graphics: [], graphicOrigins: [] });
    return coas.get(name);
  };
  return {
    add(name, unit, origin) {
      group(name).units.push(unit);
      group(name).origins.push(origin);
    },
    addGraphic(name, graphic, origin) {
      group(name).graphics.push(graphic);
      group(name).graphicOrigins.push(origin);
    },
    document: (source) => ({
      ...IMPORT_HEADER, source,
      coas: [...coas].map(([name, c]) => ({ name, units: c.units, ...(c.graphics.length ? { graphics: c.graphics } : {}) })),
    }),
    /** @param {(origin: any, rest?: string) => string} locate */
    where: (locate) => (field) => {
      const g = GRAPHIC_PATH.exec(field);
      if (g) {
        const origin = [...coas.values()][Number(g[1])]?.graphicOrigins[Number(g[2])];
        return origin === undefined ? field : `features[${origin}]`; // checked in file terms already; the app's check is a backstop
      }
      const m = UNIT_PATH.exec(field);
      if (!m) {
        const name = /^coas\[(\d+)\]\.name$/.exec(field);
        return name ? `COA name "${[...coas.keys()][Number(name[1])]}"` : field;
      }
      const origin = [...coas.values()][Number(m[1])]?.origins[Number(m[2])];
      return origin === undefined ? field : locate(origin, m[3]);
    },
  };
}

// ---- CSV ----
/** Version lines before the header row (E6-3): "# version COA 1: K7Q3-MD2A", or "# version: K7Q3-MD2A" on a change sheet. */
function csvVersions(text) {
  const versions = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('#')) break;
    const m = /^#\s*version\b\s*(.*?)\s*:\s*([0-9A-Za-z][0-9A-Za-z -]{6,10})\s*$/i.exec(line);
    if (m) versions.push({ ...(m[1] ? { coa: m[1] } : {}), fingerprint: m[2].trim() });
  }
  return versions;
}
const REQUIRED_COLUMNS = ['coa', 'sidc'];
const NUMBER_COLUMNS = ['lat', 'lng', 'direction', 'facing'];
const BOOLEAN_COLUMNS = { hvt: { true: true, yes: true, 1: true, false: false, no: false, 0: false } };
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

function readCsvFile(text) {
  const parsed = readCsv(text);
  if (!parsed.ok) return invalid('The CSV file could not be read', [{ field: `row ${parsed.line}`, reason: parsed.reason }]);
  const [head, ...rows] = parsed.rows;
  const header = (head?.cells ?? []).map((h) => h.trim());
  // A change sheet (E6-3: an action column) names items by label; it needs no coa, sidc or position
  // columns, as only the rows that add a unit need them (docs/CHANGE-SHEETS.md).
  const changeSheet = header.includes('action');
  const required = changeSheet ? ['label'] : REQUIRED_COLUMNS;
  const problems = required.filter((c) => !header.includes(c)).map((c) => ({ field: `column ${c}`, reason: 'is required in the header row' }));
  // A position: lat and lng columns, or an mgrs column (E6-1), or all three.
  if (!changeSheet && !header.includes('mgrs')) problems.push(...['lat', 'lng'].filter((c) => !header.includes(c)).map((c) => ({ field: `column ${c}`, reason: 'is required in the header row (or give an mgrs column)' })));
  header.forEach((h, i) => { if (header.indexOf(h) !== i) problems.push({ field: `column ${h}`, reason: 'appears more than once' }); });
  if (problems.length) return invalid('The CSV header is missing columns', problems);

  const groups = grouper();
  for (const { line, cells } of rows) {
    if (cells.length > header.length) { problems.push({ field: `row ${line}`, reason: `has ${cells.length} cells but the header has ${header.length}` }); continue; }
    const unit = {};
    let coa = '';
    header.forEach((column, i) => {
      const cell = (cells[i] ?? '').trim();
      if (cell === '') return;
      if (column === 'coa') coa = undefuse(cell);
      else if (NUMBER_COLUMNS.includes(column)) unit[column] = NUMBER.test(cell) ? Number(cell) : cell;
      else if (column in BOOLEAN_COLUMNS) unit[column] = BOOLEAN_COLUMNS[column][cell.toLowerCase()] ?? cell;
      else unit[column] = undefuse(cell);
    });
    if (coa === '' && changeSheet) coa = 'Changes'; // a change sheet is for the COA being updated
    if (coa === '') { problems.push({ field: `row ${line}, column coa`, reason: 'is empty' }); continue; }
    groups.add(coa, unit, line);
  }
  if (problems.length) return invalid('The CSV file has problems', problems);
  if (rows.length === 0) return invalid('The CSV file has no units', [{ field: 'row 2', reason: 'no rows after the header' }]);
  const versions = csvVersions(text);
  const document = { ...groups.document('CSV file'), ...(versions.length ? { header: { versions } } : {}) };
  return ok({ document, where: groups.where((line, column) => (column ? `row ${line}, column ${column}` : `row ${line}`)) });
}

// ---- GeoJSON from GIS tools / our export ----
function readFeatureCollection(doc) {
  if (!Array.isArray(doc.features)) return invalid('Not a GeoJSON FeatureCollection', [{ field: 'features', reason: 'must be an array' }]);
  const problems = [];
  const groups = grouper();
  let count = 0;
  doc.features.forEach((raw, k) => {
    const at = `features[${k}]`;
    if (!isObject(raw) || raw.type !== 'Feature') { problems.push({ field: at, reason: 'must be a Feature' }); return; }
    const f = fromExchangeFeature(raw); // GeoJSON v2 (our export): flat fields and polygons back to what is read below
    if (f === null) return; // a weapon range: drawn from its unit, not imported
    count += 1;
    const { coa, ...properties } = isObject(f.properties) ? f.properties : {};
    if (typeof coa !== 'string' || coa.trim() === '') { problems.push({ field: `${at}.properties.coa`, reason: 'must name the COA it belongs to' }); return; }
    if ('kind' in properties) { // a line, area or range ring
      const read = readGraphicFeature({ ...f, properties }, at, problems);
      if (read) { const { id, ...graphic } = read.graphic; groups.addGraphic(coa.trim(), graphic, k); }
      return;
    }
    if (!isObject(f.geometry) || f.geometry.type !== 'Point') { problems.push({ field: `${at}.geometry`, reason: 'must be a Point for a unit (or give properties.kind for a line, area or range ring)' }); return; }
    if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) { problems.push({ field: `${at}.geometry.coordinates`, reason: 'must be [longitude, latitude]' }); return; }
    const [lng, lat] = f.geometry.coordinates;
    groups.add(coa.trim(), { ...properties, lat, lng }, k);
  });
  if (problems.length) return invalid('The GeoJSON file has problems', problems);
  if (count === 0) return invalid('The GeoJSON file has no units', [{ field: 'features', reason: 'is empty' }]);
  return ok({
    document: { ...groups.document('GeoJSON file'), ...(Array.isArray(doc.header?.versions) ? { header: { versions: doc.header.versions } } : {}) },
    where: groups.where((k, field) => {
      if (field === 'lat') return `features[${k}].geometry.coordinates[1]`;
      if (field === 'lng') return `features[${k}].geometry.coordinates[0]`;
      return field ? `features[${k}].properties.${field}` : `features[${k}]`;
    }),
  });
}

/** One COA Builder storage file → an import document (a new copy). */
function readStorageFile(doc) {
  const read = geoJsonToCoa(doc);
  if (!read.ok) return read;
  const coa = read.value;
  return ok({
    document: {
      ...IMPORT_HEADER,
      source: 'COA Builder GeoJSON file',
      coas: [{
        name: coa.name,
        description: coa.description,
        ...(coa.frame ? { frame: coa.frame } : {}),
        units: coa.symbols.map((s) => ({ sidc: s.sidc, lat: s.position.lat, lng: s.position.lng, label: s.label, ...s.modifiers, ...unitExtras(s) })),
        ...(coa.graphics.length ? { graphics: coa.graphics.map(({ id, ...g }) => g) } : {}),
      }],
    },
    where: same,
  });
}

/**
 * @param {string} text
 * @returns {import('../../shared/result.js').Result<{ document: object, where: (field: string) => string }>}
 */
export function readImportFile(text) {
  const start = text.replace(/^\uFEFF/, '').trimStart();
  if (!start.startsWith('{') && !start.startsWith('[')) {
    // CSV: the first line that is not a # comment (our exports start with the marking line) has commas.
    const first = start.split(/\r?\n/).find((l) => l.trim() !== '' && !l.trimStart().startsWith('#')) ?? '';
    if (first.includes(',')) return readCsvFile(text);
    return invalid('The file is not JSON or CSV; see docs/IMPORT-FORMAT.md', [{ field: '(file)', reason: 'is not JSON or CSV' }]);
  }
  let doc;
  try {
    doc = JSON.parse(start);
  } catch {
    return invalid('The file is not JSON; see docs/IMPORT-FORMAT.md for the import format', [{ field: '(file)', reason: 'is not JSON' }]);
  }
  if (isObject(doc) && doc.type === 'FeatureCollection') return 'coa' in doc ? readStorageFile(doc) : readFeatureCollection(doc);
  return ok({ document: doc, where: same });
}
