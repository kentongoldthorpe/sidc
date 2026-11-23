// COA-1.15: the browser-storage fallback (Web Storage API), via the FakeStorage double.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocalStorageDocumentRepository } from '../../../src/adapters/persistence/local-storage-document-repository.js';
import { coaStore } from '../../../src/application/stores/coa-store.js';

/** COAs through the browser-storage adapter, seen as the core sees them. */
const LocalStorageCoas = (options) => coaStore(new LocalStorageDocumentRepository(options));
import { coaToGeoJson } from '../../../src/adapters/persistence/geojson-coa.js';
import { describeCoaRepositoryContract } from '../../contracts/coa-store.contract.js';
import { FakeStorage, blockedStorage } from '../../support/fake-storage.js';
import { aCoa, aSymbol } from '../../support/coa-fixtures.js';

describeCoaRepositoryContract('LocalStorageCoas', () => LocalStorageCoas({ storage: new FakeStorage() }));

const okValue = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
const errorOf = (r, code) => { assert.equal(r.ok, false, 'expected a failure'); assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };

describe('LocalStorageCoas specifics', () => {
  it('stores each COA as its GeoJSON document under a prefixed key', async () => {
    const storage = new FakeStorage();
    const coa = aCoa({ symbols: [aSymbol()] });
    okValue(await LocalStorageCoas({ storage }).save(coa, { expectedRevision: 0 }));
    assert.deepEqual(JSON.parse(storage.getItem('coa-builder:coa:coa-1')), coaToGeoJson(coa));
  });

  it('keeps data across instances on the same storage (a page reload)', async () => {
    const storage = new FakeStorage();
    await LocalStorageCoas({ storage }).save(aCoa(), { expectedRevision: 0 });
    assert.equal(okValue(await LocalStorageCoas({ storage }).get('coa-1')).name, 'COA 1');
  });

  it('ignores keys that belong to other apps', async () => {
    const storage = new FakeStorage();
    storage.setItem('theme', 'dark');
    storage.setItem('other-app:coa:x', '{}');
    assert.deepEqual(okValue(await LocalStorageCoas({ storage }).list()), []);
  });

  it('skips unreadable entries in list and reports them on get', async () => {
    const storage = new FakeStorage();
    const repo = LocalStorageCoas({ storage });
    await repo.save(aCoa({ id: 'good' }), { expectedRevision: 0 });
    storage.setItem('coa-builder:coa:broken', '{ not json');
    assert.deepEqual(okValue(await repo.list()).map((s) => s.id), ['good']);
    assert.equal(errorOf(await repo.get('broken'), 'STORAGE_UNAVAILABLE').details.coaId, 'broken');
  });

  it('reports a full storage as STORAGE_QUOTA_EXCEEDED and keeps the previous version', async () => {
    const storage = new FakeStorage({ quota: 2000 });
    const repo = LocalStorageCoas({ storage });
    okValue(await repo.save(aCoa(), { expectedRevision: 0 }));
    const big = aCoa({ revision: 2, description: 'x'.repeat(1900) });
    errorOf(await repo.save(big, { expectedRevision: 1 }), 'STORAGE_QUOTA_EXCEEDED');
    assert.equal(okValue(await repo.get('coa-1')).revision, 1);
  });

  it('reports blocked storage as STORAGE_UNAVAILABLE instead of throwing', async () => {
    const repo = LocalStorageCoas({ storage: blockedStorage() });
    for (const result of [await repo.list(), await repo.get('x'), await repo.save(aCoa(), { expectedRevision: 0 }), await repo.remove('x', { expectedRevision: 1 })]) {
      errorOf(result, 'STORAGE_UNAVAILABLE');
    }
  });

  it('uses a custom key prefix', async () => {
    const storage = new FakeStorage();
    await LocalStorageCoas({ storage, prefix: 'test' }).save(aCoa(), { expectedRevision: 0 });
    assert.ok(storage.getItem('test:coa:coa-1'));
  });

  it('requires a storage object', () => {
    assert.throws(() => LocalStorageCoas({}), TypeError);
  });
});
