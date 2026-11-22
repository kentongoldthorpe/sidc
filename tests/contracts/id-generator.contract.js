// Contract every IdGenerator adapter must satisfy.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

export function describeIdGeneratorContract(name, makeIds) {
  describe(`IdGenerator contract: ${name}`, () => {
    it('returns non-blank strings of at most 128 characters', () => {
      const id = makeIds().next('msg');
      assert.equal(typeof id, 'string');
      assert.ok(id.trim() !== '' && id.length <= 128);
    });

    it('starts ids with the prefix when one is given', () => {
      assert.ok(makeIds().next('coa').startsWith('coa'));
    });

    it('never repeats within one generator (1000 ids, mixed prefixes)', () => {
      const ids = makeIds();
      const seen = new Set();
      for (let i = 0; i < 1000; i++) seen.add(ids.next(i % 2 ? 'a' : 'b'));
      assert.equal(seen.size, 1000);
    });
  });
}
