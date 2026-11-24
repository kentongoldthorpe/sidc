// T-5 threat-coa.place: a threat COA's play (or the formation) placed on the map as a new SITTEMP COA,
// distances preserved (D24). Tested through envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { distance } from '../../src/domain/geodesy.js';

const INF = '10061000151211000000';
const ANCHOR = { lat: 34.05, lng: -118.25 };

async function withPlay() {
  const h = createHarness();
  const gun = okValue(await h.dispatch('system.create', { name: 'T-72 gun', role: 'direct', maxRange: 2500, arc: 60 }));
  let m = okValue(await h.dispatch('threat-model.create', { name: 'MRB attack' }));
  m = okValue(await h.dispatch('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: {
    units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0, systems: [gun.id] }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }], graphics: [],
  } }));
  m = okValue(await h.dispatch('threat-coa.add', { modelId: m.id, expectedRevision: m.revision, name: 'COA 1', rank: 'mostDangerous' }));
  const coaId = m.coas[0].id;
  m = okValue(await h.dispatch('threat-coa.update', { modelId: m.id, expectedRevision: m.revision, coaId, statement: { who: 'MRB(-)', why: 'to seize the crossings' } }));
  const play = JSON.parse(JSON.stringify(m.coas[0].template));
  play.units[0].end = { x: -900, y: 4000 };
  m = okValue(await h.dispatch('threat-model.set-template', { modelId: m.id, expectedRevision: m.revision, target: coaId, template: play }));
  h.takeEvents();
  return { h, model: m, coaId };
}
const place = (s, fields) => s.h.dispatch('threat-coa.place', { modelId: s.model.id, play: s.coaId, anchor: ANCHOR, bearing: 0, positions: 'end', ...fields });

describe('threat-coa.place', () => {
  it('creates a new COA with the units (carrying their weapons, D28), the statement as description, and a link back', async () => {
    const s = await withPlay();
    const coa = okValue(await place(s, {}));
    assert.equal(coa.name, 'COA 1 (SITTEMP)');
    assert.equal(coa.revision, 1);
    assert.deepEqual(coa.symbols.map((x) => x.label), ['1 MRC', '2 MRC']);
    assert.ok(coa.description.includes('WHO: MRB(-)') && coa.description.includes('Most dangerous'));
    assert.deepEqual(coa.graphics, [], 'ranges travel with the units, not as separate rings');
    assert.deepEqual(coa.symbols[0].weapons, [{ name: 'T-72 gun', role: 'direct', maxRange: 2500, arc: 60 }]);
    assert.equal(coa.symbols[0].facing, 0, 'facing the direction of attack (bearing 0)');
    assert.equal('weapons' in coa.symbols[1], false);
    assert.deepEqual(coa.source, { threatModelId: s.model.id, play: s.coaId, anchor: ANCHOR, bearing: 0, positions: 'end' });
    assert.ok(Math.abs(distance(coa.symbols[0].position, coa.symbols[1].position) - Math.hypot(1800, 4000)) < 1, 'distances kept (at the end positions)');
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.payload.coa.id]), [['coa.placed', coa.id]]);
    assert.deepEqual(okValue(await s.h.query('coa.get', { coaId: coa.id })), coa);
  });

  it('takes a name, and places the formation too', async () => {
    const s = await withPlay();
    const coa = okValue(await place(s, { play: 'formation', name: 'SITTEMP north', positions: 'start' }));
    assert.equal(coa.name, 'SITTEMP north');
    assert.equal(coa.source.play, 'formation');
  });

  it('refuses a bad anchor, bearing or positions option, and an unknown play', async () => {
    const s = await withPlay();
    assert.deepEqual(problemFields(errorOf(await place(s, { anchor: { lat: 95, lng: 0 }, bearing: 360, positions: 'middle' }), 'VALIDATION_FAILED')).sort(), ['anchor.lat', 'bearing', 'positions']);
    assert.deepEqual(errorOf(await place(s, { play: 'tc-404' }), 'NOT_FOUND').details, { modelId: s.model.id, coaId: 'tc-404' });
  });

  it('a placed COA keeps its link when changed, undone or redone; a duplicate does not', async () => {
    const s = await withPlay();
    const coa = okValue(await place(s, {}));
    const renamed = okValue(await s.h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'Renamed' }));
    assert.deepEqual(renamed.source, coa.source);
    const { name, description, symbols, graphics } = coa;
    const restored = okValue(await s.h.dispatch('coa.restore', { coaId: coa.id, expectedRevision: 2, content: { name, description, symbols, graphics } }));
    assert.deepEqual(restored.source, coa.source);
    const copy = okValue(await s.h.dispatch('coa.duplicate', { coaId: coa.id }));
    assert.equal('source' in copy, false);
  });
});

describe('threat-coa.place: unit extras', () => {
  it('keeps the HVT tag and details, and turns the facing into a true bearing', async () => {
    const h = createHarness();
    let m = okValue(await h.dispatch('threat-model.create', { name: 'AD' }));
    m = okValue(await h.dispatch('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: {
      units: [{ id: 'u1', sidc: INF, label: 'AD', x: 0, y: 0, facing: 30, hvt: true, details: { strength: '4 TELAR' }, weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 12000 }] }], graphics: [] } }));
    const coa = okValue(await h.dispatch('threat-coa.place', { modelId: m.id, play: 'formation', anchor: ANCHOR, bearing: 350, positions: 'start' }));
    const [u] = coa.symbols;
    assert.deepEqual([u.hvt, u.facing, u.details, u.weapons[0].maxRange], [true, 20, { strength: '4 TELAR' }, 12000]);
  });
});
