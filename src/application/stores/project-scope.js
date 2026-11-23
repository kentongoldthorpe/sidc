// The open project's view of storage (D27): every collection a project owns is read and written
// under "<collection>--<projectId>"; the Default project uses the plain names, where everything
// saved before projects already is. Other collections (such as "projects") are shared.
import { PROJECT_COLLECTIONS, scopedCollection } from '../../domain/project.js';

/** @returns {import('../ports/document-repository.js').DocumentRepository} */
export function scopeDocuments(documents, projectId) {
  const name = (collection) => (PROJECT_COLLECTIONS.includes(collection) ? scopedCollection(collection, projectId) : collection);
  const unscope = (result) => {
    if (result.ok || !result.error.details?.collection) return result;
    return { ...result, error: { ...result.error, details: { ...result.error.details, collection: result.error.details.collection.replace(/--p[a-z0-9]+$/, '') } } };
  };
  return {
    list: async (collection) => unscope(await documents.list(name(collection))),
    get: async (collection, id) => unscope(await documents.get(name(collection), id)),
    save: async (collection, doc, options) => unscope(await documents.save(name(collection), doc, options)),
    remove: async (collection, id, options) => unscope(await documents.remove(name(collection), id, options)),
  };
}
