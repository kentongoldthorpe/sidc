// Contract every CoaRepository adapter must satisfy (driven port).
// Usage: describeCoaRepositoryContract('LocalStorage', () => new LocalStorageCoaRepository(new FakeStorage()))
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aCoa, aSymbol } from '../support/coa-fixtures.js';

const okValue = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
const errorOf = (r, code) => { assert.equal(r.ok, false); assert.equal(r.error.code, code); return r.error; };

export function describeCoaRepositoryContract(name, makeRepository) {
  describe(`CoaRepository contract: ${name}`, () => {
    it('returns promises', async () => {
      const repo = makeRepository();
      const pending = [repo.list(), repo.get('x'), repo.save(aCoa(), { expectedRevision: 0 }), repo.remove('x', { expectedRevision: 1 })];
      for (const p of pending) assert.equal(typeof p.then, 'function');
      await Promise.all(pending); // settle before the next test, so a real server's writes cannot leak into it
    });

    it('starts empty', async () => {
      assert.deepEqual(okValue(await makeRepository().list()), []);
    });

    it('saves a new COA with expectedRevision 0 and gets it back', async () => {
      const repo = makeRepository();
      const coa = aCoa({ symbols: [aSymbol()] });
      okValue(await repo.save(coa, { expectedRevision: 0 }));
      assert.deepEqual(okValue(await repo.get('coa-1')), coa);
    });

    it('refuses to create a COA whose id already exists (CONFLICT)', async () => {
      const repo = makeRepository();
      await repo.save(aCoa(), { expectedRevision: 0 });
      const e = errorOf(await repo.save(aCoa({ name: 'Other' }), { expectedRevision: 0 }), 'CONFLICT');
      assert.deepEqual(e.details, { coaId: 'coa-1', expectedRevision: 0, actualRevision: 1 });
      assert.equal(okValue(await repo.get('coa-1')).name, 'COA 1');
    });

    it('updates when expectedRevision matches the stored revision', async () => {
      const repo = makeRepository();
      await repo.save(aCoa(), { expectedRevision: 0 });
      okValue(await repo.save(aCoa({ name: 'Renamed', revision: 2 }), { expectedRevision: 1 }));
      assert.equal(okValue(await repo.get('coa-1')).name, 'Renamed');
    });

    it('refuses a stale update (CONFLICT) and keeps the stored version', async () => {
      const repo = makeRepository();
      await repo.save(aCoa(), { expectedRevision: 0 });
      await repo.save(aCoa({ revision: 2 }), { expectedRevision: 1 });
      const e = errorOf(await repo.save(aCoa({ name: 'Late', revision: 2 }), { expectedRevision: 1 }), 'CONFLICT');
      assert.deepEqual(e.details, { coaId: 'coa-1', expectedRevision: 1, actualRevision: 2 });
      assert.equal(okValue(await repo.get('coa-1')).name, 'COA 1');
    });

    it('refuses to update a COA that does not exist (NOT_FOUND)', async () => {
      const e = errorOf(await makeRepository().save(aCoa({ revision: 4 }), { expectedRevision: 3 }), 'NOT_FOUND');
      assert.deepEqual(e.details, { coaId: 'coa-1' });
    });

    it('get of an unknown id is NOT_FOUND', async () => {
      assert.deepEqual(errorOf(await makeRepository().get('nope'), 'NOT_FOUND').details, { coaId: 'nope' });
    });

    it('removes with a matching revision', async () => {
      const repo = makeRepository();
      await repo.save(aCoa(), { expectedRevision: 0 });
      okValue(await repo.remove('coa-1', { expectedRevision: 1 }));
      errorOf(await repo.get('coa-1'), 'NOT_FOUND');
      assert.deepEqual(okValue(await repo.list()), []);
    });

    it('refuses a stale remove (CONFLICT) and an unknown remove (NOT_FOUND)', async () => {
      const repo = makeRepository();
      await repo.save(aCoa(), { expectedRevision: 0 });
      errorOf(await repo.remove('coa-1', { expectedRevision: 7 }), 'CONFLICT');
      errorOf(await repo.remove('nope', { expectedRevision: 1 }), 'NOT_FOUND');
      okValue(await repo.get('coa-1'));
    });

    it('lists summaries, most recently updated first (ties by name, then id)', async () => {
      const repo = makeRepository();
      await repo.save(aCoa({ id: 'a', name: 'Old', updatedAt: '2026-01-01T00:00:00.000Z' }), { expectedRevision: 0 });
      await repo.save(aCoa({ id: 'b', name: 'New', updatedAt: '2026-03-01T00:00:00.000Z', symbols: [aSymbol(), aSymbol({ id: 'sym-2' })] }), { expectedRevision: 0 });
      await repo.save(aCoa({ id: 'd', name: 'Mid', updatedAt: '2026-02-01T00:00:00.000Z' }), { expectedRevision: 0 });
      await repo.save(aCoa({ id: 'c', name: 'Mid', updatedAt: '2026-02-01T00:00:00.000Z' }), { expectedRevision: 0 });
      assert.deepEqual(okValue(await repo.list()), [
        { id: 'b', name: 'New', symbolCount: 2, revision: 1, updatedAt: '2026-03-01T00:00:00.000Z' },
        { id: 'c', name: 'Mid', symbolCount: 0, revision: 1, updatedAt: '2026-02-01T00:00:00.000Z' },
        { id: 'd', name: 'Mid', symbolCount: 0, revision: 1, updatedAt: '2026-02-01T00:00:00.000Z' },
        { id: 'a', name: 'Old', symbolCount: 0, revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      ]);
    });

    it('is isolated from callers: later changes to saved or returned objects do not leak in', async () => {
      const repo = makeRepository();
      const coa = aCoa();
      await repo.save(coa, { expectedRevision: 0 });
      coa.name = 'Mutated after save';
      const got = okValue(await repo.get('coa-1'));
      assert.equal(got.name, 'COA 1');
      assert.ok(Object.isFrozen(got) && Object.isFrozen(got.symbols));
    });
  });
}
