// The settings document through every DocumentRepository adapter (D31), against the same contract (files: Node fake and, when available, serve.ps1).
import { describe, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describeSettingsRepositoryContract } from '../../contracts/settings-store.contract.js';
import { InMemoryDocumentRepository } from '../../../src/adapters/persistence/in-memory-document-repository.js';
import { LocalStorageDocumentRepository } from '../../../src/adapters/persistence/local-storage-document-repository.js';
import { HttpFileDocumentRepository } from '../../../src/adapters/persistence/http-file-document-repository.js';
import { settingsStore } from '../../../src/application/stores/coa-store.js';
import { FakeStorage } from '../../support/fake-storage.js';
import { createFakeFileApi } from '../../support/fake-file-api.js';
import { startFileServer } from '../../support/file-server.js';

describeSettingsRepositoryContract('settings in InMemoryDocumentRepository', () => settingsStore(new InMemoryDocumentRepository()));
describeSettingsRepositoryContract('settings in LocalStorageDocumentRepository', () => settingsStore(new LocalStorageDocumentRepository({ storage: new FakeStorage() })));
describeSettingsRepositoryContract('settings in HttpFileDocumentRepository (Node fake)', () => settingsStore(new HttpFileDocumentRepository({ fetch: createFakeFileApi().fetch })));

const PWSH = process.env.PWSH || 'pwsh';
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', 'exit 0']).status === 0;
describe('settings through HttpFileDocumentRepository against the real serve.ps1', { skip: hasPwsh ? false : 'PowerShell not found (set PWSH or put pwsh on PATH)' }, () => {
  let server;
  before(async () => { server = await startFileServer(); });
  after(async () => { await server?.stop(); });
  describeSettingsRepositoryContract('settings in HttpFileDocumentRepository (serve.ps1)', () => {
    for (const name of readdirSync(server.dataDir)) rmSync(join(server.dataDir, name), { force: true });
    return settingsStore(new HttpFileDocumentRepository({ fetch: server.fetch }));
  });
});

// D31 kept the places and formats of data saved before the storage port was unified.
import { it } from 'node:test';
import assert from 'node:assert/strict';

describe('settings saved before D31 still read, and are written the same way', () => {
  const saved = { revision: 4, frame: null, marking: { text: 'SECRET', color: '#c8102e' } };

  it('browser storage: the "coa-builder:settings" key, without an id', async () => {
    const storage = new FakeStorage();
    storage.setItem('coa-builder:settings', JSON.stringify(saved));
    const store = settingsStore(new LocalStorageDocumentRepository({ storage }));
    assert.deepEqual((await store.get()).value, saved);
    assert.equal((await store.save({ ...saved, revision: 5 }, { expectedRevision: 4 })).ok, true);
    assert.deepEqual(JSON.parse(storage.getItem('coa-builder:settings')), { ...saved, revision: 5 });
  });

  it('files: /api/settings (data/settings.json), without an id', async () => {
    const api = createFakeFileApi();
    await api.fetch('/api/settings', { method: 'PUT', headers: { 'If-None-Match': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(saved) });
    const store = settingsStore(new HttpFileDocumentRepository({ fetch: api.fetch }));
    assert.deepEqual((await store.get()).value, saved);
    assert.equal((await store.save({ ...saved, revision: 5 }, { expectedRevision: 4 })).ok, true);
    assert.deepEqual(await (await api.fetch('/api/settings')).json(), { ...saved, revision: 5 });
  });
});
