// DocumentRepository over the Web Storage API: one key per document, "<prefix>:doc:<collection>:<id>".
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { guard } from './local-storage-coa-repository.js';
import { docNotFound, checkDocRevision } from './in-memory-document-repository.js';

const unreadable = (collection, id) => err(ErrorCode.STORAGE_UNAVAILABLE, `The stored ${collection}/${id} is not valid JSON`, { collection, id });

/** @implements {import('../../application/ports/document-repository.js').DocumentRepository} */
export class LocalStorageDocumentRepository {
  #storage;
  #prefix;

  /** @param {{ storage: Storage, prefix?: string }} options */
  constructor({ storage, prefix = 'coa-builder' } = {}) {
    if (storage === null || typeof storage !== 'object') throw new TypeError('LocalStorageDocumentRepository: a Storage object is required');
    this.#storage = storage;
    this.#prefix = `${prefix}:doc:`;
  }

  #key = (collection, id) => `${this.#prefix}${collection}:${id}`;
  #read(raw) { try { return JSON.parse(raw); } catch { return undefined; } }

  async list(collection) {
    return guard(() => {
      const start = `${this.#prefix}${collection}:`;
      const docs = [];
      for (let i = 0; i < this.#storage.length; i++) {
        const key = this.#storage.key(i);
        if (!key?.startsWith(start)) continue;
        const doc = this.#read(this.#storage.getItem(key));
        if (doc !== undefined) docs.push(doc); // unreadable entries are skipped, not fatal
      }
      return ok(docs.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)));
    });
  }

  async get(collection, id) {
    return guard(() => {
      const raw = this.#storage.getItem(this.#key(collection, id));
      if (raw === null) return docNotFound(collection, id);
      const doc = this.#read(raw);
      return doc === undefined ? unreadable(collection, id) : ok(doc);
    });
  }

  async save(collection, doc, { expectedRevision }) {
    return guard(() => {
      const key = this.#key(collection, doc.id);
      const raw = this.#storage.getItem(key);
      const failure = checkDocRevision(raw === null ? null : (this.#read(raw) ?? {}), collection, doc.id, expectedRevision);
      if (failure) return failure;
      this.#storage.setItem(key, JSON.stringify(doc));
      return ok();
    });
  }

  async remove(collection, id, { expectedRevision }) {
    return guard(() => {
      const key = this.#key(collection, id);
      const raw = this.#storage.getItem(key);
      if (raw === null) return docNotFound(collection, id);
      const failure = checkDocRevision(this.#read(raw) ?? {}, collection, id, expectedRevision);
      if (failure) return failure;
      this.#storage.removeItem(key);
      return ok();
    });
  }
}
