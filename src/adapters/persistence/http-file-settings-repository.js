// SettingsRepository over serve.ps1's file API: GET / PUT /api/settings (data/settings.json).
import { cloneJson } from '../../shared/freeze.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

/** @implements {import('../../application/ports/settings-repository.js').SettingsRepository} */
export class HttpFileSettingsRepository {
  #fetch;
  #base;

  constructor({ fetch, baseUrl = '' } = {}) {
    if (typeof fetch !== 'function') throw new TypeError('HttpFileSettingsRepository: fetch is required');
    this.#fetch = (...args) => fetch(...args); // a plain call: browsers throw "Illegal invocation" otherwise
    this.#base = baseUrl;
  }

  async #request(init) {
    try { return { response: await this.#fetch(`${this.#base}/api/settings`, init) }; } catch (cause) {
      return { failure: err(ErrorCode.STORAGE_UNAVAILABLE, 'The COA file server could not be reached', { cause: String(cause?.message ?? cause) }) };
    }
  }

  async get() {
    const { response, failure } = await this.#request();
    if (failure) return failure;
    if (response.status === 404) return ok(null);
    if (!response.ok) return err(ErrorCode.STORAGE_UNAVAILABLE, `The COA file server failed (HTTP ${response.status})`, { status: response.status });
    try { return ok(cloneJson(JSON.parse(await response.text()))); } catch { return ok(null); }
  }

  async save(settings, { expectedRevision }) {
    const precondition = expectedRevision === 0 ? { 'If-None-Match': '*' } : { 'If-Match': `"${expectedRevision}"` };
    const { response, failure } = await this.#request({ method: 'PUT', headers: { 'Content-Type': 'application/json', ...precondition }, body: JSON.stringify(settings) });
    if (failure) return failure;
    if (response.ok) return ok();
    if (response.status === 409) {
      const { actualRevision } = await response.json();
      return err(ErrorCode.CONFLICT, 'The settings were changed elsewhere', { coaId: 'settings', expectedRevision, actualRevision: actualRevision ?? 0 });
    }
    if (response.status === 404) {
      return err(ErrorCode.CONFLICT, 'The settings were changed elsewhere', { coaId: 'settings', expectedRevision, actualRevision: 0 });
    }
    return err(ErrorCode.STORAGE_UNAVAILABLE, `The COA file server failed (HTTP ${response.status})`, { status: response.status });
  }
}
