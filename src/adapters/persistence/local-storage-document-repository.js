// DocumentRepository over the Web Storage API (localStorage): the fallback when serve.ps1's file
// storage is not available. One key per document, "<prefix>:doc:<collection>:<id>"; COAs and the
// settings keep their own keys and formats (see stored-collections.js). Documents are found by key
// prefix, so there is no index to get out of step.
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { docNotFound, checkDocRevision } from './in-memory-document-repository.js';
import { codecFor, decodeText, byId } from './stored-collections.js';

const isQuotaError = (e) => e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22;

/** Run a storage operation, turning thrown storage errors into Results. */
export function guard(operation) {
  try {
    return operation();
  } catch (error) {
    if (isQuotaError(error)) return err(ErrorCode.STORAGE_QUOTA_EXCEEDED, 'Browser storage is full', { cause: String(error.message ?? error) });
    return err(ErrorCode.STORAGE_UNAVAILABLE, 'Browser storage is not available', { cause: String(error?.message ?? error) });
  }
}

/** @implements {import('../../application/ports/document-repository.js').DocumentRepository} */
export class LocalStorageDocumentRepository {
  #storage;
  #prefix;

  /** @param {{ storage: Storage, prefix?: string }} options */
  constructor({ storage, prefix = 'coa-builder' } = {}) {
    if (storage === null || typeof storage !== 'object') throw new TypeError('LocalStorageDocumentRepository: a Storage object is required');
    this.#storage = storage;
    this.#prefix = prefix;
  }

  /** Where a collection's documents live: the key of one, and the prefix shared by all of them. */
  #place(collection) {
    if (collection === 'coas') return { key: (id) => `${this.#prefix}:coa:${id}`, start: `${this.#prefix}:coa:` };
    if (collection === 'settings') return { key: () => `${this.#prefix}:settings`, start: null, only: `${this.#prefix}:settings` };
    const start = `${this.#prefix}:doc:${collection}:`;
    return { key: (id) => `${start}${id}`, start };
  }

  /** The stored document, null when missing, or the unreadable failure. */
  #read(collection, id) {
    const raw = this.#storage.getItem(this.#place(collection).key(id));
    return raw === null ? null : decodeText(collection, id, raw);
  }

  async list(collection) {
    return guard(() => {
      const place = this.#place(collection);
      const keys = [];
      if (place.only) { if (this.#storage.getItem(place.only) !== null) keys.push([place.only, 'settings']); } else {
        for (let i = 0; i < this.#storage.length; i++) {
          const key = this.#storage.key(i);
          if (key?.startsWith(place.start)) keys.push([key, key.slice(place.start.length)]);
        }
      }
      const docs = keys.map(([key, id]) => decodeText(collection, id, this.#storage.getItem(key))).filter((r) => r.ok).map((r) => r.value);
      return ok(docs.sort(byId)); // unreadable entries are skipped, not fatal
    });
  }

  async get(collection, id) {
    return guard(() => this.#read(collection, id) ?? docNotFound(collection, id));
  }

  /** The stored document for a revision check: null when missing, {} when unreadable (never matches). */
  #current(collection, id) {
    const read = this.#read(collection, id);
    return read === null ? null : read.ok ? read.value : {};
  }

  async save(collection, doc, { expectedRevision }) {
    return guard(() => {
      const failure = checkDocRevision(this.#current(collection, doc.id), collection, doc.id, expectedRevision);
      if (failure) return failure;
      this.#storage.setItem(this.#place(collection).key(doc.id), JSON.stringify(codecFor(collection).encode(doc)));
      return ok();
    });
  }

  async remove(collection, id, { expectedRevision }) {
    return guard(() => {
      const current = this.#current(collection, id);
      if (current === null) return docNotFound(collection, id);
      const failure = checkDocRevision(current, collection, id, expectedRevision);
      if (failure) return failure;
      this.#storage.removeItem(this.#place(collection).key(id));
      return ok();
    });
  }
}
