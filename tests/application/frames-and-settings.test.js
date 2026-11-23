// Milestone 6a: export frames (shared in settings, optional per-COA override) and the classification
// marking, tested only through envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';

const FRAME = { aspect: '4:3', center: { lat: 34.1, lng: -117.3 }, width: 0.5 };
const DEFAULT_MARKING = { text: 'UNCLASSIFIED', color: '#007a33' };

async function withCoa() {
  const h = createHarness();
  const coa = okValue(await h.dispatch('coa.create', { name: 'COA 1' }));
  h.takeEvents();
  return { h, coa };
}

describe('settings.get', () => {
  it('starts with no shared frame and the default UNCLASSIFIED (green) marking', async () => {
    const settings = okValue(await createHarness().query('settings.get'));
    assert.deepEqual(settings, { revision: 0, frame: null, marking: DEFAULT_MARKING });
  });
});

describe('settings.update', () => {
  it('saves the shared frame, bumps the revision and publishes settings.updated', async () => {
    const h = createHarness();
    const saved = okValue(await h.dispatch('settings.update', { expectedRevision: 0, frame: FRAME }));
    assert.deepEqual(saved, { revision: 1, frame: FRAME, marking: DEFAULT_MARKING });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload]), [['settings.updated', { settings: saved, changed: ['frame'] }]]);
    assert.deepEqual(okValue(await h.query('settings.get')), saved);
  });

  it('changes the marking (text trimmed, colour lower-cased) and can clear the shared frame', async () => {
    const h = createHarness();
    okValue(await h.dispatch('settings.update', { expectedRevision: 0, frame: FRAME }));
    const saved = okValue(await h.dispatch('settings.update', { expectedRevision: 1, frame: null, marking: { text: '  CUI  ', color: '#502B85' } }));
    assert.deepEqual(saved, { revision: 2, frame: null, marking: { text: 'CUI', color: '#502b85' } });
    assert.deepEqual(h.takeEvents().at(-1).payload.changed, ['frame', 'marking']);
  });

  it('normalises the frame (longitude wrapped) and treats an unchanged update as a no-op', async () => {
    const h = createHarness();
    const saved = okValue(await h.dispatch('settings.update', { expectedRevision: 0, frame: { ...FRAME, center: { lat: 1, lng: 190 } } }));
    assert.deepEqual(saved.frame.center, { lat: 1, lng: -170 });
    h.takeEvents();
    assert.equal(okValue(await h.dispatch('settings.update', { expectedRevision: 1, frame: saved.frame })).revision, 1);
    assert.deepEqual(h.takeEvents(), []);
  });

  it('refuses a stale revision with CONFLICT', async () => {
    const h = createHarness();
    okValue(await h.dispatch('settings.update', { expectedRevision: 0, frame: FRAME }));
    assert.deepEqual(errorOf(await h.dispatch('settings.update', { expectedRevision: 0, frame: null }), 'CONFLICT').details,
      { coaId: 'settings', expectedRevision: 0, actualRevision: 1 });
  });

  it('refuses a stale revision even when nothing would change (the client must reload first)', async () => {
    const h = createHarness();
    okValue(await h.dispatch('settings.update', { expectedRevision: 0, frame: FRAME }));
    errorOf(await h.dispatch('settings.update', { expectedRevision: 0, frame: FRAME }), 'CONFLICT');
  });

  for (const [name, payload, fields] of [
    ['an unknown aspect ratio', { frame: { ...FRAME, aspect: '21:9' } }, ['frame.aspect']],
    ['a zero width', { frame: { ...FRAME, width: 0 } }, ['frame.width']],
    ['a width wider than the world', { frame: { ...FRAME, width: 361 } }, ['frame.width']],
    ['a latitude out of range', { frame: { ...FRAME, center: { lat: 95, lng: 0 } } }, ['frame.center.lat']],
    ['an unknown frame field', { frame: { ...FRAME, zoom: 3 } }, ['frame.zoom']],
    ['a frame that is not an object', { frame: '4:3' }, ['frame']],
    ['a blank marking', { marking: { text: '  ', color: '#007a33' } }, ['marking.text']],
    ['a marking over 80 characters', { marking: { text: 'X'.repeat(81), color: '#007a33' } }, ['marking.text']],
    ['a marking colour that is not #rrggbb', { marking: { text: 'UNCLASSIFIED', color: 'green' } }, ['marking.color']],
    ['an unknown field', { theme: 'dark' }, ['theme']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED`, async () => {
      const reply = await createHarness().dispatch('settings.update', { expectedRevision: 0, ...payload });
      assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), fields);
    });
  }
});

describe('a COA\'s own frame (overrides the shared one)', () => {
  it('is set with coa.update, reported as changed, and kept by coa.get', async () => {
    const { h, coa } = await withCoa();
    const updated = okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, frame: FRAME }));
    assert.deepEqual(updated, { ...coa, frame: FRAME, revision: 2, updatedAt: updated.updatedAt });
    assert.deepEqual(h.takeEvents()[0].payload.changed, ['frame']);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })).frame, FRAME);
  });

  it('is removed again with frame: null, back to using the shared frame', async () => {
    const { h, coa } = await withCoa();
    okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, frame: FRAME }));
    const cleared = okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 2, frame: null }));
    assert.equal('frame' in cleared, false);
    assert.equal(cleared.revision, 3);
  });

  it('is a no-op when unchanged, and clearing a frame that is not set is a no-op', async () => {
    const { h, coa } = await withCoa();
    assert.equal(okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, frame: null })).revision, 1);
    okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, frame: FRAME }));
    assert.equal(okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 2, frame: FRAME })).revision, 2);
  });

  it('is copied by coa.duplicate', async () => {
    const { h, coa } = await withCoa();
    okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, frame: FRAME }));
    assert.deepEqual(okValue(await h.dispatch('coa.duplicate', { coaId: coa.id })).frame, FRAME);
  });

  it('is validated like the shared frame', async () => {
    const { h, coa } = await withCoa();
    const reply = await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, frame: { ...FRAME, aspect: '1:1' } });
    assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), ['frame.aspect']);
  });
});
