// A DocumentRepository for tests whose COA collection can be watched or broken through COA-shaped
// methods (`docs.coas.save = …`), as these tests did against the former CoaRepository port.
import { InMemoryDocumentRepository } from '../../src/adapters/persistence/in-memory-document-repository.js';

export class CoaDocs extends InMemoryDocumentRepository {
  constructor() {
    super();
    const inner = new InMemoryDocumentRepository();
    this.coas = {
      list: () => inner.list('coas'),
      get: (coaId) => inner.get('coas', coaId),
      save: (coa, options) => inner.save('coas', coa, options),
      remove: (coaId, options) => inner.remove('coas', coaId, options),
    };
  }

  list(collection) { return collection === 'coas' ? this.coas.list() : super.list(collection); }
  get(collection, id) { return collection === 'coas' ? this.coas.get(id) : super.get(collection, id); }
  save(collection, doc, options) { return collection === 'coas' ? this.coas.save(doc, options) : super.save(collection, doc, options); }
  remove(collection, id, options) { return collection === 'coas' ? this.coas.remove(id, options) : super.remove(collection, id, options); }
}
