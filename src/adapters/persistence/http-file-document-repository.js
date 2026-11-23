// DocumentRepository over serve.ps1's file API. Optimistic concurrency is enforced by the server
// through If-Match / If-None-Match. Most collections use /api/docs/<collection>[/<id>]
// (data/<collection>/<id>.json); COAs use /api/coas (data/<id>.geojson) and the settings
// /api/settings (data/settings.json), as before the port was unified (see stored-collections.js).
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { docNotFound, docConflict } from './in-memory-document-repository.js';
import { codecFor, decodeText, byId } from './stored-collections.js';

const unreachable = (cause) => err(ErrorCode.STORAGE_UNAVAILABLE, 'The COA file server could not be reached', { cause: String(cause?.message ?? cause) });
const serverError = (status) => err(ErrorCode.STORAGE_UNAVAILABLE, `The COA file server failed (HTTP ${status})`, { status });
const enc = encodeURIComponent;

/** @implements {import('../../application/ports/document-repository.js').DocumentRepository} */
export class HttpFileDocumentRepository {
  #fetch;
  #base;

  /** @param {{ fetch: typeof fetch, baseUrl?: string }} options */
  constructor({ fetch, baseUrl = '' } = {}) {
    if (typeof fetch !== 'function') throw new TypeError('HttpFileDocumentRepository: fetch is required');
    this.#fetch = (...args) => fetch(...args); // a plain call: browsers throw "Illegal invocation" otherwise
    this.#base = baseUrl;
  }

  #url(collection, id) {
    if (collection === 'settings') return `${this.#base}/api/settings`;
    const root = collection === 'coas' ? '/api/coas' : `/api/docs/${enc(collection)}`;
    return `${this.#base}${root}${id === undefined ? '' : `/${enc(id)}`}`;
  }

  async #request(url, init) {
    try { return { response: await this.#fetch(url, init) }; } catch (cause) { return { failure: unreachable(cause) }; }
  }

  async list(collection) {
    let ids = ['settings'];
    if (collection !== 'settings') {
      const { response, failure } = await this.#request(this.#url(collection));
      if (failure) return failure;
      if (!response.ok) return serverError(response.status);
      ({ ids } = await response.json());
    }
    const reads = await Promise.all(ids.map((id) => this.get(collection, id)));
    const failed = reads.find((r) => !r.ok && r.error.code !== ErrorCode.NOT_FOUND && !r.error.details?.unreadable);
    if (failed) return failed;
    // A file deleted meanwhile is simply gone; an unreadable one is skipped so it cannot hide the others.
    return ok(reads.filter((r) => r.ok).map((r) => r.value).sort(byId));
  }

  async get(collection, id) {
    const { response, failure } = await this.#request(this.#url(collection, id));
    if (failure) return failure;
    if (response.status === 404) return docNotFound(collection, id);
    if (!response.ok) return serverError(response.status);
    return decodeText(collection, id, await response.text());
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
    const codec = codecFor(collection);
    const precondition = expectedRevision === 0 ? { 'If-None-Match': '*' } : { 'If-Match': `"${expectedRevision}"` };
    return this.#write(collection, doc.id, { method: 'PUT', headers: { 'Content-Type': codec.contentType, ...precondition }, body: JSON.stringify(codec.encode(doc)) }, expectedRevision);
  }

  async remove(collection, id, { expectedRevision }) {
    return this.#write(collection, id, { method: 'DELETE', headers: { 'If-Match': `"${expectedRevision}"` } }, expectedRevision);
  }
}
