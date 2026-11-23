// COA-3.4: choose where COAs are kept at start-up: files via serve.ps1, else browser storage, else memory.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickCoaRepository } from '../../../src/adapters/persistence/pick-coa-repository.js';
import { createFakeFileApi } from '../../support/fake-file-api.js';
import { FakeStorage, blockedStorage } from '../../support/fake-storage.js';
import { aCoa } from '../../support/coa-fixtures.js';

const notFoundFetch = async () => new Response('Not found', { status: 404 });
const offlineFetch = async () => { throw new TypeError('Failed to fetch'); };

/** The picked repository must actually work: save, then read back. */
async function assertWorks(repository, settingsRepository) {
  assert.equal((await repository.save(aCoa(), { expectedRevision: 0 })).ok, true);
  assert.equal((await repository.get('coa-1')).value.name, 'COA 1');
  const settings = { revision: 1, frame: null, marking: { text: 'UNCLASSIFIED', color: '#007a33' } };
  assert.equal((await settingsRepository.save(settings, { expectedRevision: 0 })).ok, true, 'settings saved in the same place');
  assert.deepEqual((await settingsRepository.get()).value, settings);
}

describe('pickCoaRepository', () => {
  it('uses GeoJSON files when serve.ps1 answers /api/health with storage "files"', async () => {
    const api = createFakeFileApi();
    const picked = await pickCoaRepository({ fetch: api.fetch, getStorage: () => new FakeStorage() });
    assert.equal(picked.kind, 'files');
    assert.match(picked.label, /files/i);
    await assertWorks(picked.repository, picked.settingsRepository);
    assert.ok((await (await api.fetch('/api/coas')).json()).ids.includes('coa-1'), 'saved through the file API');
    assert.equal((await api.fetch('/api/settings')).status, 200, 'settings saved through the file API');
  });

  for (const [why, fetch] of [
    ['the health check is 404 (e.g. a Python server)', notFoundFetch],
    ['the server cannot be reached', offlineFetch],
    ['the health check answers something else', async () => new Response('{"storage":"other"}', { status: 200 })],
    ['the health check is not JSON', async () => new Response('<html>', { status: 200 })],
  ]) {
    it(`falls back to browser storage when ${why}`, async () => {
      const storage = new FakeStorage();
      const picked = await pickCoaRepository({ fetch, getStorage: () => storage });
      assert.equal(picked.kind, 'browser');
      assert.match(picked.label, /browser/i);
      await assertWorks(picked.repository, picked.settingsRepository);
      assert.ok(storage.getItem('coa-builder:settings'), 'settings saved in the given storage');
    });
  }

  for (const [why, getStorage] of [
    ['reading localStorage throws', () => { throw new Error('SecurityError'); }],
    ['localStorage is missing', () => undefined],
    ['storage refuses writes (e.g. private mode with no quota)', () => new FakeStorage({ quota: 0 })],
    ['every storage call throws', () => blockedStorage()],
  ]) {
    it(`falls back to memory, saying it is not saved, when ${why}`, async () => {
      const picked = await pickCoaRepository({ fetch: notFoundFetch, getStorage });
      assert.equal(picked.kind, 'memory');
      assert.match(picked.label, /not saved/i);
      await assertWorks(picked.repository, picked.settingsRepository);
    });
  }

  it('leaves no probe data behind in browser storage', async () => {
    const storage = new FakeStorage();
    await pickCoaRepository({ fetch: notFoundFetch, getStorage: () => storage });
    assert.equal(storage.length, 0);
  });
});
