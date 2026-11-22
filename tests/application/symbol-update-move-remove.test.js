// Slices: symbol.update, symbol.move, symbol.remove — tested only through envelopes at the boundaries.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { err } from '../../src/shared/result.js';

const T2 = '2026-11-22T20:42:00.000Z';
const INFANTRY = '10031000001211000000';
const ARMOR = '10061000001205000000';
const MISSING = Symbol('missing');

/**
 * A COA (revision 3) holding symbols A and B, with the clock moved on to T2.
 * Also returns a log of repository saves (calls to the driven port).
 */
async function setup() {
  const repo = new InMemoryCoaRepository();
  const saves = [];
  const save = repo.save.bind(repo);
  repo.save = (...args) => { saves.push(args); return save(...args); };

  const h = createHarness({ coaRepository: repo });
  const coa = okValue(await h.dispatch('coa.create', { name: 'Envelopment' }));
  const a = okValue(await h.dispatch('symbol.add', {
    coaId: coa.id, expectedRevision: 1, sidc: INFANTRY, position: { lat: 10, lng: 20 }, label: 'A', modifiers: { higherFormation: '1-5 INF', direction: 90 },
  })).symbol;
  const b = okValue(await h.dispatch('symbol.add', {
    coaId: coa.id, expectedRevision: 2, sidc: ARMOR, position: { lat: 11, lng: 21 }, label: 'B',
  })).symbol;
  h.takeEvents();
  saves.length = 0;
  h.clock.advance(120_000);
  return { h, repo, saves, coaId: coa.id, a, b, revision: 3 };
}

const body = (payload) => {
  const out = { ...payload };
  for (const [key, value] of Object.entries(out)) if (value === MISSING) delete out[key];
  return out;
};

const stored = async (h, coaId) => okValue(await h.query('coa.get', { coaId }));

/** Valid payload for each command against the setup() COA, so shared tests can vary one field. */
const VALID = {
  'symbol.update': ({ coaId, a, revision }) => ({ coaId, expectedRevision: revision, symbolId: a.id, label: 'A2' }),
  'symbol.move': ({ coaId, a, revision }) => ({ coaId, expectedRevision: revision, symbolId: a.id, position: { lat: 12, lng: 22 } }),
  'symbol.remove': ({ coaId, a, revision }) => ({ coaId, expectedRevision: revision, symbolId: a.id }),
};

for (const [type, valid] of Object.entries(VALID)) {
  describe(`${type}: rules shared by every symbol command`, () => {
    it('is NOT_FOUND for an unknown symbol, and changes nothing', async () => {
      const s = await setup();
      const before = await stored(s.h, s.coaId);
      const error = errorOf(await s.h.dispatch(type, { ...valid(s), symbolId: 'sym-404' }), 'NOT_FOUND');
      assert.deepEqual(error.details, { coaId: s.coaId, symbolId: 'sym-404' });
      assert.deepEqual(s.h.takeEvents(), []);
      assert.deepEqual(await stored(s.h, s.coaId), before);
    });

    it('is NOT_FOUND for an unknown COA', async () => {
      const s = await setup();
      assert.deepEqual(errorOf(await s.h.dispatch(type, { ...valid(s), coaId: 'coa-404' }), 'NOT_FOUND').details, { coaId: 'coa-404' });
    });

    it('refuses a stale expectedRevision with CONFLICT and changes nothing', async () => {
      const s = await setup();
      const before = await stored(s.h, s.coaId);
      const error = errorOf(await s.h.dispatch(type, { ...valid(s), expectedRevision: 2 }), 'CONFLICT');
      assert.deepEqual(error.details, { coaId: s.coaId, expectedRevision: 2, actualRevision: 3 });
      assert.deepEqual(s.h.takeEvents(), []);
      assert.deepEqual(await stored(s.h, s.coaId), before);
    });

    it('reports CONFLICT, not NOT_FOUND, when a stale client targets a symbol someone else removed', async () => {
      const s = await setup();
      okValue(await s.h.dispatch('symbol.remove', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id }));
      errorOf(await s.h.dispatch(type, valid(s)), 'CONFLICT');
    });

    for (const [name, change, fields] of [
      ['missing symbolId', { symbolId: MISSING }, ['symbolId']],
      ['blank symbolId', { symbolId: ' ' }, ['symbolId']],
      ['missing expectedRevision', { expectedRevision: MISSING }, ['expectedRevision']],
      ['several problems at once', { coaId: '', expectedRevision: 0, symbolId: '' }, ['coaId', 'expectedRevision', 'symbolId']],
      ['an unknown field', { colour: 'red' }, ['colour']],
    ]) {
      it(`rejects ${name} with VALIDATION_FAILED`, async () => {
        const s = await setup();
        assert.deepEqual(problemFields(errorOf(await s.h.dispatch(type, body({ ...valid(s), ...change })), 'VALIDATION_FAILED')), fields);
        assert.deepEqual(s.h.takeEvents(), []);
      });
    }

    it('passes a storage failure through and publishes nothing', async () => {
      const s = await setup();
      s.repo.save = async () => err('STORAGE_UNAVAILABLE', 'Storage is blocked');
      errorOf(await s.h.dispatch(type, valid(s)), 'STORAGE_UNAVAILABLE');
      assert.deepEqual(s.h.takeEvents(), []);
    });

    it('rejects an unsupported payload version', async () => {
      const s = await setup();
      errorOf(await s.h.dispatch(type, valid(s), { v: 2 }), 'UNSUPPORTED_VERSION');
    });
  });
}

describe('symbol.update', () => {
  it('changes a label in place: new revision, symbol.updated with what changed, order kept', async () => {
    const s = await setup();
    const value = okValue(await s.h.dispatch('symbol.update', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, label: '  A2 ' }));
    const symbol = { ...s.a, label: 'A2' };

    assert.deepEqual(value, { coaId: s.coaId, revision: 4, symbol });
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.v, e.payload]), [
      ['symbol.updated', 1, { coaId: s.coaId, revision: 4, symbol, changed: ['label'] }],
    ]);
    const coa = await stored(s.h, s.coaId);
    assert.deepEqual([coa.revision, coa.updatedAt, coa.symbols], [4, T2, [symbol, s.b]]);
  });

  it('changes only the targeted symbol when it is not the first', async () => {
    const s = await setup();
    const { symbol } = okValue(await s.h.dispatch('symbol.update', { coaId: s.coaId, expectedRevision: 3, symbolId: s.b.id, label: 'B2' }));
    assert.deepEqual((await stored(s.h, s.coaId)).symbols, [s.a, { ...s.b, label: 'B2' }]);
    assert.deepEqual(symbol, { ...s.b, label: 'B2' });
  });

  it('normalises a new SIDC like symbol.add does', async () => {
    const s = await setup();
    const { symbol } = okValue(await s.h.dispatch('symbol.update', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, sidc: ' shgpucaa--***** ' }));
    assert.equal(symbol.sidc, 'SHGPUCAA--*****');
    assert.deepEqual(s.h.takeEvents()[0].payload.changed, ['sidc']);
  });

  it('replaces the whole modifiers object (an empty object clears them)', async () => {
    const s = await setup();
    const replaced = okValue(await s.h.dispatch('symbol.update', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, modifiers: { staffComments: 'Hold' } }));
    assert.deepEqual(replaced.symbol.modifiers, { staffComments: 'Hold' });
    const cleared = okValue(await s.h.dispatch('symbol.update', { coaId: s.coaId, expectedRevision: 4, symbolId: s.a.id, modifiers: {} }));
    assert.deepEqual(cleared.symbol.modifiers, {});
    assert.deepEqual(s.h.takeEvents().map((e) => e.payload.changed), [['modifiers'], ['modifiers']]);
  });

  it('reports several changed fields in the order sidc, label, modifiers', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('symbol.update', {
      coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, modifiers: {}, label: 'Z', sidc: ARMOR,
    }));
    assert.deepEqual(s.h.takeEvents()[0].payload.changed, ['sidc', 'label', 'modifiers']);
  });

  for (const [what, changes] of [
    ['no fields', {}],
    ['the same values', { sidc: INFANTRY, label: 'A', modifiers: { higherFormation: '1-5 INF', direction: 90 } }],
    ['equal values after normalising (case, whitespace, modifier order)', { sidc: ` ${INFANTRY} `, label: ' A ', modifiers: { direction: 90, higherFormation: ' 1-5 INF ', staffComments: '' } }],
  ]) {
    it(`is a no-op for ${what}: ok with the current symbol, no write, no event`, async () => {
      const s = await setup();
      const value = okValue(await s.h.dispatch('symbol.update', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, ...changes }));
      assert.deepEqual(value, { coaId: s.coaId, revision: 3, symbol: s.a });
      assert.deepEqual(s.h.takeEvents(), []);
      assert.deepEqual(s.saves, []);
    });
  }

  for (const [name, change, fields] of [
    ['a position (use symbol.move)', { position: { lat: 0, lng: 0 } }, ['position']],
    ['a malformed SIDC', { sidc: '123' }, ['sidc']],
    ['a label over 30 characters', { label: 'x'.repeat(31) }, ['label']],
    ['an unknown modifier', { modifiers: { speed: '1' } }, ['modifiers.speed']],
    ['several field problems', { sidc: '', label: 1, modifiers: [] }, ['sidc', 'label', 'modifiers']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED`, async () => {
      const s = await setup();
      const reply = await s.h.dispatch('symbol.update', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, ...change });
      assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), fields);
    });
  }
});

describe('symbol.move', () => {
  it('moves a symbol in place: new revision, symbol.moved with from and to, order kept', async () => {
    const s = await setup();
    const value = okValue(await s.h.dispatch('symbol.move', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, position: { lat: 12, lng: 22 } }));
    const symbol = { ...s.a, position: { lat: 12, lng: 22 } };

    assert.deepEqual(value, { coaId: s.coaId, revision: 4, symbol });
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.v, e.payload]), [
      ['symbol.moved', 1, { coaId: s.coaId, revision: 4, symbolId: s.a.id, from: { lat: 10, lng: 20 }, to: { lat: 12, lng: 22 } }],
    ]);
    const coa = await stored(s.h, s.coaId);
    assert.deepEqual([coa.revision, coa.updatedAt, coa.symbols], [4, T2, [symbol, s.b]]);
  });

  it('moves only the targeted symbol when it is not the first', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('symbol.move', { coaId: s.coaId, expectedRevision: 3, symbolId: s.b.id, position: { lat: 5, lng: 5 } }));
    assert.deepEqual((await stored(s.h, s.coaId)).symbols, [s.a, { ...s.b, position: { lat: 5, lng: 5 } }]);
    assert.deepEqual(s.h.takeEvents()[0].payload.from, s.b.position);
  });

  it('wraps the new longitude like symbol.add does', async () => {
    const s = await setup();
    const { symbol } = okValue(await s.h.dispatch('symbol.move', { coaId: s.coaId, expectedRevision: 3, symbolId: s.b.id, position: { lat: 0, lng: 190 } }));
    assert.deepEqual(symbol.position, { lat: 0, lng: -170 });
    assert.deepEqual(s.h.takeEvents()[0].payload.to, { lat: 0, lng: -170 });
  });

  it('is a no-op when the position does not change (after wrapping): no write, no event', async () => {
    const s = await setup();
    const value = okValue(await s.h.dispatch('symbol.move', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, position: { lat: 10, lng: 380 } }));
    assert.deepEqual(value, { coaId: s.coaId, revision: 3, symbol: s.a });
    assert.deepEqual(s.h.takeEvents(), []);
    assert.deepEqual(s.saves, []);
  });

  for (const [name, change, fields] of [
    ['a missing position', { position: MISSING }, ['position']],
    ['a lat out of range', { position: { lat: -91, lng: 0 } }, ['position.lat']],
    ['an extra position key', { position: { lat: 0, lng: 0, alt: 1 } }, ['position.alt']],
    ['other symbol fields (use symbol.update)', { label: 'X' }, ['label']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED`, async () => {
      const s = await setup();
      const reply = await s.h.dispatch('symbol.move', body({ coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id, position: { lat: 1, lng: 1 }, ...change }));
      assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), fields);
    });
  }
});

describe('symbol.remove', () => {
  it('removes a symbol: new revision, symbol.removed, the others stay in order', async () => {
    const s = await setup();
    assert.deepEqual(
      okValue(await s.h.dispatch('symbol.remove', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id })),
      { coaId: s.coaId, revision: 4, symbolId: s.a.id },
    );
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.v, e.payload]), [
      ['symbol.removed', 1, { coaId: s.coaId, revision: 4, symbolId: s.a.id }],
    ]);
    const coa = await stored(s.h, s.coaId);
    assert.deepEqual([coa.revision, coa.updatedAt, coa.symbols], [4, T2, [s.b]]);
    assert.equal(okValue(await s.h.query('coa.list'))[0].symbolCount, 1);
  });

  it('removes only the targeted symbol when it is not the first', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('symbol.remove', { coaId: s.coaId, expectedRevision: 3, symbolId: s.b.id }));
    assert.deepEqual((await stored(s.h, s.coaId)).symbols, [s.a]);
  });

  it('is NOT_FOUND when removing the same symbol twice', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('symbol.remove', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id }));
    errorOf(await s.h.dispatch('symbol.remove', { coaId: s.coaId, expectedRevision: 4, symbolId: s.a.id }), 'NOT_FOUND');
  });

  it('can remove every symbol', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('symbol.remove', { coaId: s.coaId, expectedRevision: 3, symbolId: s.a.id }));
    okValue(await s.h.dispatch('symbol.remove', { coaId: s.coaId, expectedRevision: 4, symbolId: s.b.id }));
    assert.deepEqual((await stored(s.h, s.coaId)).symbols, []);
  });
});
