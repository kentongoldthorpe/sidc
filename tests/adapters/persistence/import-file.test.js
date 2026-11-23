// The import-file adapter: the text of a file the user chose → the coa.import document.
// Tested at its boundary: text in, then the result sent through the real application.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readImportFile } from '../../../src/adapters/persistence/import-file.js';
import { coaToGeoJson } from '../../../src/adapters/persistence/geojson-coa.js';
import { createHarness, okValue, errorOf, T0 } from '../../support/app-harness.js';

const INFANTRY = '10031000001211000000';
const importDoc = { format: 'coa-builder/import', version: 1, coas: [{ name: 'A', units: [{ sidc: INFANTRY, lat: 1, lng: 2 }] }] };

describe('readImportFile', () => {
  it('passes a coa-builder/import document through unchanged (the app validates it)', () => {
    const read = readImportFile(JSON.stringify(importDoc));
    assert.equal(read.ok, true);
    assert.deepEqual(read.value, importDoc);
  });

  it('passes on a document with the wrong version or fields, so the app reports the problems', () => {
    const doc = { ...importDoc, version: 2 };
    assert.deepEqual(readImportFile(JSON.stringify(doc)).value, doc);
  });

  it('converts a COA Builder GeoJSON file into an import document that recreates the COA as a copy', async () => {
    const original = {
      id: 'coa-old', name: 'Saved COA', description: 'desc', revision: 7, createdAt: T0, updatedAt: T0,
      frame: { aspect: '4:3', center: { lat: 10, lng: 20 }, width: 3 },
      symbols: [{ id: 'sym-old', sidc: INFANTRY, position: { lat: 1.5, lng: -2.5 }, label: '1-22 IN', modifiers: { dtg: '241200ZMAR24', direction: 90 } }],
    };
    const read = readImportFile(JSON.stringify(coaToGeoJson(original)));
    assert.equal(read.ok, true);
    const { coas: [coa] } = okValue(await createHarness().dispatch('coa.import', { document: read.value }));
    assert.notEqual(coa.id, 'coa-old');
    assert.equal(coa.revision, 1);
    assert.deepEqual({ name: coa.name, description: coa.description, frame: coa.frame }, { name: 'Saved COA', description: 'desc', frame: original.frame });
    assert.deepEqual(coa.symbols.map(({ id, ...rest }) => rest), original.symbols.map(({ id, ...rest }) => rest));
  });

  it('reports a GeoJSON file that is not a valid COA document with its problems', () => {
    const read = readImportFile(JSON.stringify({ type: 'FeatureCollection', features: [] }));
    assert.equal(read.ok, false);
    assert.equal(read.error.code, 'IMPORT_INVALID');
    assert.ok(read.error.details.problems.some((p) => p.field === 'coa'));
  });

  it('reports text that is not JSON', () => {
    const read = readImportFile('name,lat,lng\nA,1,2');
    assert.equal(read.ok, false);
    assert.equal(read.error.code, 'IMPORT_INVALID');
    assert.deepEqual(read.error.details.problems.map((p) => p.field), ['(file)']);
  });

  it('passes any other JSON on, so the app explains what the format should be', async () => {
    const read = readImportFile('{"hello":1}');
    assert.equal(read.ok, true);
    const error = errorOf(await createHarness().dispatch('coa.import', { document: read.value }), 'IMPORT_INVALID');
    assert.ok(error.details.problems.some((p) => p.field === 'format'));
  });
});
