// The DocumentRepository contract against every adapter (and the real serve.ps1 when PowerShell exists).
import { describe, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { describeDocumentRepositoryContract } from '../../contracts/document-repository.contract.js';
import { InMemoryDocumentRepository } from '../../../src/adapters/persistence/in-memory-document-repository.js';
import { LocalStorageDocumentRepository } from '../../../src/adapters/persistence/local-storage-document-repository.js';
import { HttpFileDocumentRepository } from '../../../src/adapters/persistence/http-file-document-repository.js';
import { createFakeFileApi } from '../../support/fake-file-api.js';
import { FakeStorage } from '../../support/fake-storage.js';
import { startFileServer } from '../../support/file-server.js';

describeDocumentRepositoryContract('InMemoryDocumentRepository', () => new InMemoryDocumentRepository());
describeDocumentRepositoryContract('LocalStorageDocumentRepository', () => new LocalStorageDocumentRepository({ storage: new FakeStorage() }));
describeDocumentRepositoryContract('HttpFileDocumentRepository (Node fake)', () => new HttpFileDocumentRepository({ fetch: createFakeFileApi().fetch }));

const hasPwsh = spawnSync(process.env.PWSH || 'pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;
describe('HttpFileDocumentRepository against the real serve.ps1', { skip: hasPwsh ? false : 'PowerShell not found (set PWSH or put pwsh on PATH)' }, () => {
  let server;
  before(async () => { server = await startFileServer(); });
  after(async () => { await server?.stop(); });
  describeDocumentRepositoryContract('HttpFileDocumentRepository (serve.ps1)', () => {
    rmSync(`${server.dataDir}/systems`, { recursive: true, force: true });
    rmSync(`${server.dataDir}/threat-models`, { recursive: true, force: true });
    return new HttpFileDocumentRepository({ fetch: server.fetch });
  });
});
