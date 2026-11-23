// T-1 The systems list (decision D22): weapon and sensor systems entered once and reused by threat
// models. system.create / system.update / system.delete and system.list, tested through envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';

const SA15 = { name: 'SA-15', role: 'airDefence', maxRange: 12000 };
const T72 = { name: 'T-72 main gun', role: 'direct', maxRange: 2500, minRange: 100, arc: 60 };

describe('system.create', () => {
  it('stores a system with a fresh id and revision 1 (arc defaults to all round), and publishes system.created', async () => {
    const h = createHarness();
    const system = okValue(await h.dispatch('system.create', { ...SA15, name: '  SA-15  ' }));
    assert.deepEqual(system, { id: system.id, revision: 1, name: 'SA-15', role: 'airDefence', maxRange: 12000, arc: 360 });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload]), [['system.created', { system }]]);
    assert.deepEqual(okValue(await h.query('system.list')), [system]);
  });

  it('keeps an optional minimum range and a narrower arc', async () => {
    const h = createHarness();
    const system = okValue(await h.dispatch('system.create', T72));
    assert.deepEqual({ ...system, id: 0 }, { id: 0, revision: 1, ...T72 });
  });

  const invalid = [
    ['a blank name', { ...SA15, name: ' ' }, ['name']],
    ['a name over 60 characters', { ...SA15, name: 'x'.repeat(61) }, ['name']],
    ['an unknown role', { ...SA15, role: 'artillery' }, ['role']],
    ['no maximum range', { name: 'X', role: 'sensor' }, ['maxRange']],
    ['a zero or huge maximum range', { ...SA15, maxRange: 0 }, ['maxRange']],
    ['a minimum range not below the maximum', { ...SA15, minRange: 12000 }, ['minRange']],
    ['a negative minimum range', { ...SA15, minRange: -1 }, ['minRange']],
    ['an arc of 0 or over 360', { ...SA15, arc: 0 }, ['arc']],
    ['an arc that is not a number', { ...SA15, arc: 'wide' }, ['arc']],
    ['an unknown field', { ...SA15, colour: 'red' }, ['colour']],
  ];
  for (const [what, payload, fields] of invalid) {
    it(`refuses ${what} with VALIDATION_FAILED`, async () => {
      const h = createHarness();
      assert.deepEqual(problemFields(errorOf(await h.dispatch('system.create', payload), 'VALIDATION_FAILED')), fields);
      assert.deepEqual(okValue(await h.query('system.list')), []);
    });
  }
});

describe('system.update and system.delete', () => {
  async function withSystem() {
    const h = createHarness();
    const system = okValue(await h.dispatch('system.create', T72));
    h.takeEvents();
    return { h, system };
  }

  it('changes fields, bumps the revision, reports what changed; null removes the minimum range', async () => {
    const { h, system } = await withSystem();
    const updated = okValue(await h.dispatch('system.update', { systemId: system.id, expectedRevision: 1, name: 'T-72B3 gun', arc: 90, minRange: null }));
    assert.deepEqual(updated, { id: system.id, revision: 2, name: 'T-72B3 gun', role: 'direct', maxRange: 2500, arc: 90 });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload.changed]), [['system.updated', ['name', 'minRange', 'arc']]]);
  });

  it('a change to the same values is a no-op (same revision, no event)', async () => {
    const { h, system } = await withSystem();
    const same = okValue(await h.dispatch('system.update', { systemId: system.id, expectedRevision: 1, name: ' T-72 main gun ', arc: 60 }));
    assert.equal(same.revision, 1);
    assert.deepEqual(h.takeEvents(), []);
  });

  it('is CONFLICT for a stale revision and NOT_FOUND for an unknown system', async () => {
    const { h, system } = await withSystem();
    okValue(await h.dispatch('system.update', { systemId: system.id, expectedRevision: 1, name: 'B' }));
    assert.deepEqual(errorOf(await h.dispatch('system.update', { systemId: system.id, expectedRevision: 1, name: 'C' }), 'CONFLICT').details,
      { systemId: system.id, expectedRevision: 1, actualRevision: 2 });
    assert.deepEqual(errorOf(await h.dispatch('system.update', { systemId: 'sys-404', expectedRevision: 1, name: 'C' }), 'NOT_FOUND').details, { systemId: 'sys-404' });
  });

  it('validates changes like create, including the minimum against the new maximum', async () => {
    const { h, system } = await withSystem();
    assert.deepEqual(problemFields(errorOf(await h.dispatch('system.update', { systemId: system.id, expectedRevision: 1, maxRange: 50 }), 'VALIDATION_FAILED')), ['minRange']);
    assert.deepEqual(problemFields(errorOf(await h.dispatch('system.update', { systemId: system.id, expectedRevision: 1, role: 'x' }), 'VALIDATION_FAILED')), ['role']);
  });

  it('deletes with the current revision, publishing system.deleted', async () => {
    const { h, system } = await withSystem();
    errorOf(await h.dispatch('system.delete', { systemId: system.id, expectedRevision: 3 }), 'CONFLICT');
    assert.deepEqual(okValue(await h.dispatch('system.delete', { systemId: system.id, expectedRevision: 1 })), { systemId: system.id });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload]), [['system.deleted', { systemId: system.id }]]);
    assert.deepEqual(okValue(await h.query('system.list')), []);
    errorOf(await h.dispatch('system.delete', { systemId: system.id, expectedRevision: 1 }), 'NOT_FOUND');
  });
});

describe('system.list', () => {
  it('lists by name (numbers in names sort naturally) and skips stored documents that are not valid systems', async () => {
    const h = createHarness();
    for (const name of ['SA-15', 'BMP-2 30mm', '2S19 152mm', 'SA-8']) okValue(await h.dispatch('system.create', { ...SA15, name }));
    await h.ports.documentRepository.save('systems', { id: 'broken', revision: 1, name: '', role: 'nope' }, { expectedRevision: 0 });
    assert.deepEqual(okValue(await h.query('system.list')).map((s) => s.name), ['2S19 152mm', 'BMP-2 30mm', 'SA-8', 'SA-15']);
  });
});
