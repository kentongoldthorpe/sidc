// coa.restore: puts back a COA's content (undo/redo, undo of delete). Tested through envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields, UNKNOWN_SIDC } from '../support/app-harness.js';

const INF = '10031000001211000000';
const PL = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }];

async function setup() {
  const h = createHarness();
  const coa = okValue(await h.dispatch('coa.create', { name: 'Alpha', description: 'first' }));
  const { symbol } = okValue(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INF, position: { lat: 1, lng: 1 }, label: 'A' }));
  const { graphic } = okValue(await h.dispatch('graphic.add', { coaId: coa.id, expectedRevision: 2, kind: 'phaseLine', points: PL, label: 'PL' }));
  const before = okValue(await h.query('coa.get', { coaId: coa.id })); // revision 3
  h.takeEvents();
  return { h, coaId: coa.id, symbol, graphic, before };
}
const contentOf = ({ name, description, frame, symbols, graphics }) => ({ name, description, ...(frame ? { frame } : {}), symbols, graphics });

describe('coa.restore', () => {
  it('puts back earlier content as a new revision, keeping ids, and publishes coa.restored', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('coa.update', { coaId: s.coaId, expectedRevision: 3, name: 'Renamed' }));
    okValue(await s.h.dispatch('symbol.remove', { coaId: s.coaId, expectedRevision: 4, symbolId: s.symbol.id }));
    s.h.takeEvents();
    s.h.clock.advance(60_000);
    const coa = okValue(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 5, content: contentOf(s.before) }));
    assert.equal(coa.revision, 6);
    assert.notEqual(coa.updatedAt, s.before.updatedAt, 'a restore is a new change');
    assert.deepEqual(contentOf(coa), contentOf(s.before));
    assert.equal(coa.createdAt, s.before.createdAt);
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.payload.coa.revision]), [['coa.restored', 6]]);
  });

  it('can add or remove a frame', async () => {
    const s = await setup();
    const frame = { aspect: '4:3', center: { lat: 1, lng: 1 }, width: 2 };
    const withFrame = okValue(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 3, content: { ...contentOf(s.before), frame } }));
    assert.deepEqual(withFrame.frame, frame);
    const without = okValue(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 4, content: contentOf(s.before) }));
    assert.equal('frame' in without, false);
  });

  it('is a no-op (no save, no event) when the content is already the same', async () => {
    const s = await setup();
    const coa = okValue(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 3, content: contentOf(s.before) }));
    assert.equal(coa.revision, 3);
    assert.deepEqual(s.h.takeEvents(), []);
  });

  it('brings a deleted COA back under the same id with expectedRevision 0', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('coa.delete', { coaId: s.coaId, expectedRevision: 3 }));
    s.h.takeEvents();
    const coa = okValue(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 0, content: contentOf(s.before) }));
    assert.equal(coa.id, s.coaId);
    assert.equal(coa.revision, 1);
    assert.deepEqual(contentOf(coa), contentOf(s.before));
    assert.deepEqual(s.h.takeEvents().map((e) => e.type), ['coa.restored']);
    assert.deepEqual(okValue(await s.h.query('coa.list')).map((c) => c.id), [s.coaId]);
  });

  it('never overwrites: CONFLICT when the COA changed since, or when recreating one that exists', async () => {
    const s = await setup();
    errorOf(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 2, content: contentOf(s.before) }), 'CONFLICT');
    errorOf(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 0, content: contentOf(s.before) }), 'CONFLICT');
    errorOf(await s.h.dispatch('coa.restore', { coaId: 'coa-404', expectedRevision: 1, content: contentOf(s.before) }), 'NOT_FOUND');
  });

  it('checks the content like any other change, reporting every problem by path', async () => {
    const s = await setup();
    const bad = {
      ...contentOf(s.before),
      name: ' ',
      symbols: [{ ...s.symbol, sidc: 'x' }, { ...s.symbol, id: s.symbol.id }],
      graphics: [{ ...s.graphic, points: PL.slice(1) }, { ...s.graphic, id: '' }],
      colour: 'red',
    };
    const error = errorOf(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 3, content: bad }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(error).sort(), [
      'content.colour', 'content.graphics[0].points', 'content.graphics[1].id', 'content.name', 'content.symbols[0].sidc', 'content.symbols[1].id',
    ]);
  });

  it('restores sectors of fire (every graphic field round-trips)', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('graphic.add', { coaId: s.coaId, expectedRevision: 3, kind: 'sector', center: { lat: 1, lng: 1 }, radius: 2500, minRadius: 100, bearing: 45, arc: 60 }));
    const withSector = okValue(await s.h.query('coa.get', { coaId: s.coaId }));
    okValue(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 4, content: contentOf(s.before) }));
    const back = okValue(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 5, content: contentOf(withSector) }));
    assert.deepEqual(back.graphics, withSector.graphics);
  });

  it('refuses SIDCs the renderer does not know', async () => {
    const s = await setup();
    const content = { ...contentOf(s.before), symbols: [{ ...s.symbol, sidc: UNKNOWN_SIDC }] };
    assert.deepEqual(problemFields(errorOf(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: 3, content }), 'VALIDATION_FAILED')), ['content.symbols[0].sidc']);
  });
});
