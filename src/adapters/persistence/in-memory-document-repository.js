// DocumentRepository kept in memory (tests, and the fallback when storage is blocked).
import { cloneJson } from '../../shared/freeze.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

export const docNotFound = (collection, id) => err(ErrorCode.NOT_FOUND, `${collection}/${id} not found`, { collection, id });
export const docConflict = (collection, id, expectedRevision, actualRevision) =>
  err(ErrorCode.CONFLICT, `${collection}/${id} was changed elsewhere`, { collection, id, expectedRevision, actualRevision });

/** null when the write may go ahead, otherwise the failure. */
export function checkDocRevision(stored, collection, id, expectedRevision) {
  if (stored === null || stored === undefined) return expectedRevision === 0 ? null : docNotFound(collection, id);
  return stored.revision === expectedRevision ? null : docConflict(collection, id, expectedRevision, stored.revision ?? null);
}

/** @implements {import('../../application/ports/document-repository.js').DocumentRepository} */
export class InMemoryDocumentRepository {
  /** @type {Map<string, Map<string, object>>} */
  #collections = new Map();
  #docs = (collection) => this.#collections.get(collection) ?? new Map();

  async list(collection) {
    return ok([...this.#docs(collection).values()].map(cloneJson).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }

  async get(collection, id) {
    const doc = this.#docs(collection).get(id);
    return doc ? ok(cloneJson(doc)) : docNotFound(collection, id);
  }

  async save(collection, doc, { expectedRevision }) {
    const docs = this.#docs(collection);
    const failure = checkDocRevision(docs.get(doc.id), collection, doc.id, expectedRevision);
    if (failure) return failure;
    docs.set(doc.id, cloneJson(doc));
    this.#collections.set(collection, docs);
    return ok();
  }

  async remove(collection, id, { expectedRevision }) {
    const docs = this.#docs(collection);
    if (!docs.has(id)) return docNotFound(collection, id);
    const failure = checkDocRevision(docs.get(id), collection, id, expectedRevision);
    if (failure) return failure;
    docs.delete(id);
    return ok();
  }
}
