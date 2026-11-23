// T-3 Threat COAs (IPB step 4): inside a threat model, each COA has a rank, a statement (who, what,
// when, where, why, how), an end state, and its own play: a copy of the formation whose units may have
// an end position (D26). Tested through envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';

const INF = '10061000001211000000';
const STATEMENT = { who: 'MRB(-)', what: 'attacks', when: 'H-hour, dawn', where: 'along AXIS north', why: 'to seize the river crossings', how: 'two MRCs abreast, TK coy in depth, AD umbrella overhead' };

async function withModel() {
  const h = createHarness();
  let model = okValue(await h.dispatch('threat-model.create', { name: 'MRB attack' }));
  model = okValue(await h.dispatch('threat-model.set-template', { modelId: model.id, expectedRevision: 1, target: 'formation', template: {
    units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0 }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }], graphics: [],
  } }));
  h.takeEvents();
  return { h, model };
}
const addCoa = (s, fields, revision = s.model.revision) => s.h.dispatch('threat-coa.add', { modelId: s.model.id, expectedRevision: revision, ...fields });

describe('threat-coa.add', () => {
  it('adds a COA whose play is a copy of the formation (same unit ids), with an empty statement', async () => {
    const s = await withModel();
    const model = okValue(await addCoa(s, { name: 'COA 1 Envelopment', rank: 'mostLikely' }));
    const [coa] = model.coas;
    assert.equal(model.revision, 3);
    assert.deepEqual({ ...coa, id: 0 }, {
      id: 0, name: 'COA 1 Envelopment', rank: 'mostLikely',
      statement: { who: '', what: '', when: '', where: '', why: '', how: '' }, endState: '',
      template: s.model.formation,
    });
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.payload.changed]), [['threat-model.updated', ['coas']]]);
    assert.equal(okValue(await s.h.query('threat-model.list'))[0].coaCount, 1);
  });

  it('ranks "other" by default, and allows only one most likely and one most dangerous', async () => {
    const s = await withModel();
    let m = okValue(await addCoa(s, { name: 'A', rank: 'mostLikely' }));
    m = okValue(await addCoa({ ...s, model: m }, { name: 'B' }));
    assert.equal(m.coas[1].rank, 'other');
    const error = errorOf(await addCoa({ ...s, model: m }, { name: 'C', rank: 'mostLikely' }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(error), ['rank']);
    assert.match(error.details.problems[0].reason, /A is already the most likely/);
    okValue(await addCoa({ ...s, model: m }, { name: 'D', rank: 'mostDangerous' }));
  });

  it('refuses a blank name or an unknown rank', async () => {
    const s = await withModel();
    assert.deepEqual(problemFields(errorOf(await addCoa(s, { name: ' ', rank: 'likely' }), 'VALIDATION_FAILED')).sort(), ['name', 'rank']);
  });
});

describe('threat-coa.update / remove, and the COA play', () => {
  async function withCoa() {
    const s = await withModel();
    const model = okValue(await addCoa(s, { name: 'COA 1', rank: 'mostLikely' }));
    s.h.takeEvents();
    return { ...s, model, coaId: model.coas[0].id };
  }
  const update = (s, fields, revision = s.model.revision) => s.h.dispatch('threat-coa.update', { modelId: s.model.id, expectedRevision: revision, coaId: s.coaId, ...fields });

  it('writes the statement and end state (trimmed), renames and re-ranks', async () => {
    const s = await withCoa();
    const m = okValue(await update(s, { statement: { ...STATEMENT, who: '  MRB(-) ' }, endState: 'Crossings held; bridgehead 5 km deep', name: 'COA 1 Envelopment', rank: 'mostDangerous' }));
    assert.deepEqual(m.coas[0].statement, STATEMENT);
    assert.deepEqual([m.coas[0].endState, m.coas[0].name, m.coas[0].rank], ['Crossings held; bridgehead 5 km deep', 'COA 1 Envelopment', 'mostDangerous']);
    assert.deepEqual(s.h.takeEvents().map((e) => e.payload.changed), [['coas']]);
  });

  it('a partial statement keeps the other parts; a no-op changes nothing', async () => {
    const s = await withCoa();
    const m1 = okValue(await update(s, { statement: STATEMENT }));
    const m2 = okValue(await update({ ...s, model: m1 }, { statement: { why: 'to fix 2 BCT' } }));
    assert.deepEqual(m2.coas[0].statement, { ...STATEMENT, why: 'to fix 2 BCT' });
    s.h.takeEvents();
    const m3 = okValue(await update({ ...s, model: m2 }, { name: 'COA 1' }));
    assert.equal(m3.revision, m2.revision);
    assert.deepEqual(s.h.takeEvents(), []);
  });

  it('refuses unknown statement parts and overlong text', async () => {
    const s = await withCoa();
    assert.deepEqual(problemFields(errorOf(await update(s, { statement: { whom: 'x', how: 'y'.repeat(1001) } }), 'VALIDATION_FAILED')).sort(), ['statement.how', 'statement.whom']);
    assert.deepEqual(problemFields(errorOf(await update(s, { endState: 'z'.repeat(1001) }), 'VALIDATION_FAILED')), ['endState']);
  });

  it('is NOT_FOUND for an unknown COA, and CONFLICT for a stale revision', async () => {
    const s = await withCoa();
    assert.deepEqual(errorOf(await update({ ...s, coaId: 'tc-404' }, { name: 'X' }), 'NOT_FOUND').details, { modelId: s.model.id, coaId: 'tc-404' });
    errorOf(await update(s, { name: 'X' }, 1), 'CONFLICT');
  });

  it('a COA\'s play is set with set-template: units can get an end position; the formation is untouched', async () => {
    const s = await withCoa();
    const play = { units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0, end: { x: -1500, y: 6000 } }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }], graphics: [] };
    const m = okValue(await s.h.dispatch('threat-model.set-template', { modelId: s.model.id, expectedRevision: s.model.revision, target: s.coaId, template: play }));
    assert.deepEqual(m.coas[0].template.units[0].end, { x: -1500, y: 6000 });
    assert.equal(m.formation.units[0].end, undefined);
    assert.deepEqual(s.h.takeEvents().map((e) => e.payload.changed), [['coas']]);
  });

  it('removes a COA', async () => {
    const s = await withCoa();
    const m = okValue(await s.h.dispatch('threat-coa.remove', { modelId: s.model.id, expectedRevision: s.model.revision, coaId: s.coaId }));
    assert.deepEqual(m.coas, []);
    errorOf(await s.h.dispatch('threat-coa.remove', { modelId: s.model.id, expectedRevision: m.revision, coaId: s.coaId }), 'NOT_FOUND');
  });

  it('keeps COAs through storage', async () => {
    const s = await withCoa();
    okValue(await update(s, { statement: STATEMENT }));
    const got = okValue(await s.h.query('threat-model.get', { modelId: s.model.id }));
    assert.deepEqual(got.coas[0].statement, STATEMENT);
    assert.deepEqual(got.coas[0].template, s.model.formation);
  });
});
