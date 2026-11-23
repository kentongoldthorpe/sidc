// The settings document kept through any DocumentRepository adapter, as the core sees it (settingsStore, D31).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const settings = (revision, text = 'UNCLASSIFIED') => ({
  revision, frame: { aspect: '4:3', center: { lat: 1, lng: 2 }, width: 0.5 }, marking: { text, color: '#007a33' },
});
const okValue = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };

export function describeSettingsRepositoryContract(name, makeRepository) {
  describe(`SettingsRepository contract: ${name}`, () => {
    it('has nothing stored at first', async () => {
      assert.equal(okValue(await makeRepository().get()), null);
    });

    it('saves the first time with expectedRevision 0 and gets it back', async () => {
      const repo = makeRepository();
      okValue(await repo.save(settings(1), { expectedRevision: 0 }));
      assert.deepEqual(okValue(await repo.get()), settings(1));
    });

    it('updates when expectedRevision matches, refuses a stale one with CONFLICT', async () => {
      const repo = makeRepository();
      await repo.save(settings(1), { expectedRevision: 0 });
      okValue(await repo.save(settings(2, 'CUI'), { expectedRevision: 1 }));
      const r = await repo.save(settings(2, 'LATE'), { expectedRevision: 1 });
      assert.equal(r.ok, false);
      assert.equal(r.error.code, 'CONFLICT');
      assert.deepEqual(r.error.details, { coaId: 'settings', expectedRevision: 1, actualRevision: 2 });
      assert.equal(okValue(await repo.get()).marking.text, 'CUI');
    });

    it('refuses a first save that is not expectedRevision 0 with CONFLICT', async () => {
      const r = await makeRepository().save(settings(3), { expectedRevision: 2 });
      assert.deepEqual([r.ok, r.error?.code, r.error?.details], [false, 'CONFLICT', { coaId: 'settings', expectedRevision: 2, actualRevision: 0 }]);
    });

    it('is isolated from callers', async () => {
      const repo = makeRepository();
      const value = settings(1);
      await repo.save(value, { expectedRevision: 0 });
      value.marking.text = 'MUTATED';
      const got = okValue(await repo.get());
      assert.equal(got.marking.text, 'UNCLASSIFIED');
      assert.ok(Object.isFrozen(got) && Object.isFrozen(got.marking));
    });
  });
}
