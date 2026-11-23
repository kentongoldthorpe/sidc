// Every SettingsRepository adapter against the same contract (files: Node fake and, when available, serve.ps1).
import { describe, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describeSettingsRepositoryContract } from '../../contracts/settings-repository.contract.js';
import { InMemorySettingsRepository } from '../../../src/adapters/persistence/in-memory-settings-repository.js';
import { LocalStorageSettingsRepository } from '../../../src/adapters/persistence/local-storage-settings-repository.js';
import { HttpFileSettingsRepository } from '../../../src/adapters/persistence/http-file-settings-repository.js';
import { FakeStorage } from '../../support/fake-storage.js';
import { createFakeFileApi } from '../../support/fake-file-api.js';
import { startFileServer } from './file-api.test.js';

describeSettingsRepositoryContract('InMemorySettingsRepository', () => new InMemorySettingsRepository());
describeSettingsRepositoryContract('LocalStorageSettingsRepository', () => new LocalStorageSettingsRepository({ storage: new FakeStorage() }));
describeSettingsRepositoryContract('HttpFileSettingsRepository (Node fake)', () => new HttpFileSettingsRepository({ fetch: createFakeFileApi().fetch }));

const PWSH = process.env.PWSH || 'pwsh';
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', 'exit 0']).status === 0;
describe('HttpFileSettingsRepository against the real serve.ps1', { skip: hasPwsh ? false : 'PowerShell not found (set PWSH or put pwsh on PATH)' }, () => {
  let server;
  before(async () => { server = await startFileServer(); });
  after(async () => { await server?.stop(); });
  describeSettingsRepositoryContract('HttpFileSettingsRepository (serve.ps1)', () => {
    for (const name of readdirSync(server.dataDir)) rmSync(join(server.dataDir, name), { force: true });
    return new HttpFileSettingsRepository({ fetch: server.fetch });
  });
});
