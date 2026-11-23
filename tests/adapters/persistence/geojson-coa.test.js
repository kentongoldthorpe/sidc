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
};

const DOC = {
  type: 'FeatureCollection',
  coa: {
    schemaVersion: 1, id: 'coa-1', name: 'Envelopment', description: 'Main effort north', revision: 4,
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
    assert.equal(COA_SCHEMA_VERSION, 1);
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

  it('refuses a newer schema version with UNSUPPORTED_VERSION', () => {
    const doc = clone(DOC);
    doc.coa.schemaVersion = 2;
    const r = geoJsonToCoa(doc);
    assert.equal(r.error.code, 'UNSUPPORTED_VERSION');
    assert.deepEqual(r.error.details, { found: 2, supported: [1] });
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
