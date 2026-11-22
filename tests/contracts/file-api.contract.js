// The COA file API served by serve.ps1 (and its Node fake). HTTP-level contract.
//
//   GET    /api/health          200 { storage: "files" }
//   GET    /api/coas            200 { ids: [<id of every stored COA file>…] }  (the server never parses documents
//                               for the list: the client fetches and validates each one, so a corrupt file
//                               cannot break the list)
//   GET    /api/coas/{id}       200 <COA GeoJSON> (ETag "<revision>") | 404
//   PUT    /api/coas/{id}       If-None-Match: *   → 201 create | 409 exists
//                               If-Match: "<rev>"  → 200 update | 409 stale | 404 missing
//                               neither → 428; bad id / body → 400; body > 10 MB → 413
//   DELETE /api/coas/{id}       If-Match: "<rev>"  → 204 | 409 | 404; none → 428
//   409 bodies: { expectedRevision, actualRevision }
//
// makeApi(): { fetch(path, init) → Promise<Response>, writeRawFile(id, text) } (shared across tests;
// every test uses its own ids).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coaToGeoJson } from '../../src/adapters/persistence/geojson-coa.js';
import { aCoa } from '../support/coa-fixtures.js';

let counter = 0;
const nextId = () => `coa-contract-${Date.now().toString(36)}-${++counter}`;
const docFor = (id, revision = 1, name = 'COA') => coaToGeoJson(aCoa({ id, revision, name }));
const json = (body) => ({ body: JSON.stringify(body), headers: { 'Content-Type': 'application/geo+json' } });

export function describeFileApiContract(name, makeApi) {
  describe(`COA file API contract: ${name}`, () => {
    let api;
    const call = (path, init = {}) => api.fetch(path, init);
    const create = (id, doc = docFor(id)) => call(`/api/coas/${id}`, { method: 'PUT', ...json(doc), headers: { ...json(doc).headers, 'If-None-Match': '*' } });
    const update = (id, revision, doc) => call(`/api/coas/${id}`, { method: 'PUT', ...json(doc), headers: { ...json(doc).headers, 'If-Match': `"${revision}"` } });

    it('reports file storage on /api/health', async () => {
      api = await makeApi();
      const r = await call('/api/health');
      assert.equal(r.status, 200);
      assert.equal((await r.json()).storage, 'files');
    });

    it('is 404 for an unknown COA', async () => {
      assert.equal((await call(`/api/coas/${nextId()}`)).status, 404);
    });

    it('creates with If-None-Match: * and returns exactly the stored document', async () => {
      const id = nextId();
      const doc = docFor(id, 1, 'Ünïcode – ✓ test');
      assert.equal((await create(id, doc)).status, 201);
      const r = await call(`/api/coas/${id}`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^application\/geo\+json/);
      assert.equal(r.headers.get('etag'), '"1"');
      assert.deepEqual(await r.json(), doc);
    });

    it('refuses to create an existing COA with 409', async () => {
      const id = nextId();
      await create(id);
      const r = await create(id, docFor(id, 1, 'Other'));
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), { expectedRevision: 0, actualRevision: 1 });
      assert.equal((await (await call(`/api/coas/${id}`)).json()).coa.name, 'COA');
    });

    it('updates with a matching If-Match (quoted or bare)', async () => {
      const id = nextId();
      await create(id);
      assert.equal((await update(id, 1, docFor(id, 2, 'Second'))).status, 200);
      const bare = await call(`/api/coas/${id}`, { method: 'PUT', ...json(docFor(id, 3, 'Third')), headers: { 'If-Match': '2' } });
      assert.equal(bare.status, 200);
      const got = await call(`/api/coas/${id}`);
      assert.equal(got.headers.get('etag'), '"3"');
      assert.equal((await got.json()).coa.name, 'Third');
    });

    it('refuses a stale If-Match with 409 and keeps the stored document', async () => {
      const id = nextId();
      await create(id);
      await update(id, 1, docFor(id, 2, 'Second'));
      const r = await update(id, 1, docFor(id, 2, 'Late'));
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), { expectedRevision: 1, actualRevision: 2 });
      assert.equal((await (await call(`/api/coas/${id}`)).json()).coa.name, 'Second');
    });

    it('is 404 when updating a COA that does not exist', async () => {
      const id = nextId();
      assert.equal((await update(id, 1, docFor(id, 2))).status, 404);
    });

    it('requires a precondition header on PUT and DELETE (428)', async () => {
      const id = nextId();
      assert.equal((await call(`/api/coas/${id}`, { method: 'PUT', ...json(docFor(id)) })).status, 428);
      await create(id);
      assert.equal((await call(`/api/coas/${id}`, { method: 'DELETE' })).status, 428);
    });

    it('deletes with a matching If-Match', async () => {
      const id = nextId();
      await create(id);
      assert.equal((await call(`/api/coas/${id}`, { method: 'DELETE', headers: { 'If-Match': '"1"' } })).status, 204);
      assert.equal((await call(`/api/coas/${id}`)).status, 404);
    });

    it('refuses a stale DELETE (409) and an unknown one (404)', async () => {
      const id = nextId();
      await create(id);
      const stale = await call(`/api/coas/${id}`, { method: 'DELETE', headers: { 'If-Match': '"5"' } });
      assert.equal(stale.status, 409);
      assert.deepEqual(await stale.json(), { expectedRevision: 5, actualRevision: 1 });
      assert.equal((await call(`/api/coas/${nextId()}`, { method: 'DELETE', headers: { 'If-Match': '"1"' } })).status, 404);
      assert.equal((await call(`/api/coas/${id}`)).status, 200);
    });

    it('lists the ids of stored documents and leaves out deleted ones', async () => {
      const [a, b] = [nextId(), nextId()];
      await create(a); await create(b);
      await call(`/api/coas/${b}`, { method: 'DELETE', headers: { 'If-Match': '"1"' } });
      const r = await call('/api/coas');
      assert.equal(r.status, 200);
      const { ids } = await r.json();
      assert.ok(ids.includes(a) && !ids.includes(b), JSON.stringify(ids));
    });

    it('still lists a file whose content is unreadable (the client decides what to do with it)', async () => {
      const bad = nextId();
      await api.writeRawFile(bad, '{ this is not json');
      assert.ok((await (await call('/api/coas')).json()).ids.includes(bad));
      assert.equal((await call(`/api/coas/${bad}`)).status, 200);
    });

    for (const [why, id] of [['a dot', 'a.b'], ['a space', 'a%20b'], ['dot-dot', '..'], ['too long', 'x'.repeat(129)]]) {
      it(`rejects an id with ${why} (400)`, async () => {
        const r = await call(`/api/coas/${id}`, { method: 'PUT', ...json(docFor('x')), headers: { 'If-None-Match': '*' } });
        assert.ok([400, 404].includes(r.status), `status ${r.status}`);
        assert.notEqual(r.status, 201);
      });
    }

    for (const [why, body] of [
      ['text that is not JSON', 'nope'],
      ['JSON that is not a FeatureCollection', JSON.stringify({ type: 'Feature' })],
      ['a coa.id different from the URL', JSON.stringify(docFor('someone-else'))],
      ['a missing revision', JSON.stringify({ ...docFor('x'), coa: { id: 'x' } })],
    ]) {
      it(`rejects a body with ${why} (400) and stores nothing`, async () => {
        const id = nextId();
        const fixed = body.replace(/"x"/g, `"${id}"`);
        const r = await call(`/api/coas/${id}`, { method: 'PUT', body: fixed, headers: { 'If-None-Match': '*' } });
        assert.equal(r.status, 400);
        assert.equal((await call(`/api/coas/${id}`)).status, 404);
      });
    }

    it('refuses other methods on /api/coas with 405', async () => {
      assert.equal((await call('/api/coas', { method: 'POST', body: '{}' })).status, 405);
    });

    it('is 404 for an unknown API path', async () => {
      assert.equal((await call('/api/nothing-here')).status, 404);
    });
  });
}
