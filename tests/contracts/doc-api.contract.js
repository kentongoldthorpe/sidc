// Document collections in the file API (serve.ps1 and its Node fake): plain JSON documents with an
// id and a revision, one file per document (data/<collection>/<id>.json). Used for the systems list and
// threat models (Epic 3). Same preconditions as COAs:
//   GET    /api/docs/{collection}        200 { ids: [...] } ([] before the first document)
//   GET    /api/docs/{collection}/{id}   200 <document> (ETag "<revision>") | 404
//   PUT    /api/docs/{collection}/{id}   If-None-Match: * → 201 | 409;  If-Match: "<rev>" → 200 | 409 | 404;  neither → 428
//                                         body: a JSON object whose "id" is {id} and "revision" an integer ≥ 1, else 400
//   DELETE /api/docs/{collection}/{id}   If-Match: "<rev>" → 204 | 409 | 404;  none → 428
//   collection: ^[a-z][a-z0-9-]{0,39}$ and id: ^[A-Za-z0-9_-]{1,128}$, else 400
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

let counter = 0;
const nextId = () => `doc-${Date.now().toString(36)}-${++counter}`;

export function describeDocApiContract(name, makeApi) {
  describe(`document file API contract: ${name}`, () => {
    let api;
    const call = (path, init = {}) => api.fetch(path, init);
    const body = (doc) => ({ body: JSON.stringify(doc), headers: { 'Content-Type': 'application/json' } });
    const put = (collection, id, doc, precondition) => call(`/api/docs/${collection}/${id}`, { method: 'PUT', ...body(doc), headers: { ...body(doc).headers, ...precondition } });
    const create = (collection, id, doc = { id, revision: 1, name: 'A' }) => put(collection, id, doc, { 'If-None-Match': '*' });

    it('lists no ids for a collection that has nothing yet', async () => {
      api = await makeApi();
      const r = await call('/api/docs/empty-collection');
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ids: [] });
    });

    it('creates with If-None-Match: * and returns exactly the stored document with its revision as ETag', async () => {
      const id = nextId();
      const doc = { id, revision: 1, name: 'Ünïcode ✓', ranges: [1, 2.5] };
      assert.equal((await create('systems', id, doc)).status, 201);
      const r = await call(`/api/docs/systems/${id}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('etag'), '"1"');
      assert.deepEqual(await r.json(), doc);
    });

    it('lists the ids of its own collection only', async () => {
      const a = nextId(); const b = nextId();
      await create('systems', a);
      await create('threat-models', b);
      const systems = (await (await call('/api/docs/systems')).json()).ids;
      const models = (await (await call('/api/docs/threat-models')).json()).ids;
      assert.ok(systems.includes(a) && !systems.includes(b));
      assert.ok(models.includes(b) && !models.includes(a));
      assert.ok(!(await (await call('/api/coas')).json()).ids.includes(a), 'documents are not COAs');
    });

    it('refuses to create a document that exists (409 with its revision)', async () => {
      const id = nextId();
      await create('systems', id);
      const r = await create('systems', id);
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), { expectedRevision: 0, actualRevision: 1 });
    });

    it('updates with a matching If-Match, refuses a stale one, and needs a precondition', async () => {
      const id = nextId();
      await create('systems', id);
      assert.equal((await put('systems', id, { id, revision: 2, name: 'B' }, { 'If-Match': '"1"' })).status, 200);
      const stale = await put('systems', id, { id, revision: 2, name: 'C' }, { 'If-Match': '"1"' });
      assert.equal(stale.status, 409);
      assert.deepEqual(await stale.json(), { expectedRevision: 1, actualRevision: 2 });
      assert.equal((await put('systems', id, { id, revision: 3 }, {})).status, 428);
      assert.equal((await (await call(`/api/docs/systems/${id}`)).json()).name, 'B');
    });

    it('is 404 for a missing document (read, update, delete)', async () => {
      const id = nextId();
      assert.equal((await call(`/api/docs/systems/${id}`)).status, 404);
      assert.equal((await put('systems', id, { id, revision: 2 }, { 'If-Match': '"1"' })).status, 404);
      assert.equal((await call(`/api/docs/systems/${id}`, { method: 'DELETE', headers: { 'If-Match': '"1"' } })).status, 404);
    });

    it('refuses a body that is not a document for this id (400)', async () => {
      const id = nextId();
      for (const doc of [{ id: 'other', revision: 1 }, { id, revision: 0 }, { id }, [1, 2], 'text']) {
        assert.equal((await put('systems', id, doc, { 'If-None-Match': '*' })).status, 400, JSON.stringify(doc));
      }
      const notJson = await call(`/api/docs/systems/${id}`, { method: 'PUT', body: '{nope', headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' } });
      assert.equal(notJson.status, 400);
    });

    it('refuses bad collection names and ids (400), so nothing escapes the data folder', async () => {
      for (const path of ['/api/docs/Systems/x', '/api/docs/sys_tems/x', '/api/docs/..%2F..%2Fetc/x', '/api/docs/systems/a.b', '/api/docs/systems/..']) {
        const r = await call(path);
        assert.ok([400, 404].includes(r.status), `${path} → ${r.status}`);
        assert.notEqual(r.status, 200);
      }
      assert.equal((await call('/api/docs/Bad')).status, 400);
    });

    it('deletes with a matching If-Match, refusing stale or missing preconditions', async () => {
      const id = nextId();
      await create('systems', id);
      assert.equal((await call(`/api/docs/systems/${id}`, { method: 'DELETE' })).status, 428);
      const stale = await call(`/api/docs/systems/${id}`, { method: 'DELETE', headers: { 'If-Match': '"7"' } });
      assert.equal(stale.status, 409);
      assert.equal((await call(`/api/docs/systems/${id}`, { method: 'DELETE', headers: { 'If-Match': '"1"' } })).status, 204);
      assert.equal((await call(`/api/docs/systems/${id}`)).status, 404);
    });
  });
}
