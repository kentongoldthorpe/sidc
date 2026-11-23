// COA-3.3 (D31): COAs kept by the DocumentRepository file adapter that stores COAs as GeoJSON files through serve.ps1's file API.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { HttpFileDocumentRepository } from '../../../src/adapters/persistence/http-file-document-repository.js';
import { coaStore } from '../../../src/application/stores/coa-store.js';

/** COAs through the file adapter, seen as the core sees them. */
const HttpFileCoas = (options) => coaStore(new HttpFileDocumentRepository(options));
import { coaToGeoJson } from '../../../src/adapters/persistence/geojson-coa.js';
import { describeCoaRepositoryContract } from '../../contracts/coa-store.contract.js';
import { createFakeFileApi } from '../../support/fake-file-api.js';
import { aCoa, aSymbol } from '../../support/coa-fixtures.js';
import { startFileServer } from '../../support/file-server.js';

describeCoaRepositoryContract('HttpFileCoas (Node fake of the file API)',
  () => HttpFileCoas({ fetch: createFakeFileApi().fetch }));

const PWSH = process.env.PWSH || 'pwsh';
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe('HttpFileCoas against the real serve.ps1', { skip: hasPwsh ? false : 'PowerShell not found (set PWSH or put pwsh on PATH)' }, () => {
  let server;
  before(async () => { server = await startFileServer(); });
  after(async () => { await server?.stop(); });
  describeCoaRepositoryContract('HttpFileCoas (serve.ps1)', () => {
    for (const name of readdirSync(server.dataDir)) rmSync(join(server.dataDir, name), { force: true }); // each contract test starts empty
    return HttpFileCoas({ fetch: server.fetch });
  });
});

const okValue = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
const errorOf = (r, code) => { assert.equal(r.ok, false, 'expected a failure'); assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };

describe('HttpFileCoas specifics', () => {
  it('stores each COA as its GeoJSON document', async () => {
    const api = createFakeFileApi();
    const coa = aCoa({ symbols: [aSymbol()] });
    okValue(await HttpFileCoas({ fetch: api.fetch }).save(coa, { expectedRevision: 0 }));
    assert.deepEqual(await (await api.fetch('/api/coas/coa-1')).json(), coaToGeoJson(coa));
  });

  it('lists the readable COAs and skips unreadable files instead of failing', async () => {
    const api = createFakeFileApi();
    const repo = HttpFileCoas({ fetch: api.fetch });
    await repo.save(aCoa({ id: 'good' }), { expectedRevision: 0 });
    await api.writeRawFile('broken', '{ not json');
    await api.writeRawFile('invalid', JSON.stringify({ type: 'FeatureCollection', coa: { id: 'invalid' }, features: [] }));
    assert.deepEqual(okValue(await repo.list()).map((s) => s.id), ['good']);
  });

  it('reports an unreadable stored COA on get as STORAGE_UNAVAILABLE with the problems', async () => {
    const api = createFakeFileApi();
    await api.writeRawFile('broken', '{ not json');
    await api.writeRawFile('invalid', JSON.stringify({ type: 'FeatureCollection', features: [] }));
    const repo = HttpFileCoas({ fetch: api.fetch });
    assert.equal(errorOf(await repo.get('broken'), 'STORAGE_UNAVAILABLE').details.coaId, 'broken');
    assert.ok(errorOf(await repo.get('invalid'), 'STORAGE_UNAVAILABLE').details.problems.length > 0);
  });

  it('reports STORAGE_UNAVAILABLE when the server cannot be reached', async () => {
    const repo = HttpFileCoas({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    for (const result of [await repo.list(), await repo.get('x'), await repo.save(aCoa(), { expectedRevision: 0 }), await repo.remove('x', { expectedRevision: 1 })]) {
      assert.match(errorOf(result, 'STORAGE_UNAVAILABLE').message, /server/i);
    }
  });

  it('reports STORAGE_UNAVAILABLE for a server error', async () => {
    const repo = HttpFileCoas({ fetch: async () => new Response('boom', { status: 500 }) });
    errorOf(await repo.save(aCoa(), { expectedRevision: 0 }), 'STORAGE_UNAVAILABLE');
    errorOf(await repo.list(), 'STORAGE_UNAVAILABLE');
  });

  it('reports STORAGE_QUOTA_EXCEEDED when the document is too large (413)', async () => {
    const repo = HttpFileCoas({ fetch: async () => new Response('{}', { status: 413 }) });
    errorOf(await repo.save(aCoa(), { expectedRevision: 0 }), 'STORAGE_QUOTA_EXCEEDED');
  });

  it('prefixes requests with baseUrl and encodes ids', async () => {
    const urls = [];
    const repo = HttpFileCoas({ baseUrl: 'http://example.test', fetch: async (url) => { urls.push(url); return new Response('{}', { status: 404 }); } });
    await repo.get('a b');
    assert.deepEqual(urls, ['http://example.test/api/coas/a%20b']);
  });

  it('requires fetch', () => {
    assert.throws(() => HttpFileCoas({}), TypeError);
  });
});
