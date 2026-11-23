// Slices: symbol.copy (one or many units, same or another COA) and symbol.remove-many.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { err } from '../../src/shared/result.js';

const INFANTRY = '10031000001211000000';
const ARMOR = '10031000001205000000';
const MISSING = Symbol('missing');

/** COA "Source" (revision 4) with units A, B, C, and an empty COA "Target" (revision 1). */
async function setup(options) {
  const h = createHarness(options);
  const source = okValue(await h.dispatch('coa.create', { name: 'Source' }));
  const target = okValue(await h.dispatch('coa.create', { name: 'Target' }));
  const units = [];
  for (const [i, [sidc, label]] of [[INFANTRY, 'A'], [ARMOR, 'B'], [INFANTRY, 'C']].entries()) {
    units.push(okValue(await h.dispatch('symbol.add', {
      coaId: source.id, expectedRevision: 1 + i, sidc, label, position: { lat: 10 + i, lng: 20 + i }, modifiers: { staffComments: `note ${label}` },
    })).symbol);
  }
  h.takeEvents();
  const get = async (coaId) => okValue(await h.query('coa.get', { coaId }));
  return { h, source: await get(source.id), target: await get(target.id), units, get };
}

const body = (payload) => {
  const out = { ...payload };
  for (const [key, value] of Object.entries(out)) if (value === MISSING) delete out[key];
  return out;
};

describe('symbol.copy', () => {
  it('copies units into another COA with fresh ids, same order, in one revision; publishes symbol.added per copy', async () => {
    const { h, source, target, units, get } = await setup();
    const value = okValue(await h.dispatch('symbol.copy', {
      coaId: target.id, expectedRevision: 1, fromCoaId: source.id, symbolIds: [units[2].id, units[0].id],
    }));
    assert.equal(value.coaId, target.id);
    assert.equal(value.revision, 2);
    assert.deepEqual(value.symbols.map(({ id, ...rest }) => rest), [units[2], units[0]].map(({ id, ...rest }) => rest));
    for (const copy of value.symbols) assert.ok(!units.some((u) => u.id === copy.id), 'fresh ids');

    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload.coaId, e.payload.revision, e.payload.symbol.label]),
      [['symbol.added', target.id, 2, 'C'], ['symbol.added', target.id, 2, 'A']]);
    assert.deepEqual((await get(target.id)).symbols, value.symbols);
    assert.deepEqual(await get(source.id), source, 'the source COA is untouched');
  });

  it('copies within the same COA, applying the offset so copies do not sit on top of the originals', async () => {
    const { h, source, units, get } = await setup();
    const value = okValue(await h.dispatch('symbol.copy', {
      coaId: source.id, expectedRevision: 4, fromCoaId: source.id, symbolIds: [units[0].id, units[1].id], offset: { lat: -0.01, lng: 0.01 },
    }));
    assert.deepEqual(value.symbols.map((s) => s.position), [{ lat: 9.99, lng: 20.01 }, { lat: 10.99, lng: 21.01 }]);
    const after = await get(source.id);
    assert.deepEqual(after.symbols.map((s) => s.label), ['A', 'B', 'C', 'A', 'B']);
    assert.equal(after.revision, 5);
  });

  it('wraps longitude and refuses a copy whose latitude would leave the map', async () => {
    const { h, source, target, units } = await setup();
    const wrapped = okValue(await h.dispatch('symbol.copy', {
      coaId: target.id, expectedRevision: 1, fromCoaId: source.id, symbolIds: [units[0].id], offset: { lat: 0, lng: 170 },
    }));
    assert.equal(wrapped.symbols[0].position.lng, -170);
    const error = errorOf(await h.dispatch('symbol.copy', {
      coaId: target.id, expectedRevision: 2, fromCoaId: source.id, symbolIds: [units[0].id], offset: { lat: 85, lng: 0 },
    }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(error), ['offset.lat']);
  });

  it('is NOT_FOUND (and copies nothing) if any unit is missing from the source', async () => {
    const { h, source, target, units, get } = await setup();
    const error = errorOf(await h.dispatch('symbol.copy', {
      coaId: target.id, expectedRevision: 1, fromCoaId: source.id, symbolIds: [units[0].id, 'sym-404'],
    }), 'NOT_FOUND');
    assert.deepEqual(error.details, { coaId: source.id, symbolId: 'sym-404' });
    assert.deepEqual((await get(target.id)).symbols, []);
    assert.deepEqual(h.takeEvents(), []);
  });

  it('is NOT_FOUND for an unknown source or target COA', async () => {
    const { h, source, target, units } = await setup();
    assert.deepEqual(errorOf(await h.dispatch('symbol.copy', { coaId: target.id, expectedRevision: 1, fromCoaId: 'coa-404', symbolIds: [units[0].id] }), 'NOT_FOUND').details, { coaId: 'coa-404' });
    assert.deepEqual(errorOf(await h.dispatch('symbol.copy', { coaId: 'coa-404', expectedRevision: 1, fromCoaId: source.id, symbolIds: [units[0].id] }), 'NOT_FOUND').details, { coaId: 'coa-404' });
  });

  it('refuses a stale target revision with CONFLICT', async () => {
    const { h, source, target, units } = await setup();
    const error = errorOf(await h.dispatch('symbol.copy', { coaId: target.id, expectedRevision: 7, fromCoaId: source.id, symbolIds: [units[0].id] }), 'CONFLICT');
    assert.deepEqual(error.details, { coaId: target.id, expectedRevision: 7, actualRevision: 1 });
  });

  for (const [name, change, fields] of [
    ['an empty symbolIds', { symbolIds: [] }, ['symbolIds']],
    ['symbolIds that is not an array', { symbolIds: 'sym-1' }, ['symbolIds']],
    ['a duplicated symbol id', { symbolIds: ['x', 'x'] }, ['symbolIds']],
    ['a blank symbol id', { symbolIds: [' '] }, ['symbolIds[0]']],
    ['a missing fromCoaId', { fromCoaId: MISSING }, ['fromCoaId']],
    ['a non-numeric offset', { offset: { lat: '1', lng: 0 } }, ['offset.lat']],
    ['an offset with extra keys', { offset: { lat: 0, lng: 0, alt: 1 } }, ['offset.alt']],
    ['an offset that is not an object', { offset: 5 }, ['offset']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED`, async () => {
      const { h, source, target, units } = await setup();
      const reply = await h.dispatch('symbol.copy', body({ coaId: target.id, expectedRevision: 1, fromCoaId: source.id, symbolIds: [units[0].id], ...change }));
      assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), fields);
    });
  }

  it('passes a storage failure through and publishes nothing', async () => {
    const repo = new InMemoryCoaRepository();
    const { h, source, target, units } = await setup({ coaRepository: repo });
    repo.save = async () => err('STORAGE_QUOTA_EXCEEDED', 'Storage is full');
    errorOf(await h.dispatch('symbol.copy', { coaId: target.id, expectedRevision: 1, fromCoaId: source.id, symbolIds: [units[0].id] }), 'STORAGE_QUOTA_EXCEEDED');
    assert.deepEqual(h.takeEvents(), []);
  });
});

describe('symbol.remove-many', () => {
  it('removes several units in one revision; publishes symbol.removed per unit; the rest keep their order', async () => {
    const { h, source, units, get } = await setup();
    assert.deepEqual(okValue(await h.dispatch('symbol.remove-many', { coaId: source.id, expectedRevision: 4, symbolIds: [units[2].id, units[0].id] })),
      { coaId: source.id, revision: 5, symbolIds: [units[2].id, units[0].id] });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload]), [
      ['symbol.removed', { coaId: source.id, revision: 5, symbolId: units[2].id }],
      ['symbol.removed', { coaId: source.id, revision: 5, symbolId: units[0].id }],
    ]);
    assert.deepEqual((await get(source.id)).symbols.map((s) => s.label), ['B']);
  });

  it('removes nothing if any unit is missing (NOT_FOUND)', async () => {
    const { h, source, units, get } = await setup();
    const error = errorOf(await h.dispatch('symbol.remove-many', { coaId: source.id, expectedRevision: 4, symbolIds: [units[0].id, 'sym-404'] }), 'NOT_FOUND');
    assert.deepEqual(error.details, { coaId: source.id, symbolId: 'sym-404' });
    assert.equal((await get(source.id)).symbols.length, 3);
    assert.deepEqual(h.takeEvents(), []);
  });

  it('refuses a stale revision with CONFLICT', async () => {
    const { h, source, units } = await setup();
    errorOf(await h.dispatch('symbol.remove-many', { coaId: source.id, expectedRevision: 2, symbolIds: [units[0].id] }), 'CONFLICT');
  });

  for (const [name, change, fields] of [
    ['an empty symbolIds', { symbolIds: [] }, ['symbolIds']],
    ['a duplicated symbol id', { symbolIds: ['x', 'x'] }, ['symbolIds']],
    ['a missing expectedRevision', { expectedRevision: MISSING }, ['expectedRevision']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED`, async () => {
      const { h, source, units } = await setup();
      const reply = await h.dispatch('symbol.remove-many', body({ coaId: source.id, expectedRevision: 4, symbolIds: [units[0].id], ...change }));
      assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), fields);
    });
  }
});
