// COA-3.1: the GeoJSON COA document format.
// Tested directly (a specific reason under the boundary-only rule): the file format IS a boundary.
// QGIS/ArcGIS, serve.ps1, browser storage and imports all depend on its exact shape.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coaToGeoJson, geoJsonToCoa, COA_SCHEMA_VERSION } from '../../../src/adapters/persistence/geojson-coa.js';

const COA = {
  id: 'coa-1', name: 'Envelopment', description: 'Main effort north', revision: 4,
  createdAt: '2026-11-22T20:40:00.000Z', updatedAt: '2026-11-22T20:45:00.000Z',
  symbols: [
    { id: 'sym-1', sidc: '10031000001211000000', position: { lat: 34.05, lng: -117.6 }, label: 'A/1-5', modifiers: { higherFormation: '1-5 INF', direction: 90 } },
    { id: 'sym-2', sidc: 'SHGPUCAA--*****', position: { lat: -10, lng: 179.5 }, label: '', modifiers: {} },
  ],
  graphics: [],
};

const DOC = {
  type: 'FeatureCollection',
  coa: {
    schemaVersion: 3, id: 'coa-1', name: 'Envelopment', description: 'Main effort north', revision: 4,
    createdAt: '2026-11-22T20:40:00.000Z', updatedAt: '2026-11-22T20:45:00.000Z',
  },
  features: [
    { type: 'Feature', id: 'sym-1', geometry: { type: 'Point', coordinates: [-117.6, 34.05] },
      properties: { sidc: '10031000001211000000', label: 'A/1-5', higherFormation: '1-5 INF', direction: 90 } },
    { type: 'Feature', id: 'sym-2', geometry: { type: 'Point', coordinates: [179.5, -10] },
      properties: { sidc: 'SHGPUCAA--*****', label: '' } },
  ],
};

const clone = (x) => JSON.parse(JSON.stringify(x));
const problemsOf = (doc) => {
  const r = geoJsonToCoa(doc);
  assert.equal(r.ok, false, 'expected the document to be rejected');
  assert.equal(r.error.code, 'IMPORT_INVALID', JSON.stringify(r.error));
  return r.error.details.problems.map((p) => p.field);
};

describe('coaToGeoJson', () => {
  it('writes a GeoJSON FeatureCollection: one Point per symbol, [lng, lat], flat properties, COA metadata in "coa"', () => {
    assert.deepEqual(coaToGeoJson(COA), DOC);
  });

  it('writes the current schema version', () => {
    assert.equal(COA_SCHEMA_VERSION, 3);
    assert.equal(coaToGeoJson(COA).coa.schemaVersion, COA_SCHEMA_VERSION);
  });

  it('writes an empty COA as an empty FeatureCollection', () => {
    assert.deepEqual(coaToGeoJson({ ...COA, symbols: [] }).features, []);
  });
});

describe('geoJsonToCoa', () => {
  it('reads the document back into the same COA, frozen', () => {
    const r = geoJsonToCoa(DOC);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.value, COA);
    assert.ok(Object.isFrozen(r.value) && Object.isFrozen(r.value.symbols[0].position));
  });

  it('round-trips losslessly through JSON text (as on disk)', () => {
    assert.deepEqual(geoJsonToCoa(JSON.parse(JSON.stringify(coaToGeoJson(COA)))).value, COA);
  });

  it('tolerates a missing label (e.g. a feature added in a GIS tool) and normalises like the app', () => {
    const doc = clone(DOC);
    delete doc.features[1].properties.label;
    doc.features[1].geometry.coordinates = [190, 0];
    doc.features[1].properties.sidc = ' shgpucaa--***** ';
    const { symbols } = geoJsonToCoa(doc).value;
    assert.deepEqual(symbols[1], { id: 'sym-2', sidc: 'SHGPUCAA--*****', position: { lat: 0, lng: -170 }, label: '', modifiers: {} });
  });

  it('carries a COA\'s own export frame in the "coa" member, losslessly', () => {
    const framed = { ...COA, frame: { aspect: '5:4', center: { lat: 34, lng: -117 }, width: 0.4 } };
    const doc = coaToGeoJson(framed);
    assert.deepEqual(doc.coa.frame, framed.frame);
    assert.deepEqual(geoJsonToCoa(JSON.parse(JSON.stringify(doc))).value, framed);
    assert.equal('frame' in coaToGeoJson(COA).coa, false, 'no frame member when the COA has none');
  });

  it('rejects an invalid frame', () => {
    const doc = clone(DOC);
    doc.coa.frame = { aspect: '2:1', center: { lat: 0, lng: 0 }, width: 1 };
    assert.deepEqual(problemsOf(doc), ['coa.frame.aspect']);
  });

  it('keeps where a placed COA came from (its threat model, play, anchor, bearing and positions)', () => {
    const source = { threatModelId: 'tm-1', play: 'tc-1', anchor: { lat: 34.05, lng: -118.25 }, bearing: 45, positions: 'endWithMoves' };
    const doc = coaToGeoJson({ ...COA, source });
    assert.deepEqual(doc.coa.source, source);
    assert.deepEqual(geoJsonToCoa(JSON.parse(JSON.stringify(doc))).value.source, source);
    const bad = clone(doc);
    bad.coa.source.bearing = 'north';
    assert.deepEqual(problemsOf(bad), ['coa.source']);
  });

  it('refuses a newer schema version with UNSUPPORTED_VERSION', () => {
    const doc = clone(DOC);
    doc.coa.schemaVersion = 4;
    const r = geoJsonToCoa(doc);
    assert.equal(r.error.code, 'UNSUPPORTED_VERSION');
    assert.deepEqual(r.error.details, { found: 4, supported: [1, 2, 3] });
  });

  it('reads a version 1 file (units only, from before lines and areas) by migrating it to the current version', () => {
    const v1 = clone(DOC);
    v1.coa.schemaVersion = 1;
    const r = geoJsonToCoa(v1);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.value, COA);
    assert.equal(coaToGeoJson(r.value).coa.schemaVersion, 3, 'written back as version 3');
  });

  it('refuses schema version 0 or below', () => {
    const doc = clone(DOC);
    doc.coa.schemaVersion = 0;
    assert.deepEqual(problemsOf(doc), ['coa.schemaVersion']);
  });

  const invalid = [
    ['null', () => null, ['(root)']],
    ['an array', () => [], ['(root)']],
    ['the wrong type', (d) => { d.type = 'Feature'; }, ['type']],
    ['no coa member', (d) => { delete d.coa; }, ['coa']],
    ['a missing schemaVersion', (d) => { delete d.coa.schemaVersion; }, ['coa.schemaVersion']],
    ['a string schemaVersion', (d) => { d.coa.schemaVersion = '1'; }, ['coa.schemaVersion']],
    ['a blank COA id', (d) => { d.coa.id = ' '; }, ['coa.id']],
    ['a blank name', (d) => { d.coa.name = ''; }, ['coa.name']],
    ['a name over 120 characters', (d) => { d.coa.name = 'x'.repeat(121); }, ['coa.name']],
    ['a non-string description', (d) => { d.coa.description = 3; }, ['coa.description']],
    ['revision 0', (d) => { d.coa.revision = 0; }, ['coa.revision']],
    ['a bad createdAt', (d) => { d.coa.createdAt = 'yesterday'; }, ['coa.createdAt']],
    ['a bad updatedAt', (d) => { d.coa.updatedAt = '2026-11-22'; }, ['coa.updatedAt']],
    ['an unknown coa key', (d) => { d.coa.colour = 'red'; }, ['coa.colour']],
    ['features not an array', (d) => { d.features = {}; }, ['features']],
    ['a feature of the wrong type', (d) => { d.features[0].type = 'Point'; }, ['features[0].type']],
    ['a missing feature id', (d) => { delete d.features[0].id; }, ['features[0].id']],
    ['duplicate feature ids', (d) => { d.features[1].id = 'sym-1'; }, ['features[1].id']],
    ['a LineString geometry', (d) => { d.features[0].geometry = { type: 'LineString', coordinates: [[0, 0], [1, 1]] }; }, ['features[0].geometry']],
    ['a null geometry', (d) => { d.features[0].geometry = null; }, ['features[0].geometry']],
    ['three coordinates', (d) => { d.features[0].geometry.coordinates = [1, 2, 3]; }, ['features[0].geometry.coordinates']],
    ['string coordinates', (d) => { d.features[0].geometry.coordinates = ['1', '2']; }, ['features[0].geometry.coordinates']],
    ['a latitude out of range', (d) => { d.features[0].geometry.coordinates = [0, 95]; }, ['features[0].geometry.coordinates[1]']],
    ['missing properties', (d) => { delete d.features[0].properties; }, ['features[0].properties']],
    ['a missing SIDC', (d) => { delete d.features[0].properties.sidc; }, ['features[0].properties.sidc']],
    ['a malformed SIDC', (d) => { d.features[0].properties.sidc = '123'; }, ['features[0].properties.sidc']],
    ['a label over 30 characters', (d) => { d.features[0].properties.label = 'x'.repeat(31); }, ['features[0].properties.label']],
    ['an unknown property', (d) => { d.features[1].properties.colour = 'red'; }, ['features[1].properties.colour']],
    ['a bad modifier value', (d) => { d.features[0].properties.direction = 400; }, ['features[0].properties.direction']],
    ['several problems at once', (d) => { d.coa.name = ''; d.features[1].properties.sidc = ''; }, ['coa.name', 'features[1].properties.sidc']],
  ];
  for (const [name, mutate, fields] of invalid) {
    it(`rejects ${name} with IMPORT_INVALID`, () => {
      const doc = clone(DOC);
      const result = mutate(doc);
      assert.deepEqual(problemsOf(result === undefined ? doc : result), fields);
    });
  }
});

describe('graphics (lines, areas, range rings) in the storage format', () => {
  const LINE = { id: 'gfx-1', kind: 'axisOfAdvance', side: 'friendly', label: 'AXIS LION', color: '#112233', points: [{ lat: 34, lng: -118 }, { lat: 34.2, lng: -117.8 }] };
  const AREA = { id: 'gfx-2', kind: 'objective', side: 'hostile', label: 'OBJ IRON', points: [{ lat: 34, lng: -118 }, { lat: 34.1, lng: -118 }, { lat: 34.1, lng: -117.9 }] };
  const RING = { id: 'gfx-3', kind: 'rangeRing', side: 'neutral', label: '', center: { lat: 34, lng: -118 }, radius: 15000 };
  const WITH = { ...COA, graphics: [LINE, AREA, RING] };
  const features = () => coaToGeoJson(WITH).features.slice(2);

  it('writes a line as a LineString, an area as a closed Polygon, a ring as a Point with a radius, after the units', () => {
    assert.deepEqual(features(), [
      { type: 'Feature', id: 'gfx-1', geometry: { type: 'LineString', coordinates: [[-118, 34], [-117.8, 34.2]] },
        properties: { kind: 'axisOfAdvance', side: 'friendly', label: 'AXIS LION', color: '#112233' } },
      { type: 'Feature', id: 'gfx-2', geometry: { type: 'Polygon', coordinates: [[[-118, 34], [-118, 34.1], [-117.9, 34.1], [-118, 34]]] },
        properties: { kind: 'objective', side: 'hostile', label: 'OBJ IRON' } },
      { type: 'Feature', id: 'gfx-3', geometry: { type: 'Point', coordinates: [-118, 34] },
        properties: { kind: 'rangeRing', side: 'neutral', label: '', radius: 15000 } },
    ]);
  });

  it('reads them back exactly, through JSON text', () => {
    const r = geoJsonToCoa(JSON.parse(JSON.stringify(coaToGeoJson(WITH))));
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.value, WITH);
  });

  it('stores a sector of fire as a Point at its centre with radius, minimum range, bearing and arc, and reads it back', () => {
    const SECTOR = { id: 'gfx-9', kind: 'sector', side: 'hostile', label: 'Gun', center: { lat: 34, lng: -118 }, radius: 2500, minRadius: 100, bearing: 45, arc: 60 };
    const doc = coaToGeoJson({ ...COA, graphics: [SECTOR] });
    assert.deepEqual(doc.features.at(-1), { type: 'Feature', id: 'gfx-9', geometry: { type: 'Point', coordinates: [-118, 34] },
      properties: { kind: 'sector', side: 'hostile', label: 'Gun', radius: 2500, minRadius: 100, bearing: 45, arc: 60 } });
    assert.deepEqual(geoJsonToCoa(JSON.parse(JSON.stringify(doc))).value.graphics, [SECTOR]);
  });

  it('reads a file from before graphics existed as a COA with no graphics', () => {
    assert.deepEqual(geoJsonToCoa(DOC).value.graphics, []);
  });

  it('reports bad graphic features by their place in the file', () => {
    const doc = clone(coaToGeoJson(WITH));
    doc.features[2].properties.kind = 'trench';
    doc.features[3].geometry.coordinates[0][1] = [-118, 95];
    doc.features[4].properties.radius = -1;
    doc.features[4].properties.colour = 'red';
    assert.deepEqual(problemsOf(doc).sort(), [
      'features[2].properties.kind',
      'features[3].geometry.coordinates[0][1][1]',
      'features[4].properties.colour',
      'features[4].properties.radius',
    ]);
  });

  it('refuses a geometry that does not fit the kind, and repeated ids across units and graphics', () => {
    const doc = clone(coaToGeoJson(WITH));
    doc.features[2].geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    doc.features[3].id = 'sym-1';
    assert.deepEqual(problemsOf(doc).sort(), ['features[2].geometry', 'features[3].id']);
  });
});

describe('unit extras in the storage format (v3, D28)', () => {
  const RICH = { ...COA, symbols: [{ ...COA.symbols[0], facing: 45, hvt: true, weapons: [{ name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 }], details: { strength: '10 tanks', equipment: [{ name: 'T-72', count: 10 }] } }] };

  it('keeps facing, hvt, weapons and details as feature properties, and reads them back', () => {
    const doc = coaToGeoJson(RICH);
    const props = doc.features[0].properties;
    assert.deepEqual([props.facing, props.hvt, props.weapons, props.details], [45, true, RICH.symbols[0].weapons, RICH.symbols[0].details]);
    assert.deepEqual(geoJsonToCoa(clone(doc)).value, RICH);
  });

  it('reads a version 2 file (no extras) unchanged', () => {
    const v2 = clone(DOC);
    v2.coa.schemaVersion = 2;
    assert.deepEqual(geoJsonToCoa(v2).value, COA);
  });

  it('reports bad extras by their path in the feature', () => {
    const doc = coaToGeoJson(RICH);
    doc.features[0].properties.weapons[0].maxRange = -1;
    doc.features[0].properties.hvt = 'yes';
    assert.deepEqual(geoJsonToCoa(doc).error.details.problems.map((p) => p.field).sort(), ['features[0].properties.hvt', 'features[0].properties.weapons[0].maxRange']);
  });
});
