// CoaRepository adapter: COAs as GeoJSON files, stored by serve.ps1's file API (see serve.ps1).
// Optimistic concurrency is enforced by the server through If-Match / If-None-Match.
import { coaToGeoJson, geoJsonToCoa } from './geojson-coa.js';
import { toSummary, bySummaryOrder } from './coa-summaries.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const unreachable = (cause) => err(ErrorCode.STORAGE_UNAVAILABLE, 'The COA file server could not be reached', { cause: String(cause?.message ?? cause) });
const serverError = (status) => err(ErrorCode.STORAGE_UNAVAILABLE, `The COA file server failed (HTTP ${status})`, { status });
const notFound = (coaId) => err(ErrorCode.NOT_FOUND, `COA ${coaId} not found`, { coaId });

/** @implements {import('../../application/ports/coa-repository.js').CoaRepository} */
export class HttpFileCoaRepository {
  #fetch;
  #base;

  /** @param {{ fetch: typeof fetch, baseUrl?: string }} options */
  constructor({ fetch, baseUrl = '' } = {}) {
    if (typeof fetch !== 'function') throw new TypeError('HttpFileCoaRepository: fetch is required');
    this.#fetch = (...args) => fetch(...args); // a plain call: browsers throw "Illegal invocation" if fetch gets another `this`
    this.#base = baseUrl;
  }

  /** @returns {Promise<{ response?: Response, failure?: object }>} */
  async #request(path, init) {
    try {
      return { response: await this.#fetch(`${this.#base}${path}`, init) };
    } catch (cause) {
      return { failure: unreachable(cause) };
    }
  }

  #url = (coaId) => `/api/coas/${encodeURIComponent(coaId)}`;

  /** A conflict / missing / failure Result for a non-2xx write response. */
  async #writeFailure(response, coaId) {
    if (response.status === 404) return notFound(coaId);
    if (response.status === 409) {
      const { expectedRevision, actualRevision } = await response.json();
      return err(ErrorCode.CONFLICT, `COA ${coaId} was changed elsewhere`, { coaId, expectedRevision, actualRevision });
    }
    if (response.status === 413) return err(ErrorCode.STORAGE_QUOTA_EXCEEDED, 'The COA is too large to store', { coaId });
    return serverError(response.status);
  }

  async #read(coaId) {
    const { response, failure } = await this.#request(this.#url(coaId));
    if (failure) return failure;
    if (response.status === 404) return notFound(coaId);
    if (!response.ok) return serverError(response.status);
    let doc;
    try { doc = JSON.parse(await response.text()); } catch {
      return err(ErrorCode.STORAGE_UNAVAILABLE, `The stored file for COA ${coaId} is not valid JSON`, { coaId, problems: [{ field: '(root)', reason: 'not valid JSON' }] });
    }
    const parsed = geoJsonToCoa(doc);
    return parsed.ok ? parsed : err(ErrorCode.STORAGE_UNAVAILABLE, `The stored file for COA ${coaId} is not a valid COA`, {
      coaId, problems: parsed.error.details.problems ?? [],
    });
  }

  async list() {
    const { response, failure } = await this.#request('/api/coas');
    if (failure) return failure;
    if (!response.ok) return serverError(response.status);
    const { ids } = await response.json();
    const results = await Promise.all(ids.map((id) => this.#read(id)));
    // Unreadable files are skipped so one bad file cannot hide the others.
    return ok(results.filter((r) => r.ok).map((r) => toSummary(r.value)).sort(bySummaryOrder));
  }

  get(coaId) { return this.#read(coaId); }

  async save(coa, { expectedRevision }) {
    const precondition = expectedRevision === 0 ? { 'If-None-Match': '*' } : { 'If-Match': `"${expectedRevision}"` };
    const { response, failure } = await this.#request(this.#url(coa.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/geo+json', ...precondition },
      body: JSON.stringify(coaToGeoJson(coa)),
    });
    if (failure) return failure;
    return response.ok ? ok() : this.#writeFailure(response, coa.id);
  }

  async remove(coaId, { expectedRevision }) {
    const { response, failure } = await this.#request(this.#url(coaId), {
      method: 'DELETE', headers: { 'If-Match': `"${expectedRevision}"` },
    });
    if (failure) return failure;
    return response.ok ? ok() : this.#writeFailure(response, coaId);
  }
}
