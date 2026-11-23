// T-2a Threat models (IPB step 3): a model with a doctrinal template ("formation") drawn to scale in
// metres, without terrain. Template space: (0, 0) is the reference point, +y is the direction of
// attack. Tested through envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields, UNKNOWN_SIDC, T0 } from '../support/app-harness.js';

const INF = '10061000001211000000';
const unit = (extra = {}) => ({ sidc: INF, label: 'MRC', x: 0, y: 0, ...extra });

async function withModel() {
  const h = createHarness();
  const model = okValue(await h.dispatch('threat-model.create', { name: 'MRB in the attack', description: 'Doctrine: forward detachment' }));
  h.takeEvents();
  return { h, model };
}
const setTemplate = (s, template, revision = s.model.revision) => s.h.dispatch('threat-model.set-template', { modelId: s.model.id, expectedRevision: revision, target: 'formation', template });

describe('threat-model.create / update / delete / list / get', () => {
  it('creates a model with an empty formation and no COAs, and publishes threat-model.created', async () => {
    const h = createHarness();
    const model = okValue(await h.dispatch('threat-model.create', { name: '  MRB attack  ' }));
    assert.deepEqual(model, { id: model.id, revision: 1, name: 'MRB attack', description: '', createdAt: T0, updatedAt: T0, formation: { units: [], graphics: [] }, coas: [] });
    assert.deepEqual(h.takeEvents().map((e) => e.type), ['threat-model.created']);
    assert.deepEqual(okValue(await h.query('threat-model.get', { modelId: model.id })), model);
  });

  it('lists models by name with counts', async () => {
    const s = await withModel();
    okValue(await s.h.dispatch('threat-model.create', { name: 'AD umbrella' }));
    okValue(await setTemplate(s, { units: [unit(), unit({ x: 500 })], graphics: [] }));
    const list = okValue(await s.h.query('threat-model.list'));
    assert.deepEqual(list.map((m) => [m.name, m.unitCount, m.coaCount]), [['AD umbrella', 0, 0], ['MRB in the attack', 2, 0]]);
    assert.ok(list.every((m) => !('formation' in m)), 'summaries only');
  });

  it('renames and re-describes with optimistic concurrency, and deletes', async () => {
    const s = await withModel();
    const updated = okValue(await s.h.dispatch('threat-model.update', { modelId: s.model.id, expectedRevision: 1, name: 'MRB v2' }));
    assert.equal(updated.revision, 2);
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.payload.changed]), [['threat-model.updated', ['name']]]);
    errorOf(await s.h.dispatch('threat-model.update', { modelId: s.model.id, expectedRevision: 1, name: 'X' }), 'CONFLICT');
    assert.deepEqual(problemFields(errorOf(await s.h.dispatch('threat-model.update', { modelId: s.model.id, expectedRevision: 2, name: ' ' }), 'VALIDATION_FAILED')), ['name']);
    okValue(await s.h.dispatch('threat-model.delete', { modelId: s.model.id, expectedRevision: 2 }));
    assert.deepEqual(s.h.takeEvents().map((e) => e.type), ['threat-model.deleted']);
    assert.deepEqual(errorOf(await s.h.query('threat-model.get', { modelId: s.model.id }), 'NOT_FOUND').details, { modelId: s.model.id });
  });
});

describe('threat-model.set-template (the formation)', () => {
  it('replaces the formation, giving new items ids and keeping existing ids; publishes threat-model.updated', async () => {
    const s = await withModel();
    const first = okValue(await setTemplate(s, {
      units: [unit({ label: '1 MRC', x: -800, y: 0, facing: 0, systems: [], hvt: false }), unit({ sidc: '10061000001301000000', label: 'Arty', x: 0, y: -4000, hvt: true })],
      graphics: [{ kind: 'axisOfAdvance', label: 'AXIS', points: [{ x: 0, y: -2000 }, { x: 0, y: 6000 }] }],
    }));
    const [a, b] = first.formation.units;
    assert.equal(first.revision, 2);
    assert.ok(a.id && b.id && a.id !== b.id);
    assert.deepEqual({ ...a, id: 0 }, { id: 0, sidc: INF, label: '1 MRC', x: -800, y: 0, facing: 0, systems: [], hvt: false });
    assert.deepEqual({ ...b, id: 0 }, { id: 0, sidc: '10061000001301000000', label: 'Arty', x: 0, y: -4000, facing: 0, systems: [], hvt: true }, 'defaults: facing 0, no systems');
    assert.deepEqual({ ...first.formation.graphics[0], id: 0 }, { id: 0, kind: 'axisOfAdvance', side: 'hostile', label: 'AXIS', points: [{ x: 0, y: -2000 }, { x: 0, y: 6000 }] }, 'threat graphics default to hostile');
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.payload.changed]), [['threat-model.updated', ['formation']]]);

    const second = okValue(await setTemplate(s, { units: [{ ...a, x: -900 }], graphics: first.formation.graphics }, 2));
    assert.equal(second.formation.units[0].id, a.id, 'an existing id is kept');
    assert.equal(second.formation.units[0].x, -900);
  });

  it('keeps an end position (for plays), a facing, systems and HVT tags', async () => {
    const s = await withModel();
    const sys = okValue(await s.h.dispatch('system.create', { name: 'SA-15', role: 'airDefence', maxRange: 12000 }));
    const m = okValue(await setTemplate(s, { units: [unit({ facing: 45.5, systems: [sys.id], hvt: true, end: { x: 100, y: 3000 } })], graphics: [] }));
    assert.deepEqual({ ...m.formation.units[0], id: 0 }, { id: 0, sidc: INF, label: 'MRC', x: 0, y: 0, facing: 45.5, systems: [sys.id], hvt: true, end: { x: 100, y: 3000 } });
  });

  it('is a no-op when nothing changed', async () => {
    const s = await withModel();
    const m = okValue(await setTemplate(s, { units: [unit()], graphics: [] }));
    s.h.takeEvents();
    const again = okValue(await setTemplate({ ...s, model: m }, m.formation));
    assert.equal(again.revision, m.revision);
    assert.deepEqual(s.h.takeEvents(), []);
  });

  const invalid = [
    ['a malformed SIDC', { units: [unit({ sidc: 'x' })], graphics: [] }, ['template.units[0].sidc']],
    ['an unknown SIDC', { units: [unit({ sidc: UNKNOWN_SIDC })], graphics: [] }, ['template.units[0].sidc']],
    ['a position beyond 200 km', { units: [unit({ x: 200001 })], graphics: [] }, ['template.units[0].x']],
    ['a position that is not a number', { units: [unit({ y: 'north' })], graphics: [] }, ['template.units[0].y']],
    ['a facing of 360 or more', { units: [unit({ facing: 360 })], graphics: [] }, ['template.units[0].facing']],
    ['an unknown system', { units: [unit({ systems: ['sys-404'] })], graphics: [] }, ['template.units[0].systems[0]']],
    ['a bad end position', { units: [unit({ end: { x: 1 } })], graphics: [] }, ['template.units[0].end.y']],
    ['a label over 30 characters', { units: [unit({ label: 'x'.repeat(31) })], graphics: [] }, ['template.units[0].label']],
    ['an unknown unit field', { units: [unit({ lat: 1 })], graphics: [] }, ['template.units[0].lat']],
    ['repeated ids', { units: [unit({ id: 'u1' }), unit({ id: 'u1' })], graphics: [] }, ['template.units[1].id']],
    ['a line with one point', { units: [], graphics: [{ kind: 'route', points: [{ x: 0, y: 0 }] }] }, ['template.graphics[0].points']],
    ['a ring without a radius', { units: [], graphics: [{ kind: 'rangeRing', center: { x: 0, y: 0 } }] }, ['template.graphics[0].radius']],
    ['missing lists', { units: [] }, ['template.graphics']],
  ];
  for (const [what, template, fields] of invalid) {
    it(`refuses ${what}, changing nothing`, async () => {
      const s = await withModel();
      assert.deepEqual(problemFields(errorOf(await setTemplate(s, template), 'VALIDATION_FAILED')).sort(), [...fields].sort());
      assert.equal(okValue(await s.h.query('threat-model.get', { modelId: s.model.id })).revision, 1);
    });
  }

  it('refuses a target other than the formation until threat COAs exist (T-3)', async () => {
    const s = await withModel();
    const error = errorOf(await s.h.dispatch('threat-model.set-template', { modelId: s.model.id, expectedRevision: 1, target: 'coa-x', template: { units: [], graphics: [] } }), 'NOT_FOUND');
    assert.deepEqual(error.details, { modelId: s.model.id, coaId: 'coa-x' });
  });
});
