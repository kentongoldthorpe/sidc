// coa.import: the documented import format (docs/IMPORT-FORMAT.md), tested through envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHarness, okValue, errorOf, problemFields, T0, UNKNOWN_SIDC } from '../support/app-harness.js';
import { MODIFIER_NAMES } from '../../src/domain/map-symbol.js';

const INFANTRY = '10031000001211000000';
const docs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'import');

const doc = (coas) => ({ format: 'coa-builder/import', version: 1, coas });
const coaIn = (overrides = {}) => ({ name: 'COA 1', units: [{ sidc: INFANTRY, lat: 34.05, lng: -117.6, label: 'A/1-5' }], ...overrides });

describe('coa.import', () => {
  it('creates new COAs with fresh ids, publishing coa.imported for each, and replies with them', async () => {
    const h = createHarness();
    const { coas } = okValue(await h.dispatch('coa.import', { document: doc([
      coaIn({ name: 'COA 1 – Envelopment', description: 'Main effort north' }),
      coaIn({ name: 'COA 2', units: [] }),
    ]) }));
    assert.deepEqual(coas.map((c) => [c.name, c.revision, c.createdAt, c.symbols.length]), [['COA 1 – Envelopment', 1, T0, 1], ['COA 2', 1, T0, 0]]);
    assert.equal(coas[0].description, 'Main effort north');
    assert.deepEqual(coas[0].symbols[0], { id: coas[0].symbols[0].id, sidc: INFANTRY, position: { lat: 34.05, lng: -117.6 }, label: 'A/1-5', modifiers: {} });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload.coa.name]), [['coa.imported', 'COA 1 – Envelopment'], ['coa.imported', 'COA 2']]);
    assert.deepEqual(okValue(await h.query('coa.list')).map((s) => s.name).sort(), ['COA 1 – Envelopment', 'COA 2']);
  });

  it('reads flat modifier fields, an optional frame, and normalises like the app', async () => {
    const h = createHarness();
    const { coas: [coa] } = okValue(await h.dispatch('coa.import', { document: doc([coaIn({
      name: '  Spaced  ',
      frame: { aspect: '4:3', center: { lat: 34, lng: -117 }, width: 0.5 },
      units: [{ sidc: ' shgpucaa--***** ', lat: 1, lng: 190, higherFormation: '1-5 INF', direction: 90, staffComments: '' }],
    })]) }));
    assert.equal(coa.name, 'Spaced');
    assert.deepEqual(coa.frame, { aspect: '4:3', center: { lat: 34, lng: -117 }, width: 0.5 });
    assert.deepEqual(coa.symbols[0], { id: coa.symbols[0].id, sidc: 'SHGPUCAA--*****', position: { lat: 1, lng: -170 }, label: '', modifiers: { higherFormation: '1-5 INF', direction: 90 } });
  });

  it('never overwrites: importing the same document twice gives two copies', async () => {
    const h = createHarness();
    okValue(await h.dispatch('coa.import', { document: doc([coaIn()]) }));
    okValue(await h.dispatch('coa.import', { document: doc([coaIn()]) }));
    assert.equal(okValue(await h.query('coa.list')).length, 2);
  });

  it('refuses a newer format version with UNSUPPORTED_VERSION', async () => {
    const error = errorOf(await createHarness().dispatch('coa.import', { document: { ...doc([coaIn()]), version: 2 } }), 'UNSUPPORTED_VERSION');
    assert.deepEqual(error.details, { found: 2, supported: [1] });
  });

  const invalid = [
    ['a document that is not an object', [], ['document']],
    ['the wrong format', { ...doc([coaIn()]), format: 'something-else' }, ['format']],
    ['a missing version', { format: 'coa-builder/import', coas: [coaIn()] }, ['version']],
    ['no coas', doc([]), ['coas']],
    ['coas that is not a list', { ...doc([]), coas: {} }, ['coas']],
    ['an unknown top-level field', { ...doc([coaIn()]), author: 'x' }, ['author']],
    ['a blank COA name', doc([coaIn({ name: ' ' })]), ['coas[0].name']],
    ['a COA name over 120 characters', doc([coaIn({ name: 'x'.repeat(121) })]), ['coas[0].name']],
    ['an invalid frame', doc([coaIn({ frame: { aspect: '1:1', center: { lat: 0, lng: 0 }, width: 1 } })]), ['coas[0].frame.aspect']],
    ['an unknown COA field', doc([coaIn({ colour: 'red' })]), ['coas[0].colour']],
    ['units that is not a list', doc([coaIn({ units: {} })]), ['coas[0].units']],
    ['a missing SIDC', doc([coaIn({ units: [{ lat: 0, lng: 0 }] })]), ['coas[0].units[0].sidc']],
    ['a malformed SIDC', doc([coaIn({ units: [{ sidc: '123', lat: 0, lng: 0 }] })]), ['coas[0].units[0].sidc']],
    ['an unrecognised SIDC', doc([coaIn({ units: [{ sidc: UNKNOWN_SIDC, lat: 0, lng: 0 }] })]), ['coas[0].units[0].sidc']],
    ['a missing latitude', doc([coaIn({ units: [{ sidc: INFANTRY, lng: 0 }] })]), ['coas[0].units[0].lat']],
    ['a latitude out of range', doc([coaIn({ units: [{ sidc: INFANTRY, lat: 91, lng: 0 }] })]), ['coas[0].units[0].lat']],
    ['a string longitude', doc([coaIn({ units: [{ sidc: INFANTRY, lat: 0, lng: '1' }] })]), ['coas[0].units[0].lng']],
    ['a label over 30 characters', doc([coaIn({ units: [{ sidc: INFANTRY, lat: 0, lng: 0, label: 'x'.repeat(31) }] })]), ['coas[0].units[0].label']],
    ['a bad modifier', doc([coaIn({ units: [{ sidc: INFANTRY, lat: 0, lng: 0, direction: 400 }] })]), ['coas[0].units[0].direction']],
    ['an unknown unit field', doc([coaIn({ units: [{ sidc: INFANTRY, lat: 0, lng: 0, position: {} }] })]), ['coas[0].units[0].position']],
    ['problems in several places at once', doc([coaIn({ name: '' }), coaIn({ units: [{ sidc: INFANTRY, lat: 0, lng: 0 }, { sidc: 'x', lat: 0, lng: 0 }] })]), ['coas[0].name', 'coas[1].units[1].sidc']],
  ];
  for (const [name, document, fields] of invalid) {
    it(`refuses ${name} with IMPORT_INVALID, importing nothing`, async () => {
      const h = createHarness();
      const error = errorOf(await h.dispatch('coa.import', { document }), 'IMPORT_INVALID');
      assert.deepEqual(problemFields(error), fields);
      assert.deepEqual(okValue(await h.query('coa.list')), []);
      assert.deepEqual(h.takeEvents(), []);
    });
  }

  it('enforces the documented limits (100 COAs, 1000 units per COA)', async () => {
    const h = createHarness();
    const tooManyCoas = doc(Array.from({ length: 101 }, (_, i) => coaIn({ name: `C${i}`, units: [] })));
    assert.deepEqual(problemFields(errorOf(await h.dispatch('coa.import', { document: tooManyCoas }), 'IMPORT_INVALID')), ['coas']);
    const tooManyUnits = doc([coaIn({ units: Array.from({ length: 1001 }, () => ({ sidc: INFANTRY, lat: 0, lng: 0 })) })]);
    assert.deepEqual(problemFields(errorOf(await h.dispatch('coa.import', { document: tooManyUnits }), 'IMPORT_INVALID')), ['coas[0].units']);
  });
});

describe('docs/import: the published examples and schema match what the app accepts', () => {
  const examples = readdirSync(join(docs, 'examples')).filter((f) => f.endsWith('.json'));

  it('has examples', () => assert.ok(examples.length >= 2, examples.join()));

  for (const file of examples) {
    it(`imports ${file}`, async () => {
      const document = JSON.parse(readFileSync(join(docs, 'examples', file), 'utf8'));
      const { coas } = okValue(await createHarness().dispatch('coa.import', { document }));
      assert.equal(coas.length, document.coas.length);
    });
  }

  it('the schema lists exactly the fields the app accepts', () => {
    const schema = JSON.parse(readFileSync(join(docs, 'coa-import.schema.json'), 'utf8'));
    const coa = schema.$defs.coa;
    const unit = schema.$defs.unit;
    assert.deepEqual(Object.keys(schema.properties).sort(), ['coas', 'format', 'source', 'version']);
    assert.deepEqual(Object.keys(coa.properties).sort(), ['description', 'frame', 'name', 'units']);
    assert.deepEqual(Object.keys(unit.properties).sort(), ['label', 'lat', 'lng', 'sidc', ...MODIFIER_NAMES].sort());
    assert.equal(schema.additionalProperties, false);
    assert.equal(coa.additionalProperties, false);
    assert.equal(unit.additionalProperties, false);
    assert.deepEqual(schema.properties.coas.maxItems, 100);
    assert.deepEqual(coa.properties.units.maxItems, 1000);
  });
});
