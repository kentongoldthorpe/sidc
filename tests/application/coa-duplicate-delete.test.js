// Slices: coa.duplicate and coa.delete — tested only through envelopes at the boundaries.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { aCoa, aSymbol } from '../support/coa-fixtures.js';
import { err } from '../../src/shared/result.js';

const T1 = '2026-11-22T20:41:00.000Z';
const MISSING = Symbol('missing');

/** A harness with one COA created at T0 and the clock moved on to T1. */
async function withCoa({ name = 'Envelopment', coaRepository } = {}) {
  const h = createHarness({ coaRepository });
  const coa = okValue(await h.dispatch('coa.create', { name, description: 'Main effort north' }));
  h.takeEvents();
  h.clock.advance(60_000);
  return { h, coa };
}

/** A harness whose repository already holds a COA with symbols (arranged through the driven port). */
async function withSeededCoa() {
  const repo = new InMemoryCoaRepository();
  const source = aCoa({
    id: 'coa-seed', name: 'Seeded', revision: 3,
    symbols: [aSymbol({ id: 'sym-a', label: 'A' }), aSymbol({ id: 'sym-b', label: 'B', lat: 1, lng: 2 })],
  });
  await repo.save(source, { expectedRevision: 0 });
  const h = createHarness({ coaRepository: repo });
  h.clock.advance(60_000);
  return { h, source };
}

const withoutMissing = (payload) => {
  const body = { ...payload };
  for (const [key, value] of Object.entries(body)) if (value === MISSING) delete body[key];
  return body;
};

describe('coa.duplicate', () => {
  it('copies a COA under a new id and "(copy)" name, publishing coa.duplicated', async () => {
    const { h, coa } = await withCoa();
    const copy = okValue(await h.dispatch('coa.duplicate', { coaId: coa.id }));

    assert.notEqual(copy.id, coa.id);
    assert.match(copy.id, /^coa-/);
    assert.deepEqual(copy, {
      id: copy.id, name: 'Envelopment (copy)', description: 'Main effort north',
      createdAt: T1, updatedAt: T1, revision: 1, symbols: [], graphics: [],
    });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.v, e.payload]), [
      ['coa.duplicated', 1, { sourceCoaId: coa.id, coa: copy }],
    ]);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: copy.id })), copy);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })), coa);
    assert.deepEqual(okValue(await h.query('coa.list')).map((s) => s.id), [copy.id, coa.id]);
  });

  it('uses a given name, trimmed', async () => {
    const { h, coa } = await withCoa();
    assert.equal(okValue(await h.dispatch('coa.duplicate', { coaId: coa.id, name: '  Branch plan  ' })).name, 'Branch plan');
  });

  it('copies symbols in order with fresh ids, leaving the source untouched', async () => {
    const { h, source } = await withSeededCoa();
    const copy = okValue(await h.dispatch('coa.duplicate', { coaId: source.id }));

    assert.equal(copy.revision, 1);
    assert.deepEqual(copy.symbols.map(({ id, ...rest }) => rest), source.symbols.map(({ id, ...rest }) => rest));
    const copyIds = copy.symbols.map((s) => s.id);
    assert.equal(new Set(copyIds).size, 2);
    for (const id of copyIds) {
      assert.match(id, /^sym-/);
      assert.ok(!source.symbols.some((s) => s.id === id), `reused source id ${id}`);
    }
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: source.id })), source);
    assert.deepEqual(okValue(await h.query('coa.list')).find((s) => s.id === copy.id).symbolCount, 2);
  });

  it('shortens a long source name so the default copy name still fits in 120 characters', async () => {
    const { h, coa } = await withCoa({ name: `${'x'.repeat(115)} tail` });
    const { name } = okValue(await h.dispatch('coa.duplicate', { coaId: coa.id }));
    assert.equal(name.length, 120);
    assert.ok(name.endsWith(' (copy)'));
    assert.equal(name, `${'x'.repeat(113)} (copy)`);
  });

  it('can duplicate a duplicate', async () => {
    const { h, coa } = await withCoa({ name: 'A' });
    const copy = okValue(await h.dispatch('coa.duplicate', { coaId: coa.id }));
    assert.equal(okValue(await h.dispatch('coa.duplicate', { coaId: copy.id })).name, 'A (copy) (copy)');
  });

  it('is NOT_FOUND for an unknown COA and publishes nothing', async () => {
    const { h } = await withCoa();
    assert.deepEqual(errorOf(await h.dispatch('coa.duplicate', { coaId: 'coa-404' }), 'NOT_FOUND').details, { coaId: 'coa-404' });
    assert.deepEqual(h.takeEvents(), []);
  });

  for (const [name, payload, fields] of [
    ['missing coaId', { coaId: MISSING }, ['coaId']],
    ['blank coaId', { coaId: '' }, ['coaId']],
    ['blank name', { name: ' ' }, ['name']],
    ['non-string name', { name: 3 }, ['name']],
    ['name over 120 characters', { name: 'x'.repeat(121) }, ['name']],
    ['unknown field (duplicate takes no revision)', { expectedRevision: 1 }, ['expectedRevision']],
    ['several problems at once', { coaId: ' ', name: '' }, ['coaId', 'name']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED and creates nothing`, async () => {
      const { h, coa } = await withCoa();
      const error = errorOf(await h.dispatch('coa.duplicate', withoutMissing({ coaId: coa.id, ...payload })), 'VALIDATION_FAILED');
      assert.deepEqual(problemFields(error), fields);
      assert.deepEqual(h.takeEvents(), []);
      assert.equal(okValue(await h.query('coa.list')).length, 1);
    });
  }

  it('passes a storage failure through and publishes nothing', async () => {
    const repo = new InMemoryCoaRepository();
    const { h, coa } = await withCoa({ coaRepository: repo });
    repo.save = async () => err('STORAGE_QUOTA_EXCEEDED', 'Storage is full');
    errorOf(await h.dispatch('coa.duplicate', { coaId: coa.id }), 'STORAGE_QUOTA_EXCEEDED');
    assert.deepEqual(h.takeEvents(), []);
  });

  it('rejects an unsupported payload version', async () => {
    const { h, coa } = await withCoa();
    errorOf(await h.dispatch('coa.duplicate', { coaId: coa.id }, { v: 2 }), 'UNSUPPORTED_VERSION');
  });
});

describe('coa.delete', () => {
  it('deletes a COA, replies with its id and publishes coa.deleted', async () => {
    const { h, coa } = await withCoa();
    assert.deepEqual(okValue(await h.dispatch('coa.delete', { coaId: coa.id, expectedRevision: 1 })), { coaId: coa.id });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.v, e.payload]), [['coa.deleted', 1, { coaId: coa.id }]]);
    errorOf(await h.query('coa.get', { coaId: coa.id }), 'NOT_FOUND');
    assert.deepEqual(okValue(await h.query('coa.list')), []);
  });

  it('leaves other COAs alone', async () => {
    const { h, coa } = await withCoa();
    const other = okValue(await h.dispatch('coa.create', { name: 'Other' }));
    okValue(await h.dispatch('coa.delete', { coaId: coa.id, expectedRevision: 1 }));
    assert.deepEqual(okValue(await h.query('coa.list')).map((s) => s.id), [other.id]);
  });

  it('refuses a stale expectedRevision with CONFLICT and keeps the COA', async () => {
    const { h, coa } = await withCoa();
    const current = okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'B' }));
    h.takeEvents();
    const error = errorOf(await h.dispatch('coa.delete', { coaId: coa.id, expectedRevision: 1 }), 'CONFLICT');
    assert.deepEqual(error.details, { coaId: coa.id, expectedRevision: 1, actualRevision: 2 });
    assert.deepEqual(h.takeEvents(), []);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })), current);
  });

  it('is NOT_FOUND for an unknown COA, or one already deleted', async () => {
    const { h, coa } = await withCoa();
    okValue(await h.dispatch('coa.delete', { coaId: coa.id, expectedRevision: 1 }));
    h.takeEvents();
    assert.deepEqual(errorOf(await h.dispatch('coa.delete', { coaId: coa.id, expectedRevision: 1 }), 'NOT_FOUND').details, { coaId: coa.id });
    errorOf(await h.dispatch('coa.delete', { coaId: 'coa-404', expectedRevision: 1 }), 'NOT_FOUND');
    assert.deepEqual(h.takeEvents(), []);
  });

  for (const [name, payload, fields] of [
    ['missing coaId', { coaId: MISSING }, ['coaId']],
    ['blank coaId', { coaId: ' ' }, ['coaId']],
    ['missing expectedRevision', { expectedRevision: MISSING }, ['expectedRevision']],
    ['expectedRevision 0', { expectedRevision: 0 }, ['expectedRevision']],
    ['string expectedRevision', { expectedRevision: '1' }, ['expectedRevision']],
    ['unknown field', { force: true }, ['force']],
    ['several problems at once', { coaId: '', expectedRevision: -2 }, ['coaId', 'expectedRevision']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED and deletes nothing`, async () => {
      const { h, coa } = await withCoa();
      const error = errorOf(await h.dispatch('coa.delete', withoutMissing({ coaId: coa.id, expectedRevision: 1, ...payload })), 'VALIDATION_FAILED');
      assert.deepEqual(problemFields(error), fields);
      assert.deepEqual(h.takeEvents(), []);
      okValue(await h.query('coa.get', { coaId: coa.id }));
    });
  }

  it('passes a storage failure through and publishes nothing', async () => {
    const repo = new InMemoryCoaRepository();
    const { h, coa } = await withCoa({ coaRepository: repo });
    repo.remove = async () => err('STORAGE_UNAVAILABLE', 'Storage is blocked');
    errorOf(await h.dispatch('coa.delete', { coaId: coa.id, expectedRevision: 1 }), 'STORAGE_UNAVAILABLE');
    assert.deepEqual(h.takeEvents(), []);
  });

  it('rejects an unsupported payload version', async () => {
    const { h, coa } = await withCoa();
    errorOf(await h.dispatch('coa.delete', { coaId: coa.id, expectedRevision: 1 }, { v: 3 }), 'UNSUPPORTED_VERSION');
  });
});
