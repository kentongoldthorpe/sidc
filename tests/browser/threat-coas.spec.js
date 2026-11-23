// T-3 Threat COAs: statements, ranks, and plays with start and end positions (D26) on the canvas.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { drag } from './pointer.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createThreatModelStore } from '../../src/adapters/ui/threat-model-store.js';
import { mountTemplateCanvas } from '../../src/adapters/ui/views/template-canvas.js';
import { mountTemplateEditorView } from '../../src/adapters/ui/views/template-editor-view.js';
import { mountThreatCoasView } from '../../src/adapters/ui/views/threat-coas-view.js';

const INF = '10061000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

async function setup() {
  const fixture = createTestApp();
  let model = (await fixture.client.send('threat-model.create', { name: 'MRB attack' })).value;
  model = (await fixture.client.send('threat-model.set-template', { modelId: model.id, expectedRevision: 1, target: 'formation', template: {
    units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0 }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }], graphics: [],
  } })).value;
  const modelSelection = createSelection(model.id);
  const playSelection = createSelection('formation');
  const unitSelection = createSelection();
  const store = createThreatModelStore({ client: fixture.client, modelSelection, playSelection });
  const host = sandbox();
  const coasEl = document.createElement('div');
  const editorEl = document.createElement('div');
  const canvasEl = document.createElement('div');
  canvasEl.style.cssText = 'width: 800px; height: 600px;';
  host.append(coasEl, editorEl, canvasEl);
  const canvas = mountTemplateCanvas({ client: fixture.client, L: window.L, container: canvasEl, store, unitSelection });
  const editor = mountTemplateEditorView({ client: fixture.client, root: editorEl, store, unitSelection, canvas });
  const coas = mountThreatCoasView({ client: fixture.client, root: coasEl, store });
  cleanups.push(() => { coas.destroy(); editor.destroy(); canvas.destroy(); store.destroy(); host.remove(); });
  await Promise.all([store.ready, canvas.ready, editor.ready, coas.ready]);
  const stored = async () => (await fixture.client.ask('threat-model.get', { modelId: model.id })).value;
  return { ...fixture, model, playSelection, unitSelection, canvas, canvasEl, coasEl, editorEl, stored };
}
const field = (root, name) => root.querySelector(`[name="${name}"]`);
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };

async function addCoa(s, name, rank = 'other') {
  type(field(s.coasEl, 'coa-name'), name);
  choose(field(s.coasEl, 'coa-rank'), rank);
  s.coasEl.querySelector('[data-new-threat-coa]').requestSubmit();
  await waitFor(async () => (await s.stored()).coas.some((c) => c.name === name));
  return (await s.stored()).coas.find((c) => c.name === name);
}

describe('threat COAs panel', () => {
  it('lists the formation, adds a COA (a copy of the formation), selects its play, and badges its rank', async () => {
    const s = await setup();
    assert.deepEqual(texts(s.coasEl, '[data-play-id] .play-name'), ['Formation']);
    const coa = await addCoa(s, 'COA 1 Envelopment', 'mostLikely');
    await waitFor(() => s.playSelection.get() === coa.id);
    assert.match(s.coasEl.querySelector(`[data-play-id="${coa.id}"]`).textContent, /COA 1 Envelopment.*MLCOA/);
    await waitFor(() => /Editing the play of COA 1 Envelopment/.test(s.editorEl.textContent));
    assert.equal(s.canvasEl.querySelectorAll('.template-unit').length, 2, 'the play starts with the formation\'s units');
  });

  it('writes the COA statement and end state', async () => {
    const s = await setup();
    await addCoa(s, 'COA 1');
    await waitFor(() => field(s.coasEl, 'statement-who'));
    type(field(s.coasEl, 'statement-who'), 'MRB(-)');
    type(field(s.coasEl, 'statement-why'), 'to seize the crossings');
    type(field(s.coasEl, 'coa-end-state'), 'Bridgehead 5 km deep');
    button(s.coasEl, 'Save').click();
    await waitFor(async () => (await s.stored()).coas[0].statement.who === 'MRB(-)');
    const [c] = (await s.stored()).coas;
    assert.deepEqual([c.statement.why, c.endState, c.statement.how], ['to seize the crossings', 'Bridgehead 5 km deep', '']);
  });

  it('explains when a rank is already taken', async () => {
    const s = await setup();
    await addCoa(s, 'COA 1', 'mostLikely');
    type(field(s.coasEl, 'coa-name'), 'COA 2');
    choose(field(s.coasEl, 'coa-rank'), 'mostLikely');
    s.coasEl.querySelector('[data-new-threat-coa]').requestSubmit();
    await waitFor(() => /COA 1 is already the most likely/.test(s.coasEl.textContent));
  });

  it('deletes a COA and goes back to the formation', async () => {
    const s = await setup();
    await addCoa(s, 'COA 1');
    await waitFor(() => button(s.coasEl, 'Delete COA'));
    button(s.coasEl, 'Delete COA').click();
    s.coasEl.querySelector('dialog[open] button.danger').click();
    await waitFor(async () => (await s.stored()).coas.length === 0);
    await waitFor(() => s.playSelection.get() === 'formation');
  });
});

describe('plays: moves with start and end positions (D26)', () => {
  it('gives a unit an end position in the play: start faded, an arrow, the end solid; the formation is untouched', async () => {
    const s = await setup();
    await addCoa(s, 'COA 1');
    await waitFor(() => /Editing the play of COA 1/.test(s.editorEl.textContent));
    s.editorEl.querySelector('[data-unit-row="u1"] button').click();
    await waitFor(() => field(s.editorEl, 'end-x'));
    type(field(s.editorEl, 'end-x'), '-1500');
    type(field(s.editorEl, 'end-y'), '6000');
    button(s.editorEl, 'Save').click();
    await waitFor(async () => (await s.stored()).coas[0].template.units[0].end?.y === 6000);
    assert.equal((await s.stored()).formation.units[0].end, undefined);
    await waitFor(() => s.canvasEl.querySelector('.template-unit.is-start[data-start-of="u1"]') && s.canvasEl.querySelector('.template-unit.is-end[data-unit-id="u1"]'));
    assert.ok(s.canvasEl.querySelector('path.template-move'));
    assert.ok(s.canvasEl.querySelector('.template-move-head'));
    assert.match(s.editorEl.querySelector('[data-unit-row="u1"]').textContent, /→ -1500, 6000 m/);
  });

  it('the end marker is dragged to change the end; "No movement" removes it', async () => {
    const s = await setup();
    const coa = await addCoa(s, 'COA 1');
    const m = await s.stored();
    await s.client.send('threat-model.set-template', { modelId: m.id, expectedRevision: m.revision, target: coa.id, template: {
      units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0, end: { x: -900, y: 3000 } }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }], graphics: [],
    } });
    await waitFor(() => s.canvasEl.querySelector('.template-unit.is-end[data-unit-id="u1"]'));
    s.canvas.map.setView([1500, 0], -3, { animate: false });
    await frames();
    await drag(s.canvasEl.querySelector('.template-unit.is-end[data-unit-id="u1"]'), 50, 0);
    await waitFor(async () => (await s.stored()).coas[0].template.units[0].end.x > -900);
    assert.equal((await s.stored()).coas[0].template.units[0].x, -900, 'the start stays');

    s.editorEl.querySelector('[data-unit-row="u1"] button').click();
    await waitFor(() => button(s.editorEl, 'No movement'));
    button(s.editorEl, 'No movement').click();
    button(s.editorEl, 'Save').click();
    await waitFor(async () => (await s.stored()).coas[0].template.units[0].end === undefined);
  });

  it('the formation has no end-position fields', async () => {
    const s = await setup();
    s.editorEl.querySelector('[data-unit-row="u1"] button').click();
    await waitFor(() => field(s.editorEl, 'unit-x'));
    assert.equal(field(s.editorEl, 'end-x'), null);
    assert.match(s.editorEl.textContent, /Editing the formation/);
  });
});
