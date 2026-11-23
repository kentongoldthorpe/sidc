// Slice: coa.create, coa.get, coa.list — tested only through envelopes at the driving boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields, T0 } from '../support/app-harness.js';
import { createApplication } from '../../src/application/create-application.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { InMemorySettingsRepository } from '../../src/adapters/persistence/in-memory-settings-repository.js';
import { FixedClock } from '../support/fixed-clock.js';
import { SequenceIdGenerator } from '../support/sequence-id-generator.js';
import { StubRenderer } from '../support/stub-renderer.js';
import { err } from '../../src/shared/result.js';

describe('createApplication', () => {
  it('requires every driven port', () => {
    const ports = {
      clock: new FixedClock(), ids: new SequenceIdGenerator(),
      coaRepository: new InMemoryCoaRepository(), symbolRenderer: new StubRenderer(),
      settingsRepository: new InMemorySettingsRepository(),
    };
    for (const missing of Object.keys(ports)) {
      assert.throws(() => createApplication({ ...ports, [missing]: undefined }), { name: 'TypeError', message: new RegExp(missing) });
    }
  });
});

describe('coa.create', () => {
  it('creates a COA, replies with it and publishes coa.created', async () => {
    const h = createHarness();
    const coa = okValue(await h.dispatch('coa.create', { name: 'Envelopment', description: 'Main effort north' }));

    assert.deepEqual(coa, {
      id: coa.id, name: 'Envelopment', description: 'Main effort north',
      createdAt: T0, updatedAt: T0, revision: 1, symbols: [], graphics: [],
    });
    assert.match(coa.id, /^coa-/);

    const [event, ...rest] = h.takeEvents();
    assert.deepEqual(rest, []);
    assert.deepEqual([event.type, event.v, event.payload], ['coa.created', 1, { coa }]);
  });

  it('defaults the description to empty and trims both fields', async () => {
    const h = createHarness();
    const coa = okValue(await h.dispatch('coa.create', { name: '  COA 2  ', description: '  note  ' }));
    assert.deepEqual([coa.name, coa.description], ['COA 2', 'note']);
    assert.equal(okValue(await h.dispatch('coa.create', { name: 'COA 3' })).description, '');
  });

  it('gives each COA its own id', async () => {
    const h = createHarness();
    const a = okValue(await h.dispatch('coa.create', { name: 'A' }));
    const b = okValue(await h.dispatch('coa.create', { name: 'A' }));
    assert.notEqual(a.id, b.id);
  });

  it('accepts a name of exactly 120 characters', async () => {
    okValue(await createHarness().dispatch('coa.create', { name: 'x'.repeat(120) }));
  });

  const invalid = [
    ['missing name', {}, ['name']],
    ['non-string name', { name: 42 }, ['name']],
    ['blank name', { name: '   ' }, ['name']],
    ['name over 120 characters', { name: 'x'.repeat(121) }, ['name']],
    ['non-string description', { name: 'A', description: 5 }, ['description']],
    ['description over 2000 characters', { name: 'A', description: 'x'.repeat(2001) }, ['description']],
    ['unknown field', { name: 'A', colour: 'red' }, ['colour']],
    ['several problems at once', { name: '', description: 7 }, ['name', 'description']],
  ];
  for (const [name, payload, fields] of invalid) {
    it(`rejects ${name} with VALIDATION_FAILED and changes nothing`, async () => {
      const h = createHarness();
      const error = errorOf(await h.dispatch('coa.create', payload), 'VALIDATION_FAILED');
      assert.deepEqual(problemFields(error), fields);
      assert.deepEqual(h.takeEvents(), []);
      assert.deepEqual(okValue(await h.query('coa.list')), []);
    });
  }

  it('rejects an unsupported payload version', async () => {
    const error = errorOf(await createHarness().dispatch('coa.create', { name: 'A' }, { v: 2 }), 'UNSUPPORTED_VERSION');
    assert.deepEqual(error.details, { type: 'coa.create', v: 2, supported: [1] });
  });

  it('passes a storage failure through and publishes nothing', async () => {
    const failing = Object.assign(new InMemoryCoaRepository(), {
      save: async () => err('STORAGE_UNAVAILABLE', 'Storage is blocked'),
    });
    const h = createHarness({ coaRepository: failing });
    errorOf(await h.dispatch('coa.create', { name: 'A' }), 'STORAGE_UNAVAILABLE');
    assert.deepEqual(h.takeEvents(), []);
  });
});

describe('coa.get', () => {
  it('returns a created COA', async () => {
    const h = createHarness();
    const coa = okValue(await h.dispatch('coa.create', { name: 'A' }));
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })), coa);
  });

  it('is NOT_FOUND for an unknown id', async () => {
    const error = errorOf(await createHarness().query('coa.get', { coaId: 'coa-404' }), 'NOT_FOUND');
    assert.deepEqual(error.details, { coaId: 'coa-404' });
  });

  for (const [name, payload, fields] of [
    ['missing coaId', {}, ['coaId']], ['blank coaId', { coaId: ' ' }, ['coaId']],
    ['non-string coaId', { coaId: 1 }, ['coaId']], ['unknown field', { coaId: 'c', extra: 1 }, ['extra']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED`, async () => {
      assert.deepEqual(problemFields(errorOf(await createHarness().query('coa.get', payload), 'VALIDATION_FAILED')), fields);
    });
  }
});

describe('coa.list', () => {
  it('is empty at first', async () => {
    assert.deepEqual(okValue(await createHarness().query('coa.list')), []);
  });

  it('lists summaries, most recently updated first', async () => {
    const h = createHarness();
    const first = okValue(await h.dispatch('coa.create', { name: 'First' }));
    h.clock.advance(60_000);
    const second = okValue(await h.dispatch('coa.create', { name: 'Second' }));
    assert.deepEqual(okValue(await h.query('coa.list')), [
      { id: second.id, name: 'Second', symbolCount: 0, revision: 1, updatedAt: '2026-11-22T20:41:00.000Z' },
      { id: first.id, name: 'First', symbolCount: 0, revision: 1, updatedAt: T0 },
    ]);
  });

  it('rejects unknown payload fields', async () => {
    assert.deepEqual(problemFields(errorOf(await createHarness().query('coa.list', { page: 2 }), 'VALIDATION_FAILED')), ['page']);
  });

  it('does not publish events', async () => {
    const h = createHarness();
    await h.query('coa.list');
    assert.deepEqual(h.takeEvents(), []);
  });
});
