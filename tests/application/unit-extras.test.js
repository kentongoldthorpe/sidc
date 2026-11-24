// M10-3a Rich units (D28): a unit carries its own weapons (ranges and arcs), an HVT tag, a facing and
// reference details. Values, not references, so they go wherever the COA goes. Tested at the boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';

const INF = '10061000001211000000';
const GUN = { name: '125 mm gun', role: 'direct', maxRange: 2500, arc: 60 };
const SAM = { name: 'SA-15', role: 'airDefence', maxRange: 12000, minRange: 1500 };
const DETAILS = { strength: '10 T-72B3', equipment: [{ name: 'T-72B3', count: 10 }, { name: 'BMP-2', count: 1 }], reference: 'Unit guide, 2025', notes: 'Coy of the 1st MRB' };

async function withCoa() {
  const h = createHarness();
  const coa = okValue(await h.dispatch('coa.create', { name: 'SITTEMP' }));
  h.takeEvents();
  return { h, coa };
}
const add = (h, coaId, revision, extra) => h.dispatch('symbol.add', { coaId, expectedRevision: revision, sidc: INF, position: { lat: 1, lng: 2 }, label: 'A', ...extra });

describe('symbol.add with unit extras', () => {
  it('keeps weapons (arc defaults to all round), HVT, facing and details', async () => {
    const { h, coa } = await withCoa();
    const { symbol } = okValue(await add(h, coa.id, 1, { weapons: [GUN, SAM], hvt: true, facing: 45, details: DETAILS }));
    assert.deepEqual(symbol.weapons, [GUN, { ...SAM, arc: 360 }]);
    assert.equal(symbol.hvt, true);
    assert.equal(symbol.facing, 45);
    assert.deepEqual(symbol.details, DETAILS);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })).symbols[0], symbol);
  });

  it('leaves empty extras out (no hvt: false, weapons: [] or details: {})', async () => {
    const { h, coa } = await withCoa();
    const { symbol } = okValue(await add(h, coa.id, 1, { weapons: [], hvt: false, details: { notes: '  ' }, facing: null }));
    assert.deepEqual(Object.keys(symbol).sort(), ['id', 'label', 'modifiers', 'position', 'sidc']);
  });

  it('names every problem in the extras', async () => {
    const { h, coa } = await withCoa();
    const error = errorOf(await add(h, coa.id, 1, {
      hvt: 'yes', facing: 360,
      weapons: [{ name: '', role: 'laser', maxRange: 0 }, { ...SAM, minRange: 20000 }, { ...GUN, colour: 'red' }],
      details: { strength: 'x'.repeat(51), equipment: [{ name: 'T-72', count: -1 }], rank: 'major' },
    }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(error).sort(), [
      'details.equipment[0].count', 'details.rank', 'details.strength', 'facing', 'hvt',
      'weapons[0].maxRange', 'weapons[0].name', 'weapons[0].role', 'weapons[1].minRange', 'weapons[2].colour',
    ]);
  });

  it('refuses more than 20 weapons', async () => {
    const { h, coa } = await withCoa();
    assert.deepEqual(problemFields(errorOf(await add(h, coa.id, 1, { weapons: Array(21).fill(GUN) }), 'VALIDATION_FAILED')), ['weapons']);
  });
});

describe('symbol.update with unit extras', () => {
  it('sets, changes and removes extras, reporting what changed', async () => {
    const { h, coa } = await withCoa();
    const { symbol } = okValue(await add(h, coa.id, 1, {}));
    h.takeEvents();
    let r = okValue(await h.dispatch('symbol.update', { coaId: coa.id, expectedRevision: 2, symbolId: symbol.id, hvt: true, weapons: [GUN] }));
    assert.deepEqual([r.symbol.hvt, r.symbol.weapons], [true, [GUN]]);
    assert.deepEqual(h.takeEvents()[0].payload.changed, ['hvt', 'weapons']);
    r = okValue(await h.dispatch('symbol.update', { coaId: coa.id, expectedRevision: 3, symbolId: symbol.id, hvt: false, weapons: [] }));
    assert.equal('hvt' in r.symbol || 'weapons' in r.symbol, false);
    assert.deepEqual(h.takeEvents()[0].payload.changed, ['hvt', 'weapons']);
  });

  it('is a no-op (no write, no event) when the extras are the same', async () => {
    const { h, coa } = await withCoa();
    const { symbol } = okValue(await add(h, coa.id, 1, { hvt: true, weapons: [GUN] }));
    h.takeEvents();
    const r = okValue(await h.dispatch('symbol.update', { coaId: coa.id, expectedRevision: 2, symbolId: symbol.id, hvt: true, weapons: [{ ...GUN }], details: {} }));
    assert.equal(r.revision, 2);
    assert.deepEqual(h.takeEvents(), []);
  });
});

describe('extras survive undo (coa.restore), duplicate and copy', () => {
  it('restores and duplicates units with their extras', async () => {
    const { h, coa } = await withCoa();
    const { symbol } = okValue(await add(h, coa.id, 1, { hvt: true, weapons: [GUN], facing: 90, details: DETAILS }));
    const current = okValue(await h.query('coa.get', { coaId: coa.id }));
    const { name, description, symbols, graphics } = current;
    okValue(await h.dispatch('symbol.update', { coaId: coa.id, expectedRevision: 2, symbolId: symbol.id, hvt: false }));
    const restored = okValue(await h.dispatch('coa.restore', { coaId: coa.id, expectedRevision: 3, content: { name, description, symbols, graphics } }));
    assert.deepEqual(restored.symbols[0], symbol);
    const copy = okValue(await h.dispatch('coa.duplicate', { coaId: coa.id }));
    assert.deepEqual({ ...copy.symbols[0], id: symbol.id }, symbol);
  });
});
