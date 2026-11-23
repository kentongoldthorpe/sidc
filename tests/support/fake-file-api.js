// A Node fake of serve.ps1's COA file API (tests/contracts/file-api.contract.js), as a fetch function.
// Its fidelity is checked by running the same contract against the real serve.ps1 when PowerShell exists.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BODY = 10 * 1024 * 1024;

const reply = (status, body, contentType = 'application/json; charset=utf-8', headers = {}) =>
  new Response(body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body)),
    { status, headers: { ...(body === undefined ? {} : { 'Content-Type': contentType }), ...headers } });

const parseRevision = (value) => {
  const n = Number(String(value).trim().replace(/^"(.*)"$/, '$1'));
  return Number.isInteger(n) ? n : NaN;
};

export function createFakeFileApi() {
  /** @type {Map<string, string>} id → raw file text */
  const files = new Map();
  let settingsText = null;
  const settingsRevision = () => { try { return JSON.parse(settingsText).revision; } catch { return null; } };
  const revisionOf = (id) => { try { return JSON.parse(files.get(id)).coa.revision; } catch { return null; } };

  async function fetch(url, init = {}) {
    const method = (init.method ?? 'GET').toUpperCase();
    const path = new URL(url, 'http://localhost').pathname;
    const header = (name) => new Headers(init.headers ?? {}).get(name);

    if (path === '/api/health') return reply(200, { storage: 'files', dataDir: '(memory)' });
    if (path === '/api/settings') {
      if (method === 'GET') {
        return settingsText === null ? reply(404, { error: 'not found' })
          : reply(200, settingsText, 'application/json; charset=utf-8', { ETag: `"${settingsRevision()}"` });
      }
      if (method !== 'PUT') return reply(405, { error: 'method not allowed' }, undefined, { Allow: 'GET, PUT' });
      const body = typeof init.body === 'string' ? init.body : '';
      let doc;
      try { doc = JSON.parse(body); } catch { return reply(400, { error: 'body is not JSON' }); }
      if (doc === null || typeof doc !== 'object' || Array.isArray(doc) || !Number.isInteger(doc.revision) || doc.revision < 1) return reply(400, { error: 'not a settings document' });
      if (header('If-None-Match') === '*') {
        if (settingsText !== null) return reply(409, { expectedRevision: 0, actualRevision: settingsRevision() });
        settingsText = body;
        return reply(201, { revision: doc.revision });
      }
      if (header('If-Match') === null) return reply(428, { error: 'If-Match or If-None-Match required' });
      if (settingsText === null) return reply(404, { error: 'not found' });
      const expected = parseRevision(header('If-Match'));
      if (expected !== settingsRevision()) return reply(409, { expectedRevision: expected, actualRevision: settingsRevision() });
      settingsText = body;
      return reply(200, { revision: doc.revision });
    }
    if (path === '/api/coas') {
      if (method !== 'GET') return reply(405, { error: 'method not allowed' }, undefined, { Allow: 'GET' });
      return reply(200, { ids: [...files.keys()] });
    }
    const match = path.match(/^\/api\/coas\/([^/]+)$/);
    if (!match) return reply(404, { error: 'not found' });
    const id = decodeURIComponent(match[1]);
    if (!ID.test(id)) return reply(400, { error: 'invalid id' });

    if (method === 'GET') {
      if (!files.has(id)) return reply(404, { error: 'not found' });
      const revision = revisionOf(id);
      return reply(200, files.get(id), 'application/geo+json; charset=utf-8', revision === null ? {} : { ETag: `"${revision}"` });
    }

    if (method === 'PUT') {
      const body = typeof init.body === 'string' ? init.body : '';
      if (body.length > MAX_BODY) return reply(413, { error: 'too large' });
      let doc;
      try { doc = JSON.parse(body); } catch { return reply(400, { error: 'body is not JSON' }); }
      if (doc?.type !== 'FeatureCollection' || doc?.coa?.id !== id || !Number.isInteger(doc?.coa?.revision) || doc.coa.revision < 1) {
        return reply(400, { error: 'body is not a COA document for this id' });
      }
      const ifNoneMatch = header('If-None-Match');
      const ifMatch = header('If-Match');
      if (ifNoneMatch === '*') {
        if (files.has(id)) return reply(409, { expectedRevision: 0, actualRevision: revisionOf(id) });
        files.set(id, body);
        return reply(201, { id, revision: doc.coa.revision });
      }
      if (ifMatch === null) return reply(428, { error: 'If-Match or If-None-Match required' });
      if (!files.has(id)) return reply(404, { error: 'not found' });
      const expected = parseRevision(ifMatch);
      if (expected !== revisionOf(id)) return reply(409, { expectedRevision: expected, actualRevision: revisionOf(id) });
      files.set(id, body);
      return reply(200, { id, revision: doc.coa.revision });
    }

    if (method === 'DELETE') {
      const ifMatch = header('If-Match');
      if (ifMatch === null) return reply(428, { error: 'If-Match required' });
      if (!files.has(id)) return reply(404, { error: 'not found' });
      const expected = parseRevision(ifMatch);
      if (expected !== revisionOf(id)) return reply(409, { expectedRevision: expected, actualRevision: revisionOf(id) });
      files.delete(id);
      return reply(204);
    }

    return reply(405, { error: 'method not allowed' }, undefined, { Allow: 'GET, PUT, DELETE' });
  }

  return { fetch, writeRawFile: async (id, text) => { files.set(id, text); } };
}
