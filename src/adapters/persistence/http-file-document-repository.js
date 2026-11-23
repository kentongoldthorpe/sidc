// DocumentRepository over serve.ps1's file API: /api/docs/<collection>[/<id>] (data/<collection>/<id>.json).
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { docNotFound, docConflict } from './in-memory-document-repository.js';

const unreachable = (cause) => err(ErrorCode.STORAGE_UNAVAILABLE, 'The COA file server could not be reached', { cause: String(cause?.message ?? cause) });
const serverError = (status) => err(ErrorCode.STORAGE_UNAVAILABLE, `The COA file server failed (HTTP ${status})`, { status });

/** @implements {import('../../application/ports/document-repository.js').DocumentRepository} */
export class HttpFileDocumentRepository {
  #fetch;
  #base;

  constructor({ fetch, baseUrl = '' } = {}) {
    if (typeof fetch !== 'function') throw new TypeError('HttpFileDocumentRepository: fetch is required');
    this.#fetch = (...args) => fetch(...args); // a plain call: browsers throw "Illegal invocation" otherwise
    this.#base = baseUrl;
  }

  #url = (collection, id) => `${this.#base}/api/docs/${encodeURIComponent(collection)}${id === undefined ? '' : `/${encodeURIComponent(id)}`}`;

  async #request(url, init) {
    try { return { response: await this.#fetch(url, init) }; } catch (cause) { return { failure: unreachable(cause) }; }
  }

  async list(collection) {
    const { response, failure } = await this.#request(this.#url(collection));
    if (failure) return failure;
    if (!response.ok) return serverError(response.status);
    const { ids } = await response.json();
    const docs = [];
    for (const id of ids) {
      const read = await this.get(collection, id);
      if (read.ok) docs.push(read.value);
      else if (read.error.code !== 'NOT_FOUND') return read; // a file deleted meanwhile is simply gone
    }
    return ok(docs.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)));
  }

  async get(collection, id) {
    const { response, failure } = await this.#request(this.#url(collection, id));
    if (failure) return failure;
    if (response.status === 404) return docNotFound(collection, id);
    if (!response.ok) return serverError(response.status);
    try { return ok(JSON.parse(await response.text())); } catch {
      return err(ErrorCode.STORAGE_UNAVAILABLE, `The stored ${collection}/${id} is not valid JSON`, { collection, id });
    }
  }

  async #write(collection, id, init, expectedRevision) {
    const { response, failure } = await this.#request(this.#url(collection, id), init);
    if (failure) return failure;
    if (response.ok) return ok();
    if (response.status === 404) return docNotFound(collection, id);
    if (response.status === 409) {
      const { actualRevision } = await response.json();
      return docConflict(collection, id, expectedRevision, actualRevision ?? null);
    }
    if (response.status === 413) return err(ErrorCode.STORAGE_QUOTA_EXCEEDED, 'The document is too large to store', { collection, id });
    return serverError(response.status);
  }

  async save(collection, doc, { expectedRevision }) {
    const precondition = expectedRevision === 0 ? { 'If-None-Match': '*' } : { 'If-Match': `"${expectedRevision}"` };
    return this.#write(collection, doc.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...precondition }, body: JSON.stringify(doc) }, expectedRevision);
  }

  async remove(collection, id, { expectedRevision }) {
    return this.#write(collection, id, { method: 'DELETE', headers: { 'If-Match': `"${expectedRevision}"` } }, expectedRevision);
  }
}
