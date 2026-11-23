// CoaRepository adapter over the Web Storage API (localStorage): the fallback when serve.ps1's file
// storage is not available. One key per COA ("<prefix>:coa:<id>") holding its GeoJSON document
// (the same format as the files). COAs are found by key prefix, so there is no index to get out of step.
import { coaToGeoJson, geoJsonToCoa } from './geojson-coa.js';
import { toSummary, bySummaryOrder } from './coa-summaries.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const isQuotaError = (e) => e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22;
const notFound = (coaId) => err(ErrorCode.NOT_FOUND, `COA ${coaId} not found`, { coaId });

/** Run a storage operation, turning thrown storage errors into Results. */
export function guard(operation) {
  try {
    return operation();
  } catch (error) {
    if (isQuotaError(error)) return err(ErrorCode.STORAGE_QUOTA_EXCEEDED, 'Browser storage is full', { cause: String(error.message ?? error) });
    return err(ErrorCode.STORAGE_UNAVAILABLE, 'Browser storage is not available', { cause: String(error?.message ?? error) });
  }
}

function readDoc(raw, coaId) {
  let doc;
  try { doc = JSON.parse(raw); } catch {
    return err(ErrorCode.STORAGE_UNAVAILABLE, `The stored COA ${coaId} is not valid JSON`, { coaId, problems: [{ field: '(root)', reason: 'not valid JSON' }] });
  }
  const parsed = geoJsonToCoa(doc);
  return parsed.ok ? parsed : err(ErrorCode.STORAGE_UNAVAILABLE, `The stored COA ${coaId} is not valid`, { coaId, problems: parsed.error.details.problems ?? [] });
}

/** @implements {import('../../application/ports/coa-repository.js').CoaRepository} */
export class LocalStorageCoaRepository {
  #storage;
  #prefix;

  /** @param {{ storage: Storage, prefix?: string }} options */
  constructor({ storage, prefix = 'coa-builder' } = {}) {
    if (storage === null || typeof storage !== 'object') throw new TypeError('LocalStorageCoaRepository: a Storage object is required');
    this.#storage = storage;
    this.#prefix = `${prefix}:coa:`;
  }

  #key = (coaId) => `${this.#prefix}${coaId}`;

  /** null when writing is allowed, otherwise the failure Result. */
  #checkRevision(raw, coaId, expectedRevision) {
    if (raw === null) return expectedRevision === 0 ? null : notFound(coaId);
    let actualRevision = null;
    try { actualRevision = JSON.parse(raw)?.coa?.revision ?? null; } catch { /* unreadable: treated as a conflict */ }
    return actualRevision === expectedRevision ? null
      : err(ErrorCode.CONFLICT, `COA ${coaId} was changed elsewhere`, { coaId, expectedRevision, actualRevision });
  }

  async list() {
    return guard(() => {
      const summaries = [];
      for (let i = 0; i < this.#storage.length; i++) {
        const key = this.#storage.key(i);
        if (!key?.startsWith(this.#prefix)) continue;
        const read = readDoc(this.#storage.getItem(key), key.slice(this.#prefix.length));
        if (read.ok) summaries.push(toSummary(read.value)); // unreadable entries are skipped, not fatal
      }
      return ok(summaries.sort(bySummaryOrder));
    });
  }

  async get(coaId) {
    return guard(() => {
      const raw = this.#storage.getItem(this.#key(coaId));
      return raw === null ? notFound(coaId) : readDoc(raw, coaId);
    });
  }

  async save(coa, { expectedRevision }) {
    return guard(() => {
      const key = this.#key(coa.id);
      const failure = this.#checkRevision(this.#storage.getItem(key), coa.id, expectedRevision);
      if (failure) return failure;
      this.#storage.setItem(key, JSON.stringify(coaToGeoJson(coa)));
      return ok();
    });
  }

  async remove(coaId, { expectedRevision }) {
    return guard(() => {
      const key = this.#key(coaId);
      const raw = this.#storage.getItem(key);
      if (raw === null) return notFound(coaId);
      const failure = this.#checkRevision(raw, coaId, expectedRevision);
      if (failure) return failure;
      this.#storage.removeItem(key);
      return ok();
    });
  }
}
