// Data export (COA-1.23) and re-import (COA-1.24), tested at the adapter boundaries:
// COAs from the real application → file text (writeCoaData) → readImportFile → coa.import.
// Reason for testing file details (quoting, columns, BOM): the files themselves are a boundary,
// read by spreadsheets, GIS tools and the user's other systems.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeCoaData, DATA_FORMATS } from '../../../src/adapters/export/coa-data.js';
import { slideFileName } from '../../../src/adapters/export/slide-layout.js';
import { readImportFile } from '../../../src/adapters/persistence/import-file.js';
import { createHarness, okValue, errorOf } from '../../support/app-harness.js';
import { readdirSync, readFileSync } from 'node:fs';

const INF = '10031000161211000000';
const ARMOR = '10031000161205000000';
const source = {
  format: 'coa-builder/import', version: 1,
  coas: [
    {
      name: 'COA 1, "North"', description: 'Envelop =from the north',
      frame: { aspect: '4:3', center: { lat: 34.1, lng: -118.2 }, width: 0.5 },
      units: [
        { sidc: INF, lat: 34.21, lng: -118.35, label: '1-22 IN', higherFormation: '1 BCT', direction: 135 },
        { sidc: ARMOR, lat: -12.5, lng: 170.25, label: '=SUM(A1)', staffComments: 'line one\nline two', dtg: '241200ZMAR24', quantity: '18', additionalInformation: '+est' },
      ],
      graphics: [
        { kind: 'phaseLine', label: 'PL GOLD', points: [{ lat: 34, lng: -118 }, { lat: 34.3, lng: -117.9 }] },
        { kind: 'objective', side: 'hostile', color: '#000000', label: 'OBJ IRON', points: [{ lat: 34, lng: -118 }, { lat: 34.1, lng: -118 }, { lat: 34.1, lng: -117.9 }] },
        { kind: 'rangeRing', center: { lat: 34, lng: -118 }, radius: 12000 },
      ],
    },
    { name: 'COA 2', units: [{ sidc: 'SFGPUCI----D---', lat: 0, lng: 0 }] },
    { name: 'COA 3 (empty)', description: 'no units' },
  ],
};

async function appWithCoas(doc = source) {
  const app = createHarness();
  const { coas } = okValue(await app.dispatch('coa.import', { document: doc }));
  const full = [];
  for (const c of coas) full.push(okValue(await app.query('coa.get', { coaId: c.id })));
  return full;
}
const content = (coa) => ({
  name: coa.name, description: coa.description, frame: coa.frame,
  symbols: coa.symbols.map(({ sidc, position, label, modifiers }) => ({ sidc, position, label, modifiers })),
  graphics: coa.graphics.map(({ id, ...g }) => g),
});
async function reimport(text) {
  const read = readImportFile(text);
  assert.equal(read.ok, true, JSON.stringify(read.error));
  return okValue(await createHarness().dispatch('coa.import', { document: read.value.document })).coas;
}

describe('writeCoaData', () => {
  it('offers JSON, GeoJSON and CSV with extensions and media types', () => {
    assert.deepEqual(Object.keys(DATA_FORMATS), ['json', 'geojson', 'csv']);
    assert.deepEqual(Object.values(DATA_FORMATS).map((f) => [f.extension, f.mimeType]), [
      ['json', 'application/json'], ['geojson', 'application/geo+json'], ['csv', 'text/csv'],
    ]);
  });

  it('JSON is the coa-builder/import document and round-trips everything (names, descriptions, frames, modifiers, empty COAs)', async () => {
    const coas = await appWithCoas();
    const text = writeCoaData('json', coas);
    const doc = JSON.parse(text);
    assert.equal(doc.format, 'coa-builder/import');
    assert.equal(doc.version, 1);
    const again = await reimport(text);
    assert.deepEqual(again.map(content), coas.map(content));
  });

  it('JSON leaves out empty labels and modifiers, so files stay readable', async () => {
    const doc = JSON.parse(writeCoaData('json', await appWithCoas()));
    assert.deepEqual(doc.coas[1].units[0], { sidc: 'SFGPUCI----D---', lat: 0, lng: 0 });
    assert.equal('frame' in doc.coas[1], false);
  });

  it('GeoJSON is one RFC 7946 FeatureCollection of points tagged with their COA name', async () => {
    const coas = await appWithCoas();
    const doc = JSON.parse(writeCoaData('geojson', coas));
    assert.equal(doc.type, 'FeatureCollection');
    assert.equal(doc.features.length, 6);
    assert.deepEqual(doc.features[0].geometry, { type: 'Point', coordinates: [-118.35, 34.21] });
    assert.deepEqual(doc.features[0].properties, { coa: 'COA 1, "North"', sidc: INF, label: '1-22 IN', higherFormation: '1 BCT', direction: 135 });
    assert.equal(doc.features[0].id, coas[0].symbols[0].id);
  });

  it('GeoJSON holds lines as LineStrings, areas as closed Polygons and range rings as Points with a radius, tagged with their COA', async () => {
    const doc = JSON.parse(writeCoaData('geojson', await appWithCoas()));
    const graphics = doc.features.filter((f) => 'kind' in f.properties);
    assert.deepEqual(graphics.map((f) => [f.geometry.type, f.properties.coa, f.properties.kind]), [
      ['LineString', 'COA 1, "North"', 'phaseLine'], ['Polygon', 'COA 1, "North"', 'objective'], ['Point', 'COA 1, "North"', 'rangeRing'],
    ]);
    assert.deepEqual(graphics[1].geometry.coordinates[0].at(-1), graphics[1].geometry.coordinates[0][0]);
    assert.deepEqual(graphics[2].properties, { coa: 'COA 1, "North"', kind: 'rangeRing', side: 'friendly', label: '', radius: 12000 });
  });

  it('GeoJSON round-trips the units and graphics of each COA (COAs with nothing on them, descriptions and frames are not in GeoJSON)', async () => {
    const coas = await appWithCoas();
    const again = await reimport(writeCoaData('geojson', coas));
    assert.deepEqual(again.map((c) => c.name), ['COA 1, "North"', 'COA 2']);
    assert.deepEqual(again.map((c) => [content(c).symbols, content(c).graphics]), coas.slice(0, 2).map((c) => [content(c).symbols, content(c).graphics]));
  });

  it('CSV holds units only', async () => {
    const text = writeCoaData('csv', await appWithCoas());
    assert.equal(text.trim().split('\r\n').length, 1 + 3);
    assert.doesNotMatch(text, /PL GOLD/);
  });

  it('CSV has a header named like the import fields, one row per unit, CRLF lines and a UTF-8 BOM for Excel', async () => {
    const text = writeCoaData('csv', await appWithCoas());
    assert.ok(text.startsWith('\uFEFF'));
    const lines = text.slice(1).split('\r\n');
    assert.equal(lines[0], 'coa,sidc,lat,lng,label,higherFormation,additionalInformation,staffComments,dtg,quantity,direction');
    assert.equal(lines[1], `"COA 1, ""North""",${INF},34.21,-118.35,1-22 IN,1 BCT,,,,,135`);
    assert.equal(lines.at(-1), '');
  });

  it('CSV quotes line breaks and defuses text cells that a spreadsheet would run as a formula', async () => {
    const text = writeCoaData('csv', await appWithCoas());
    assert.match(text, /,'=SUM\(A1\),/);
    assert.match(text, /,'\+est,/);
    assert.match(text, /"line one\nline two"/);
    assert.match(text, /,-12\.5,170\.25,/); // numbers are not defused
  });

  it('CSV round-trips the units, including quoted, multi-line and defused cells', async () => {
    const coas = await appWithCoas();
    const again = await reimport(writeCoaData('csv', coas));
    assert.deepEqual(again.map((c) => c.name), ['COA 1, "North"', 'COA 2']);
    assert.deepEqual(again.map((c) => content(c).symbols), coas.slice(0, 2).map((c) => content(c).symbols));
  });

  it('refuses an unknown format', () => {
    assert.throws(() => writeCoaData('xml', []), /Unknown data format "xml"/);
  });

  it('names files like slides, with the data extension', () => {
    assert.equal(slideFileName('COA 1, "North"', '230215ZNOV26', 'csv'), 'coa-1-north_230215ZNOV26.csv');
    assert.equal(slideFileName('COA 1', '230215ZNOV26'), 'coa-1_230215ZNOV26.png');
  });
});

describe('readImportFile: CSV and GeoJSON files from other tools', () => {
  const csv = (...rows) => rows.join('\n');

  it('reads a hand-written CSV (LF lines, no BOM, columns in any order, blank lines skipped)', async () => {
    const coas = await reimport(csv('lng,lat,sidc,coa,label', `-118.2,34.1,${INF},Plan A,A1`, '', `10,20,${ARMOR},Plan B,`));
    assert.deepEqual(coas.map((c) => [c.name, c.symbols.length]), [['Plan A', 1], ['Plan B', 1]]);
    assert.deepEqual(coas[0].symbols[0].position, { lat: 34.1, lng: -118.2 });
  });

  it('reports CSV problems by row and column, not by document path', async () => {
    const read = readImportFile(csv('coa,sidc,lat,lng,colour', `Plan A,${INF},34,-118,red`, `Plan A,nope,abc,-118,`));
    assert.equal(read.ok, true);
    const error = errorOf(await createHarness().dispatch('coa.import', { document: read.value.document }), 'IMPORT_INVALID');
    const located = error.details.problems.map((p) => read.value.where(p.field));
    assert.ok(located.includes('row 2, column colour'), located.join(' | '));
    assert.ok(located.includes('row 3, column sidc'), located.join(' | '));
    assert.ok(located.includes('row 3, column lat'), located.join(' | '));
  });

  it('refuses a CSV without the required columns, naming them', () => {
    const read = readImportFile(csv('name,lat,lng', 'A,1,2'));
    assert.equal(read.ok, false);
    assert.equal(read.error.code, 'IMPORT_INVALID');
    assert.deepEqual(read.error.details.problems.map((p) => p.field), ['column coa', 'column sidc']);
  });

  it('refuses a CSV with an unclosed quote', () => {
    const read = readImportFile(csv('coa,sidc,lat,lng', `"Plan A,${INF},1,2`));
    assert.equal(read.ok, false);
    assert.match(read.error.details.problems[0].reason, /quote/);
  });

  it('reports GeoJSON problems by feature', async () => {
    const doc = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 1] }, properties: { coa: 'A', sidc: 'bad' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [2, 95] }, properties: { coa: 'A', sidc: INF } },
    ] };
    const read = readImportFile(JSON.stringify(doc));
    const error = errorOf(await createHarness().dispatch('coa.import', { document: read.value.document }), 'IMPORT_INVALID');
    assert.deepEqual(error.details.problems.map((p) => read.value.where(p.field)).sort(),
      ['features[0].properties.sidc', 'features[1].geometry.coordinates[1]']);
  });

  it('refuses GeoJSON features that are not points or have no COA name', () => {
    const read = readImportFile(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { coa: 'A', sidc: INF } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { sidc: INF } },
    ] }));
    assert.equal(read.ok, false);
    assert.deepEqual(read.error.details.problems.map((p) => p.field), ['features[0].geometry', 'features[1].properties.coa']);
  });
});

describe('docs/import/examples: the CSV and GeoJSON examples import', () => {
  const dir = new URL('../../../docs/import/examples/', import.meta.url).pathname;
  const files = readdirSync(dir).filter((f) => /\.(csv|geojson)$/.test(f));
  it('has a CSV and a GeoJSON example', () => assert.deepEqual(files.map((f) => f.split('.').pop()).sort(), ['csv', 'geojson']));
  for (const file of files) {
    it(file, async () => {
      const coas = await reimport(readFileSync(dir + file, 'utf8'));
      assert.equal(coas.length, 2);
    });
  }
});
