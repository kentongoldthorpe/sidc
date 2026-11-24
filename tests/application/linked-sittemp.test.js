// M10-4a Linked SITTEMPs (D30): a COA placed from a threat play stays linked to it. It can be brought
// up to date with the play, moved or turned as one piece, and a unit fitted to the ground keeps its
// place and can snap back. Tested at the boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { distance, initialBearing } from '../../src/domain/geodesy.js';

const INF = '10061000001211000000';
const TANK = '10061000001205000000';
const ANCHOR = { lat: 34.05, lng: -118.25 };

async function placed() {
  const h = createHarness();
  let m = okValue(await h.dispatch('threat-model.create', { name: 'MRB attack' }));
  m = okValue(await h.dispatch('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: {
    units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0 }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }],
    graphics: [{ id: 'g1', kind: 'objective', label: 'OBJ', points: [{ x: -500, y: 5000 }, { x: 500, y: 5000 }, { x: 0, y: 6000 }] }],
  } }));
  const coa = okValue(await h.dispatch('threat-coa.place', { modelId: m.id, play: 'formation', anchor: ANCHOR, bearing: 0, positions: 'start' }));
  h.takeEvents();
  const setFormation = async (units, graphics = m.formation.graphics) => {
    const latest = okValue(await h.query('threat-model.get', { modelId: m.id }));
    return okValue(await h.dispatch('threat-model.set-template', { modelId: m.id, expectedRevision: latest.revision, target: 'formation', template: { units, graphics } }));
  };
  const get = async () => okValue(await h.query('coa.get', { coaId: coa.id }));
  return { h, model: m, coa, setFormation, get };
}
const byLabel = (coa, label) => coa.symbols.find((s) => s.label === label);

describe('coa.update-from-template', () => {
  it('follows the play: changed units update, new ones appear, removed ones go; ids are kept', async () => {
    const s = await placed();
    const before = byLabel(s.coa, '1 MRC');
    const model = await s.setFormation([
      { id: 'u1', sidc: TANK, label: '1 TK', x: -900, y: 0, hvt: true, weapons: [{ name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 }] },
      { id: 'u3', sidc: INF, label: '3 MRC', x: 0, y: -2000 },
    ]);
    s.h.takeEvents();
    const coa = okValue(await s.h.dispatch('coa.update-from-template', { coaId: s.coa.id, expectedRevision: 1 }));
    assert.deepEqual(coa.symbols.map((x) => x.label), ['1 TK', '3 MRC']);
    const tk = coa.symbols[0];
    assert.deepEqual([tk.id, tk.sidc, tk.hvt, tk.weapons[0].name], [before.id, TANK, true, 'Gun']);
    assert.equal(coa.source.modelRevision, model.revision);
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.payload.added, e.payload.removed]), [['coa.synced', 1, 1]]);
  });

  it('keeps where a unit was moved on the map (fitted to the ground), and marks it', async () => {
    const s = await placed();
    const u = byLabel(s.coa, '1 MRC');
    const moved = { lat: u.position.lat + 0.01, lng: u.position.lng };
    okValue(await s.h.dispatch('symbol.move', { coaId: s.coa.id, expectedRevision: 1, symbolId: u.id, position: moved }));
    assert.deepEqual(byLabel(await s.get(), '1 MRC').link, { key: 'unit:u1', moved: true });
    await s.setFormation([{ id: 'u1', sidc: INF, label: '1 MRC (fwd)', x: -900, y: 1000 }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }]);
    const coa = okValue(await s.h.dispatch('coa.update-from-template', { coaId: s.coa.id, expectedRevision: 2 }));
    const after = byLabel(coa, '1 MRC (fwd)');
    assert.deepEqual(after.position, moved, 'its position is the analyst\'s, not the template\'s');
  });

  it('leaves the user\'s own units and drawings alone, and does not bring back what the user deleted', async () => {
    const s = await placed();
    okValue(await s.h.dispatch('symbol.add', { coaId: s.coa.id, expectedRevision: 1, sidc: INF, position: { lat: 34.2, lng: -118.2 }, label: 'Mine' }));
    const u2 = byLabel(s.coa, '2 MRC');
    okValue(await s.h.dispatch('symbol.remove', { coaId: s.coa.id, expectedRevision: 2, symbolId: u2.id }));
    const u1 = byLabel(s.coa, '1 MRC');
    okValue(await s.h.dispatch('symbol.update', { coaId: s.coa.id, expectedRevision: 3, symbolId: u1.id, label: 'Renamed' }));
    assert.equal(byLabel(await s.get(), 'Renamed').link, undefined, 'edited: now the user\'s own unit');
    const coa = okValue(await s.h.dispatch('coa.update-from-template', { coaId: s.coa.id, expectedRevision: 4 }));
    assert.deepEqual(coa.symbols.map((x) => x.label).sort(), ['1 MRC', 'Mine', 'Renamed'], 'the edited unit stays; a fresh linked 1 MRC comes back; 2 MRC stays deleted');
    assert.deepEqual(coa.source.excluded, ['unit:u2']);
  });

  it('carries the play\'s drawings, replacing linked ones', async () => {
    const s = await placed();
    assert.deepEqual(s.coa.graphics.map((g) => [g.label, g.link.key]), [['OBJ', 'graphic:g1']]);
    await s.setFormation(s.model.formation.units, [{ id: 'g1', kind: 'objective', label: 'OBJ IRON', points: [{ x: -500, y: 5000 }, { x: 500, y: 5000 }, { x: 0, y: 6000 }] }]);
    const coa = okValue(await s.h.dispatch('coa.update-from-template', { coaId: s.coa.id, expectedRevision: 1 }));
    assert.deepEqual([coa.graphics[0].label, coa.graphics[0].id], ['OBJ IRON', s.coa.graphics[0].id]);
  });

  it('refuses a COA that was not placed, a stale revision, and a play that is gone', async () => {
    const s = await placed();
    const plain = okValue(await s.h.dispatch('coa.create', { name: 'Plain' }));
    assert.deepEqual(problemFields(errorOf(await s.h.dispatch('coa.update-from-template', { coaId: plain.id, expectedRevision: 1 }), 'VALIDATION_FAILED')), ['coaId']);
    errorOf(await s.h.dispatch('coa.update-from-template', { coaId: s.coa.id, expectedRevision: 9 }), 'CONFLICT');
    okValue(await s.h.dispatch('threat-model.delete', { modelId: s.model.id, expectedRevision: s.model.revision }));
    errorOf(await s.h.dispatch('coa.update-from-template', { coaId: s.coa.id, expectedRevision: 1 }), 'NOT_FOUND');
  });

  it('can be undone (coa.restore keeps the links)', async () => {
    const s = await placed();
    const { name, description, symbols, graphics } = s.coa;
    await s.setFormation([{ id: 'u1', sidc: INF, label: 'Changed', x: -900, y: 0 }]);
    okValue(await s.h.dispatch('coa.update-from-template', { coaId: s.coa.id, expectedRevision: 1 }));
    const restored = okValue(await s.h.dispatch('coa.restore', { coaId: s.coa.id, expectedRevision: 2, content: { name, description, symbols, graphics } }));
    assert.deepEqual(restored.symbols, s.coa.symbols);
  });
});

describe('coa.re-place: move or turn the placed COA as one piece', () => {
  it('turns it to a new bearing, keeping distances, and keeps moved units where they were put', async () => {
    const s = await placed();
    const [a, b] = s.coa.symbols;
    const moved = { lat: b.position.lat + 0.02, lng: b.position.lng };
    okValue(await s.h.dispatch('symbol.move', { coaId: s.coa.id, expectedRevision: 1, symbolId: b.id, position: moved }));
    const coa = okValue(await s.h.dispatch('coa.re-place', { coaId: s.coa.id, expectedRevision: 2, bearing: 90 }));
    assert.equal(coa.source.bearing, 90);
    assert.ok(Math.abs(distance(ANCHOR, coa.symbols[0].position) - 900) < 1);
    assert.ok(Math.abs(initialBearing(ANCHOR, coa.symbols[0].position) - 0) < 0.1 || Math.abs(initialBearing(ANCHOR, coa.symbols[0].position) - 360) < 0.1, 'x = -900 is left of an eastward attack: north');
    assert.deepEqual(coa.symbols[1].position, moved);
    assert.equal(coa.symbols[0].id, a.id);
  });

  it('checks the new georeference', async () => {
    const s = await placed();
    assert.deepEqual(problemFields(errorOf(await s.h.dispatch('coa.re-place', { coaId: s.coa.id, expectedRevision: 1, bearing: 400, anchor: { lat: 99, lng: 0 } }), 'VALIDATION_FAILED')).sort(), ['anchor.lat', 'bearing']);
  });
});

describe('symbol.snap-to-template', () => {
  it('puts a moved unit back at its template position and clears the mark', async () => {
    const s = await placed();
    const u = byLabel(s.coa, '1 MRC');
    okValue(await s.h.dispatch('symbol.move', { coaId: s.coa.id, expectedRevision: 1, symbolId: u.id, position: { lat: 34.2, lng: -118.3 } }));
    const r = okValue(await s.h.dispatch('symbol.snap-to-template', { coaId: s.coa.id, expectedRevision: 2, symbolId: u.id }));
    assert.deepEqual(r.to, u.position);
    assert.deepEqual(byLabel(await s.get(), '1 MRC').link, { key: 'unit:u1' });
  });

  it('refuses a unit that is not linked', async () => {
    const s = await placed();
    const mine = okValue(await s.h.dispatch('symbol.add', { coaId: s.coa.id, expectedRevision: 1, sidc: INF, position: { lat: 34.2, lng: -118.2 } })).symbol;
    assert.deepEqual(problemFields(errorOf(await s.h.dispatch('symbol.snap-to-template', { coaId: s.coa.id, expectedRevision: 2, symbolId: mine.id }), 'VALIDATION_FAILED')), ['symbolId']);
  });
});

describe('links are not copied', () => {
  it('a duplicate or copied unit is the user\'s own', async () => {
    const s = await placed();
    const copy = okValue(await s.h.dispatch('coa.duplicate', { coaId: s.coa.id }));
    assert.ok(copy.symbols.every((x) => !x.link) && copy.graphics.every((g) => !g.link));
    const r = okValue(await s.h.dispatch('symbol.copy', { coaId: s.coa.id, expectedRevision: 1, fromCoaId: s.coa.id, symbolIds: [s.coa.symbols[0].id] }));
    assert.equal(r.symbols?.[0]?.link ?? (await s.get()).symbols.at(-1).link, undefined);
  });
});
