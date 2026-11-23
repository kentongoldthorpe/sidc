// The DocumentRepository contract against every adapter (and the real serve.ps1 when PowerShell exists).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../../../src/application/create-application.js';
import { FixedClock } from '../../support/fixed-clock.js';
import { SequenceIdGenerator } from '../../support/sequence-id-generator.js';
import { StubRenderer } from '../../support/stub-renderer.js';
import { createEnvelope } from '../../../src/shared/envelope.js';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { describeDocumentRepositoryContract } from '../../contracts/document-repository.contract.js';
import { describeCoaRepositoryContract } from '../../contracts/coa-store.contract.js';
import { coaStore } from '../../../src/application/stores/coa-store.js';
import { InMemoryDocumentRepository } from '../../../src/adapters/persistence/in-memory-document-repository.js';
import { LocalStorageDocumentRepository } from '../../../src/adapters/persistence/local-storage-document-repository.js';
import { HttpFileDocumentRepository } from '../../../src/adapters/persistence/http-file-document-repository.js';
import { createFakeFileApi } from '../../support/fake-file-api.js';
import { FakeStorage } from '../../support/fake-storage.js';
import { startFileServer } from '../../support/file-server.js';

describeDocumentRepositoryContract('InMemoryDocumentRepository', () => new InMemoryDocumentRepository());
describeCoaRepositoryContract('COAs in InMemoryDocumentRepository', () => coaStore(new InMemoryDocumentRepository()));
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

/** A project's documents go to collections serve.ps1 already accepts (D27; serve.ps1 is frozen). */
async function projectRoundTrip(documentRepository) {
  const clock = new FixedClock('2026-11-23T10:00:00.000Z');
  const ids = new SequenceIdGenerator();
  let n = 0;
  const appIn = (projectId) => createApplication({ clock, ids, symbolRenderer: new StubRenderer(), documentRepository, projectId });
  const send = async (app, kind, type, payload) => (await app[kind === 'command' ? 'dispatch' : 'query'](createEnvelope({ kind, type, v: 1, payload, meta: { source: 'test' } }, { id: `e-${++n}`, now: clock.now() }))).payload;
  const project = (await send(appIn('default'), 'command', 'project.create', { name: 'IRON' })).value;
  const inside = appIn(project.id);
  const coa = await send(inside, 'command', 'coa.create', { name: 'In IRON' });
  assert.equal(coa.ok, true, JSON.stringify(coa.error));
  assert.equal((await send(inside, 'command', 'settings.update', { expectedRevision: 0, marking: { text: 'SECRET', color: '#c8102e' } })).ok, true);
  assert.deepEqual((await send(inside, 'query', 'coa.list', {})).value.map((c) => c.name), ['In IRON']);
  assert.equal((await send(inside, 'query', 'settings.get', {})).value.marking.text, 'SECRET');
  assert.deepEqual((await send(appIn('default'), 'query', 'project.list', {})).value.map((p) => p.name), ['Default', 'IRON']);
}

it('a project round trip through the Node fake of the file API', () => projectRoundTrip(new HttpFileDocumentRepository({ fetch: createFakeFileApi().fetch })));
it('a project round trip through browser storage', () => projectRoundTrip(new LocalStorageDocumentRepository({ storage: new FakeStorage() })));
describe('projects against the real (frozen) serve.ps1', { skip: hasPwsh ? false : 'PowerShell not found (set PWSH or put pwsh on PATH)' }, () => {
  let server;
  before(async () => { server = await startFileServer(); });
  after(async () => { await server?.stop(); });
  it('stores a project and its documents with no change to serve.ps1', () => projectRoundTrip(new HttpFileDocumentRepository({ fetch: server.fetch })));
});
