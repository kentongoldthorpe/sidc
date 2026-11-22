// COA-3.3: the CoaRepository adapter that stores COAs as GeoJSON files through serve.ps1's file API.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { HttpFileCoaRepository } from '../../../src/adapters/persistence/http-file-coa-repository.js';
import { coaToGeoJson } from '../../../src/adapters/persistence/geojson-coa.js';
import { describeCoaRepositoryContract } from '../../contracts/coa-repository.contract.js';
import { createFakeFileApi } from '../../support/fake-file-api.js';
import { aCoa, aSymbol } from '../../support/coa-fixtures.js';
import { startFileServer } from './file-api.test.js';

describeCoaRepositoryContract('HttpFileCoaRepository (Node fake of the file API)',
  () => new HttpFileCoaRepository({ fetch: createFakeFileApi().fetch }));

const PWSH = process.env.PWSH || 'pwsh';
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe('HttpFileCoaRepository against the real serve.ps1', { skip: hasPwsh ? false : 'PowerShell not found (set PWSH or put pwsh on PATH)' }, () => {
  let server;
  before(async () => { server = await startFileServer(); });
  after(async () => { await server?.stop(); });
  describeCoaRepositoryContract('HttpFileCoaRepository (serve.ps1)', () => {
    for (const name of readdirSync(server.dataDir)) rmSync(join(server.dataDir, name), { force: true }); // each contract test starts empty
    return new HttpFileCoaRepository({ fetch: server.fetch });
  });
});

const okValue = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
const errorOf = (r, code) => { assert.equal(r.ok, false, 'expected a failure'); assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };

describe('HttpFileCoaRepository specifics', () => {
  it('stores each COA as its GeoJSON document', async () => {
    const api = createFakeFileApi();
    const coa = aCoa({ symbols: [aSymbol()] });
    okValue(await new HttpFileCoaRepository({ fetch: api.fetch }).save(coa, { expectedRevision: 0 }));
    assert.deepEqual(await (await api.fetch('/api/coas/coa-1')).json(), coaToGeoJson(coa));
  });

  it('lists the readable COAs and skips unreadable files instead of failing', async () => {
    const api = createFakeFileApi();
    const repo = new HttpFileCoaRepository({ fetch: api.fetch });
    await repo.save(aCoa({ id: 'good' }), { expectedRevision: 0 });
    await api.writeRawFile('broken', '{ not json');
    await api.writeRawFile('invalid', JSON.stringify({ type: 'FeatureCollection', coa: { id: 'invalid' }, features: [] }));
    assert.deepEqual(okValue(await repo.list()).map((s) => s.id), ['good']);
  });

  it('reports an unreadable stored COA on get as STORAGE_UNAVAILABLE with the problems', async () => {
    const api = createFakeFileApi();
    await api.writeRawFile('broken', '{ not json');
    await api.writeRawFile('invalid', JSON.stringify({ type: 'FeatureCollection', features: [] }));
    const repo = new HttpFileCoaRepository({ fetch: api.fetch });
    assert.equal(errorOf(await repo.get('broken'), 'STORAGE_UNAVAILABLE').details.coaId, 'broken');
    assert.ok(errorOf(await repo.get('invalid'), 'STORAGE_UNAVAILABLE').details.problems.length > 0);
  });

  it('reports STORAGE_UNAVAILABLE when the server cannot be reached', async () => {
    const repo = new HttpFileCoaRepository({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    for (const result of [await repo.list(), await repo.get('x'), await repo.save(aCoa(), { expectedRevision: 0 }), await repo.remove('x', { expectedRevision: 1 })]) {
      assert.match(errorOf(result, 'STORAGE_UNAVAILABLE').message, /server/i);
    }
  });

  it('reports STORAGE_UNAVAILABLE for a server error', async () => {
    const repo = new HttpFileCoaRepository({ fetch: async () => new Response('boom', { status: 500 }) });
    errorOf(await repo.save(aCoa(), { expectedRevision: 0 }), 'STORAGE_UNAVAILABLE');
    errorOf(await repo.list(), 'STORAGE_UNAVAILABLE');
  });

  it('reports STORAGE_QUOTA_EXCEEDED when the document is too large (413)', async () => {
    const repo = new HttpFileCoaRepository({ fetch: async () => new Response('{}', { status: 413 }) });
    errorOf(await repo.save(aCoa(), { expectedRevision: 0 }), 'STORAGE_QUOTA_EXCEEDED');
  });

  it('prefixes requests with baseUrl and encodes ids', async () => {
    const urls = [];
    const repo = new HttpFileCoaRepository({ baseUrl: 'http://example.test', fetch: async (url) => { urls.push(url); return new Response('{}', { status: 404 }); } });
    await repo.get('a b');
    assert.deepEqual(urls, ['http://example.test/api/coas/a%20b']);
  });

  it('requires fetch', () => {
    assert.throws(() => new HttpFileCoaRepository({}), TypeError);
  });
});
