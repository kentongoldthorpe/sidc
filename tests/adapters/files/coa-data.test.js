// Data export (COA-1.23) and re-import (COA-1.24), tested at the adapter boundaries:
// COAs from the real application → file text (writeCoaData) → readImportFile → coa.import.
// Reason for testing file details (quoting, columns, BOM): the files themselves are a boundary,
// read by spreadsheets, GIS tools and the user's other systems.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeCoaData, DATA_FORMATS } from '../../../src/adapters/files/coa-data.js';
import { slideFileName } from '../../../src/adapters/export/slide-layout.js';
import { readImportFile } from '../../../src/adapters/files/import-file.js';
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
    assert.deepEqual(Object.keys(DATA_FORMATS), ['json', 'geojson', 'csv', 'weapons', 'kml', 'nvg']);
    assert.deepEqual(Object.values(DATA_FORMATS).map((f) => [f.extension, f.mimeType]), [
      ['json', 'application/json'], ['geojson', 'application/geo+json'], ['csv', 'text/csv'], ['csv', 'text/csv'], ['kml', 'application/vnd.google-earth.kml+xml'], ['nvg', 'application/xml'],
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

  it('GeoJSON (v2) is one RFC 7946 FeatureCollection: units as Points with flat fields, tagged with their COA and layer', async () => {
    const coas = await appWithCoas();
    const doc = JSON.parse(writeCoaData('geojson', coas));
    assert.equal(doc.type, 'FeatureCollection');
    assert.equal(doc.features.length, 6);
    assert.deepEqual(doc.features[0].geometry, { type: 'Point', coordinates: [-118.35, 34.21] });
    assert.deepEqual(doc.features[0].properties, { coa: 'COA 1, "North"', layer: 'unit', sidc: INF, label: '1-22 IN', higherFormation: '1 BCT', direction: 135, hvt: false, mgrs: '11S LT 75633 86264', 'marker-color': '#1f4fbf' });
    assert.equal(doc.features[0].id, coas[0].symbols[0].id);
  });

  it('GeoJSON (v2) holds lines as LineStrings, areas as closed Polygons, and range rings as Polygons that keep their centre and radius', async () => {
    const doc = JSON.parse(writeCoaData('geojson', await appWithCoas()));
    const graphics = doc.features.filter((f) => f.properties.layer === 'graphic');
    assert.deepEqual(graphics.map((f) => [f.geometry.type, f.properties.coa, f.properties.kind]), [
      ['LineString', 'COA 1, "North"', 'phaseLine'], ['Polygon', 'COA 1, "North"', 'objective'], ['Polygon', 'COA 1, "North"', 'rangeRing'],
    ]);
    for (const g of graphics.slice(1)) assert.deepEqual(g.geometry.coordinates[0].at(-1), g.geometry.coordinates[0][0], 'closed');
    const ring = graphics[2].properties;
    assert.deepEqual([ring.centerLat, ring.centerLng, ring.radius], [34, -118, 12000]);
    assert.deepEqual([ring.stroke, ring.fill, graphics[1].properties.stroke], ['#1f4fbf', '#1f4fbf', '#000000'], 'simplestyle colours: the side, or the chosen colour');
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
    assert.equal(lines[0], 'coa,sidc,lat,lng,mgrs,label,higherFormation,additionalInformation,staffComments,dtg,quantity,direction,facing,hvt');
    assert.equal(lines[1], `"COA 1, ""North""",${INF},34.21,-118.35,11S LT 75633 86264,1-22 IN,1 BCT,,,,,135,,`);
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

describe('the export header (Epic 5 X-1): the marking travels with the data', () => {
  const HEADER = { classification: 'SECRET//REL TO USA, FVEY', classificationColor: '#c8102e', project: 'Exercise IRON', exportedAt: '2026-11-24T21:05:00.000Z', dtg: '242105ZNOV26', application: 'COA Builder 0.2.0', format: 'csv', formatVersion: 1 };

  it('JSON and GeoJSON carry it as a header object, and still import', async () => {
    const coas = await appWithCoas();
    for (const format of ['json', 'geojson']) {
      const text = writeCoaData(format, coas, { header: { ...HEADER, format } });
      assert.deepEqual(JSON.parse(text).header, { ...HEADER, format });
      assert.equal((await reimport(text)).length, (await reimport(writeCoaData(format, coas))).length, format);
    }
  });

  it('CSV has the marking as its first line, and still imports', async () => {
    const coas = await appWithCoas();
    const text = writeCoaData('csv', coas, { header: HEADER });
    assert.equal(text.slice(1).split('\r\n')[0], '# SECRET//REL TO USA, FVEY // Exercise IRON // exported 242105ZNOV26 // COA Builder 0.2.0 // csv v1');
    assert.equal((await reimport(text)).length, (await reimport(writeCoaData('csv', coas))).length);
  });
});

describe('GeoJSON v2 and the weapons CSV (Epic 5 X-2)', () => {
  const RICH = { format: 'coa-builder/import', version: 1, coas: [{ name: 'SITTEMP', units: [
    { sidc: '10061000001211000000', lat: 34, lng: -118, label: 'AD Bty', facing: 90, hvt: true,
      weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 12000 }, { name: 'Gun', role: 'direct', maxRange: 2500, minRange: 100, arc: 60 }],
      details: { strength: '4 TELAR', equipment: [{ name: 'SA-15', count: 4 }, { name: 'Radar', count: 1 }], reference: 'Unit guide 2025' } },
  ], graphics: [{ kind: 'sector', side: 'hostile', label: 'Fires', center: { lat: 34.1, lng: -118 }, radius: 3000, minRadius: 500, bearing: 45, arc: 90 }] }] };

  it('writes a unit\'s weapons and details as flat fields, and each weapon range as a Polygon', async () => {
    const doc = JSON.parse(writeCoaData('geojson', await appWithCoas(RICH)));
    const unit = doc.features.find((f) => f.properties.layer === 'unit').properties;
    assert.deepEqual(unit, {
      coa: 'SITTEMP', layer: 'unit', sidc: '10061000001211000000', label: 'AD Bty', facing: 90, hvt: true,
      strength: '4 TELAR', equipment: 'SA-15 x4; Radar x1', reference: 'Unit guide 2025',
      weapon1_name: 'SA-15', weapon1_role: 'airDefence', weapon1_max_m: 12000, weapon1_arc_deg: 360,
      weapon2_name: 'Gun', weapon2_role: 'direct', weapon2_max_m: 2500, weapon2_min_m: 100, weapon2_arc_deg: 60,
      mgrs: '11S MT 07650 62606', 'marker-color': '#d0021b',
    });
    const ranges = doc.features.filter((f) => f.properties.layer === 'weapon');
    assert.deepEqual(ranges.map((f) => [f.geometry.type, f.properties.weapon_name, f.properties.max_m, f.properties.bearing_deg, f.properties.stroke]), [
      ['Polygon', 'SA-15', 12000, 0, '#7b3fa0'], ['Polygon', 'Gun', 2500, 90, '#c8102e'],
    ]);
  });

  it('writes a sector as a closed Polygon with its parameters, and reads it all back exactly', async () => {
    const coas = await appWithCoas(RICH);
    const text = writeCoaData('geojson', coas);
    const sector = JSON.parse(text).features.find((f) => f.properties.kind === 'sector');
    assert.equal(sector.geometry.type, 'Polygon');
    assert.deepEqual([sector.properties.radius, sector.properties.minRadius, sector.properties.bearing, sector.properties.arc], [3000, 500, 45, 90]);
    const [again] = await reimport(text);
    const strip = ({ id, ...x }) => x;
    assert.deepEqual(again.symbols.map(strip), coas[0].symbols.map(strip), 'weapons, details, facing and HVT come back');
    assert.deepEqual(again.graphics.map(strip), coas[0].graphics.map(strip));
  });

  it('writes a weapons CSV: one row per weapon per unit, keyed by unit id', async () => {
    const coas = await appWithCoas(RICH);
    const lines = writeCoaData('weapons', coas).slice(1).trim().split('\r\n');
    assert.equal(lines[0], 'coa,unit_id,unit_label,sidc,hvt,lat,lng,facing_deg,weapon,role,max_m,min_m,arc_deg');
    assert.deepEqual(lines.slice(1), [
      `SITTEMP,${coas[0].symbols[0].id},AD Bty,10061000001211000000,true,34,-118,90,SA-15,airDefence,12000,,360`,
      `SITTEMP,${coas[0].symbols[0].id},AD Bty,10061000001211000000,true,34,-118,90,Gun,direct,2500,100,60`,
    ]);
  });
});
