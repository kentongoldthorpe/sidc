// Driven port: DocumentRepository. Collections of plain JSON documents { id, revision, ... } with
// optimistic concurrency, for data that is not a COA (Epic 3: the systems list, threat models).
// Reading never trusts a document: the core checks each one with its domain rules.
/**
 * @typedef {{ id: string, revision: number }} Doc
 * @typedef {Object} DocumentRepository
 * @property {(collection: string) => Promise<Result<Doc[]>>} list   every document, sorted by id
 * @property {(collection: string, id: string) => Promise<Result<Doc>>} get   NOT_FOUND { collection, id }
 * @property {(collection: string, doc: Doc, opts: { expectedRevision: number }) => Promise<Result<void>>} save
 *   expectedRevision 0 creates; otherwise the stored revision must match:
 *   CONFLICT { collection, id, expectedRevision, actualRevision } | NOT_FOUND
 * @property {(collection: string, id: string, opts: { expectedRevision: number }) => Promise<Result<void>>} remove
 * Adapters may also fail with STORAGE_UNAVAILABLE or STORAGE_QUOTA_EXCEEDED.
 */
export {};
