// Contract every DocumentRepository adapter must satisfy (driven port): collections of plain JSON
// documents { id, revision, ... } with optimistic concurrency (Epic 3: systems, threat models).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const okValue = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
const errorOf = (r, code) => { assert.equal(r.ok, false, 'expected a failure'); assert.equal(r.error.code, code, JSON.stringify(r.error)); return r.error; };
const aDoc = (id = 'sys-1', revision = 1, extra = {}) => ({ id, revision, name: `Doc ${id}`, maxRange: 12000, ...extra });

export function describeDocumentRepositoryContract(name, makeRepository) {
  describe(`DocumentRepository contract: ${name}`, () => {
    it('starts empty, per collection', async () => {
      assert.deepEqual(okValue(await makeRepository().list('systems')), []);
    });

    it('saves a new document with expectedRevision 0 and gets it back exactly', async () => {
      const repo = makeRepository();
      const doc = aDoc('sys-1', 1, { nested: { list: [1, 2] }, text: 'Ünïcode ✓' });
      okValue(await repo.save('systems', doc, { expectedRevision: 0 }));
      assert.deepEqual(okValue(await repo.get('systems', 'sys-1')), doc);
    });

    it('lists every document of the collection, by id, and nothing from others', async () => {
      const repo = makeRepository();
      await repo.save('systems', aDoc('b'), { expectedRevision: 0 });
      await repo.save('systems', aDoc('a'), { expectedRevision: 0 });
      await repo.save('threat-models', aDoc('m'), { expectedRevision: 0 });
      assert.deepEqual(okValue(await repo.list('systems')).map((d) => d.id), ['a', 'b']);
      assert.deepEqual(okValue(await repo.list('threat-models')).map((d) => d.id), ['m']);
    });

    it('keeps collections apart even with the same id', async () => {
      const repo = makeRepository();
      await repo.save('systems', aDoc('x', 1, { name: 'S' }), { expectedRevision: 0 });
      await repo.save('threat-models', aDoc('x', 1, { name: 'T' }), { expectedRevision: 0 });
      assert.equal(okValue(await repo.get('systems', 'x')).name, 'S');
      assert.equal(okValue(await repo.get('threat-models', 'x')).name, 'T');
    });

    it('updates with the stored revision; CONFLICT when stale or when creating one that exists', async () => {
      const repo = makeRepository();
      await repo.save('systems', aDoc('s'), { expectedRevision: 0 });
      okValue(await repo.save('systems', aDoc('s', 2, { name: 'New' }), { expectedRevision: 1 }));
      const stale = errorOf(await repo.save('systems', aDoc('s', 2), { expectedRevision: 1 }), 'CONFLICT');
      assert.deepEqual(stale.details, { collection: 'systems', id: 's', expectedRevision: 1, actualRevision: 2 });
      errorOf(await repo.save('systems', aDoc('s', 1), { expectedRevision: 0 }), 'CONFLICT');
      assert.equal(okValue(await repo.get('systems', 's')).name, 'New');
    });

    it('is NOT_FOUND for a missing document (get, update, remove)', async () => {
      const repo = makeRepository();
      assert.deepEqual(errorOf(await repo.get('systems', 'nope'), 'NOT_FOUND').details, { collection: 'systems', id: 'nope' });
      errorOf(await repo.save('systems', aDoc('nope', 2), { expectedRevision: 1 }), 'NOT_FOUND');
      errorOf(await repo.remove('systems', 'nope', { expectedRevision: 1 }), 'NOT_FOUND');
    });

    it('removes with the stored revision, refusing a stale one', async () => {
      const repo = makeRepository();
      await repo.save('systems', aDoc('r'), { expectedRevision: 0 });
      errorOf(await repo.remove('systems', 'r', { expectedRevision: 5 }), 'CONFLICT');
      okValue(await repo.remove('systems', 'r', { expectedRevision: 1 }));
      assert.deepEqual(okValue(await repo.list('systems')), []);
    });

    it('hands out copies: changing a returned or saved object does not change what is stored', async () => {
      const repo = makeRepository();
      const doc = aDoc('c');
      await repo.save('systems', doc, { expectedRevision: 0 });
      doc.name = 'changed after save';
      const got = okValue(await repo.get('systems', 'c'));
      try { got.name = 'changed after get'; } catch { /* frozen is fine too */ }
      assert.equal(okValue(await repo.get('systems', 'c')).name, 'Doc c');
    });
  });
}
