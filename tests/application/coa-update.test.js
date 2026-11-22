// Slice: coa.update — tested only through envelopes at the driving boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields, T0 } from '../support/app-harness.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { err } from '../../src/shared/result.js';

const T1 = '2026-11-22T20:41:00.000Z';
const MISSING = Symbol('missing'); // marks a payload field to leave out

/** A harness with one COA created at T0 and the clock moved on to T1. */
async function withCoa(options) {
  const h = createHarness(options);
  const coa = okValue(await h.dispatch('coa.create', { name: 'Envelopment', description: 'Main effort north' }));
  h.takeEvents();
  h.clock.advance(60_000);
  return { h, coa };
}

/** Asserts the COA is exactly as it was and nothing was published. */
async function assertUnchanged(h, coa) {
  assert.deepEqual(h.takeEvents(), []);
  assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })), coa);
}

describe('coa.update', () => {
  it('renames a COA: new revision and updatedAt, publishes coa.updated with what changed', async () => {
    const { h, coa } = await withCoa();
    const updated = okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'Penetration' }));

    assert.deepEqual(updated, { ...coa, name: 'Penetration', revision: 2, updatedAt: T1 });
    const [event, ...rest] = h.takeEvents();
    assert.deepEqual(rest, []);
    assert.deepEqual([event.type, event.v, event.payload], ['coa.updated', 1, { coa: updated, changed: ['name'] }]);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })), updated);
    assert.deepEqual(okValue(await h.query('coa.list')), [
      { id: coa.id, name: 'Penetration', symbolCount: 0, revision: 2, updatedAt: T1 },
    ]);
  });

  for (const [what, changes, changed] of [
    ['the description', { description: 'Supporting effort' }, ['description']],
    ['both fields', { name: 'B', description: 'C' }, ['name', 'description']],
    ['the description to empty', { description: '' }, ['description']],
  ]) {
    it(`updates ${what}`, async () => {
      const { h, coa } = await withCoa();
      const updated = okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, ...changes }));
      assert.deepEqual(updated, { ...coa, ...changes, revision: 2, updatedAt: T1 });
      assert.deepEqual(h.takeEvents().map((e) => e.payload.changed), [changed]);
    });
  }

  it('trims, and only reports fields whose trimmed value actually changed', async () => {
    const { h, coa } = await withCoa();
    const updated = okValue(await h.dispatch('coa.update', {
      coaId: coa.id, expectedRevision: 1, name: '  Envelopment  ', description: '  New note ',
    }));
    assert.deepEqual([updated.name, updated.description], ['Envelopment', 'New note']);
    assert.deepEqual(h.takeEvents().map((e) => e.payload.changed), [['description']]);
  });

  for (const [what, changes] of [
    ['no fields', {}],
    ['the same values', { name: 'Envelopment', description: 'Main effort north' }],
    ['values equal after trimming', { name: ' Envelopment ' }],
  ]) {
    it(`is a no-op for ${what}: ok with the unchanged COA, no new revision, no event`, async () => {
      const { h, coa } = await withCoa();
      assert.deepEqual(okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, ...changes })), coa);
      await assertUnchanged(h, coa);
    });
  }

  it('does not write to storage for a no-op (driven-port boundary)', async () => {
    const repo = new InMemoryCoaRepository();
    const { h, coa } = await withCoa({ coaRepository: repo });
    const saves = [];
    const save = repo.save.bind(repo);
    repo.save = (...args) => { saves.push(args); return save(...args); };
    okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'Envelopment' }));
    assert.deepEqual(saves, []);
    okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'B' }));
    assert.deepEqual(saves.map(([saved, opts]) => [saved.name, saved.revision, opts]), [['B', 2, { expectedRevision: 1 }]]);
  });

  it('accepts successive updates when each uses the latest revision', async () => {
    const { h, coa } = await withCoa();
    okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'B' }));
    const third = okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 2, name: 'C' }));
    assert.deepEqual([third.name, third.revision], ['C', 3]);
  });

  it('refuses a stale expectedRevision with CONFLICT and changes nothing', async () => {
    const { h, coa } = await withCoa();
    const current = okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'B' }));
    h.takeEvents();

    const error = errorOf(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'Late' }), 'CONFLICT');
    assert.deepEqual(error.details, { coaId: coa.id, expectedRevision: 1, actualRevision: 2 });
    await assertUnchanged(h, current);
  });

  it('reports CONFLICT for a stale revision even when the update would be a no-op', async () => {
    const { h, coa } = await withCoa();
    okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'B' }));
    errorOf(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1 }), 'CONFLICT');
  });

  it('passes through a CONFLICT from storage (another writer got in between) and publishes nothing', async () => {
    const racing = new InMemoryCoaRepository();
    const { h, coa } = await withCoa({ coaRepository: racing });
    racing.save = async () => err('CONFLICT', 'Changed elsewhere', { coaId: coa.id, expectedRevision: 1, actualRevision: 2 });
    errorOf(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'B' }), 'CONFLICT');
    assert.deepEqual(h.takeEvents(), []);
  });

  it('is NOT_FOUND for an unknown COA', async () => {
    const { h } = await withCoa();
    const error = errorOf(await h.dispatch('coa.update', { coaId: 'coa-404', expectedRevision: 1, name: 'B' }), 'NOT_FOUND');
    assert.deepEqual(error.details, { coaId: 'coa-404' });
  });

  const invalid = [
    ['missing coaId', { coaId: MISSING, expectedRevision: 1 }, ['coaId']],
    ['blank coaId', { coaId: ' ', expectedRevision: 1 }, ['coaId']],
    ['missing expectedRevision', { name: 'B' }, ['expectedRevision']],
    ['expectedRevision 0', { expectedRevision: 0 }, ['expectedRevision']],
    ['negative expectedRevision', { expectedRevision: -1 }, ['expectedRevision']],
    ['fractional expectedRevision', { expectedRevision: 1.5 }, ['expectedRevision']],
    ['string expectedRevision', { expectedRevision: '1' }, ['expectedRevision']],
    ['blank name', { expectedRevision: 1, name: '  ' }, ['name']],
    ['non-string name', { expectedRevision: 1, name: 7 }, ['name']],
    ['name over 120 characters', { expectedRevision: 1, name: 'x'.repeat(121) }, ['name']],
    ['non-string description', { expectedRevision: 1, description: null }, ['description']],
    ['description over 2000 characters', { expectedRevision: 1, description: 'x'.repeat(2001) }, ['description']],
    ['unknown field', { expectedRevision: 1, symbols: [] }, ['symbols']],
    ['several problems at once', { coaId: '', expectedRevision: 0, name: '' }, ['coaId', 'expectedRevision', 'name']],
  ];
  for (const [name, payload, fields] of invalid) {
    it(`rejects ${name} with VALIDATION_FAILED and changes nothing`, async () => {
      const { h, coa } = await withCoa();
      const body = { coaId: coa.id, ...payload };
      for (const [key, value] of Object.entries(body)) if (value === MISSING) delete body[key];
      const error = errorOf(await h.dispatch('coa.update', body), 'VALIDATION_FAILED');
      assert.deepEqual(problemFields(error), fields);
      await assertUnchanged(h, coa);
    });
  }

  it('validates the payload before looking the COA up (bad name on an unknown COA is VALIDATION_FAILED)', async () => {
    const { h } = await withCoa();
    errorOf(await h.dispatch('coa.update', { coaId: 'coa-404', expectedRevision: 1, name: '' }), 'VALIDATION_FAILED');
  });

  it('rejects an unsupported payload version', async () => {
    const { h, coa } = await withCoa();
    errorOf(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1 }, { v: 2 }), 'UNSUPPORTED_VERSION');
  });

  it('keeps createdAt untouched', async () => {
    const { h, coa } = await withCoa();
    const updated = okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'B' }));
    assert.equal(updated.createdAt, T0);
  });
});
