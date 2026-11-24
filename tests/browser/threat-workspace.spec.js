// T-2b: the Threat models workspace — models, the template canvas drawn to scale in metres, and the
// template editor (units with weapons and HVT tags, lines and areas).
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createThreatModelStore } from '../../src/adapters/ui/threat-model-store.js';
import { mountTemplateCanvas } from '../../src/adapters/ui/views/template-canvas.js';
import { mountThreatModelsView } from '../../src/adapters/ui/views/threat-models-view.js';
import { mountTemplateEditorView } from '../../src/adapters/ui/views/template-editor-view.js';

const L = window.L;
const INF = '10061000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

async function setup({ withModel = true } = {}) {
  const fixture = createTestApp();
  const sa15 = (await fixture.client.send('system.create', { name: 'SA-15', role: 'airDefence', maxRange: 12000 })).value;
  const gun = (await fixture.client.send('system.create', { name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 })).value;
  // A unit template carrying the SA-15, so the weapons list can copy it (D29).
  await fixture.client.send('unit-template.create', { name: 'AD Bty', sidc: '10061000001301000000', label: 'AD', hvt: true, weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 12000 }], details: { strength: '4 TELAR' } });
  const model = withModel ? (await fixture.client.send('threat-model.create', { name: 'MRB attack' })).value : null;
  const modelSelection = createSelection(model?.id ?? null);
  const unitSelection = createSelection();
  const store = createThreatModelStore({ client: fixture.client, modelSelection });
  const host = sandbox();
  const panel = document.createElement('div');
  const list = document.createElement('div');
  const canvasEl = document.createElement('div');
  canvasEl.style.cssText = 'width: 800px; height: 600px;';
  host.append(list, panel, canvasEl);
  const canvas = mountTemplateCanvas({ client: fixture.client, L, container: canvasEl, store, unitSelection });
  const modelsView = mountThreatModelsView({ client: fixture.client, root: list, modelSelection, store });
  const editor = mountTemplateEditorView({ client: fixture.client, root: panel, store, unitSelection, canvas });
  cleanups.push(() => { editor.destroy(); modelsView.destroy(); canvas.destroy(); store.destroy(); host.remove(); });
  await Promise.all([store.ready, canvas.ready, modelsView.ready, editor.ready]);
  const stored = async () => (await fixture.client.ask('threat-model.get', { modelId: modelSelection.get() })).value;
  const setFormation = async (template) => {
    const m = await stored();
    return fixture.client.send('threat-model.set-template', { modelId: m.id, expectedRevision: m.revision, target: 'formation', template });
  };
  return { ...fixture, sa15, gun, model, modelSelection, unitSelection, store, canvas, canvasEl, panel, list, stored, setFormation };
}
const field = (root, name) => root.querySelector(`[name="${name}"]`);
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const markerFor = (root, id) => root.querySelector(`.template-unit[data-unit-id="${id}"]`);
const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };

describe('threat models panel', () => {
  it('creates, lists and selects threat models', async () => {
    const { list, modelSelection, client } = await setup({ withModel: false });
    assert.match(list.textContent, /No threat models yet/);
    type(field(list, 'model-name'), 'AD umbrella');
    list.querySelector('[data-new-model]').requestSubmit();
    await waitFor(() => texts(list, '[data-model-id] .model-name').join() === 'AD umbrella');
    const [m] = (await client.ask('threat-model.list')).value;
    await waitFor(() => modelSelection.get() === m.id, { message: 'a new model is selected' });
  });

  it('renames and describes the selected model, and deletes it', async () => {
    const { list, client, model, modelSelection } = await setup();
    await waitFor(() => field(list, 'model-description'));
    type(field(list, 'model-title'), 'MRB in the attack');
    type(field(list, 'model-description'), 'Forward detachment leads; main body 10 km behind.');
    button(list, 'Save').click();
    await waitFor(async () => (await client.ask('threat-model.get', { modelId: model.id })).value.description.startsWith('Forward'));
    button(list, 'Delete model').click();
    list.querySelector('dialog[open] button.danger').click();
    await waitFor(async () => (await client.ask('threat-model.list')).value.length === 0);
    await waitFor(() => modelSelection.get() === null);
  });
});

describe('template canvas (metres, no terrain)', () => {
  it('shows the reference point, the direction of attack, a scale bar and a metric grid', async () => {
    const { canvasEl } = await setup();
    assert.ok(canvasEl.querySelector('.template-origin'));
    assert.match(canvasEl.textContent, /Direction of attack/i);
    assert.ok(canvasEl.querySelector('.leaflet-control-scale'));
    assert.ok(canvasEl.querySelectorAll('.template-grid-line').length > 4);
  });

  it('places units to scale: 1000 m apart is the scale\'s pixels apart, east is right and attack is up', async () => {
    const { canvasEl, canvas, setFormation } = await setup();
    await setFormation({ units: [{ id: 'a', sidc: INF, x: 0, y: 0 }, { id: 'b', sidc: INF, x: 1000, y: 0 }, { id: 'c', sidc: INF, x: 0, y: 1000 }], graphics: [] });
    await waitFor(() => canvasEl.querySelectorAll('.template-unit').length === 3);
    canvas.map.setView([0, 0], -2, { animate: false });
    await frames();
    const pxPerMetre = 2 ** canvas.map.getZoom();
    const [a, b, c] = ['a', 'b', 'c'].map((id) => center(markerFor(canvasEl, id).querySelector('svg') ?? markerFor(canvasEl, id)));
    assert.ok(Math.abs((b.x - a.x) - 1000 * pxPerMetre) < 2, `east: ${b.x - a.x} vs ${1000 * pxPerMetre}`);
    assert.ok(Math.abs((a.y - c.y) - 1000 * pxPerMetre) < 2, `up: ${a.y - c.y}`);
  });

  it('shows frontage and depth of the formation', async () => {
    const { canvasEl, setFormation } = await setup();
    await setFormation({ units: [{ sidc: INF, x: -800, y: 0 }, { sidc: INF, x: 800, y: 200 }, { sidc: INF, x: 0, y: -4000 }], graphics: [] });
    await waitFor(() => /Frontage 1\.6 km.*Depth 4\.2 km/.test(canvasEl.querySelector('[data-extent]').textContent));
  });

  it('draws each unit\'s systems to scale: a ring for all-round air defence, a sector for an arc', async () => {
    const { canvasEl, canvas, setFormation, sa15, gun } = await setup();
    await setFormation({ units: [{ id: 'ad', sidc: INF, x: 0, y: 0, systems: [sa15.id] }, { id: 'tank', sidc: INF, x: 3000, y: 0, facing: 90, systems: [gun.id] }], graphics: [] });
    canvas.map.setView([0, 0], -6, { animate: false });
    await waitFor(() => canvasEl.querySelectorAll('path.coverage').length === 2);
    const ring = canvasEl.querySelector('path.coverage-ring');
    const r = ring.getBoundingClientRect();
    const expected = 2 * 12000 * 2 ** canvas.map.getZoom();
    assert.ok(Math.abs(r.width - expected) < 3, `ring ${r.width} vs ${expected}`);
    assert.ok(canvasEl.querySelector('path.coverage-sector'));
  });

  it('Fit zooms to the whole formation including its coverage', async () => {
    const { canvasEl, canvas, setFormation, sa15 } = await setup();
    await setFormation({ units: [{ id: 'ad', sidc: INF, x: 0, y: -4500, systems: [sa15.id] }], graphics: [] });
    await waitFor(() => canvasEl.querySelector('path.coverage-ring'));
    canvas.map.setView([0, 0], 1, { animate: false });
    [...canvasEl.querySelectorAll('button')].find((b) => b.textContent === 'Fit').click();
    const b = canvas.map.getBounds();
    assert.ok(b.contains([-4500 - 12000, 0]) && b.contains([-4500 + 12000, 0]) && b.contains([-4500, 12000]), 'the 12 km ring is in view');
  });

  it('marks HVTs', async () => {
    const { canvasEl, setFormation } = await setup();
    await setFormation({ units: [{ id: 'h', sidc: INF, x: 0, y: 0, hvt: true }, { id: 'n', sidc: INF, x: 500, y: 0 }], graphics: [] });
    await waitFor(() => markerFor(canvasEl, 'h') && markerFor(canvasEl, 'n'));
    assert.ok(markerFor(canvasEl, 'h').classList.contains('is-hvt'));
    assert.ok(!markerFor(canvasEl, 'n').classList.contains('is-hvt'));
  });

  it('shows template lines and areas', async () => {
    const { canvasEl, setFormation } = await setup();
    await setFormation({ units: [], graphics: [{ kind: 'axisOfAdvance', label: 'AXIS', points: [{ x: 0, y: -1000 }, { x: 0, y: 5000 }] }] });
    await waitFor(() => canvasEl.querySelectorAll('path.template-graphic').length === 1);
  });
});

describe('template editor', () => {
  it('adds a unit at typed x / y with a label, weapons (copied from a unit template or typed) and an HVT tag', async () => {
    const { panel, stored, sa15 } = await setup();
    button(panel, 'Add unit').click();
    await waitFor(() => field(panel, 'unit-x'));
    choose(field(panel, 'affiliation'), '6');
    choose(field(panel, 'unitType'), '130100');
    type(field(panel, 'unit-label'), 'AD Bty');
    type(field(panel, 'unit-x'), '-1200');
    type(field(panel, 'unit-y'), '-3000');
    type(field(panel, 'unit-facing'), '0');
    choose(field(panel, 'unit-weapons-pick'), '0'); // the SA-15, carried by the AD Bty template
    type(field(panel, 'unit-weapons-name'), 'ATGM');
    choose(field(panel, 'unit-weapons-role'), 'direct');
    type(field(panel, 'unit-weapons-max'), '4');
    type(field(panel, 'unit-weapons-arc'), '90');
    button(panel, 'Add weapon').click();
    assert.equal(panel.querySelectorAll('[data-weapons] .weapon-row').length, 2);
    field(panel, 'unit-hvt').click();
    button(panel, 'Save').click();
    await waitFor(async () => (await stored()).formation.units.length === 1);
    const [u] = (await stored()).formation.units;
    assert.deepEqual([u.label, u.x, u.y, u.hvt, u.sidc.slice(3, 4)], ['AD Bty', -1200, -3000, true, '6']);
    assert.deepEqual(u.weapons, [{ name: 'SA-15', role: 'airDefence', maxRange: 12000, arc: 360 }, { name: 'ATGM', role: 'direct', maxRange: 4000, arc: 90 }]);
  });

  it('starts a new unit from a unit template: symbol, label, HVT, weapons and details are copied', async () => {
    const { panel, stored } = await setup();
    button(panel, 'Add unit').click();
    await waitFor(() => field(panel, 'unit-template'));
    const option = [...field(panel, 'unit-template').options].find((o) => o.textContent === 'AD Bty');
    choose(field(panel, 'unit-template'), option.value);
    type(field(panel, 'unit-x'), '0');
    type(field(panel, 'unit-y'), '-4000');
    button(panel, 'Save').click();
    await waitFor(async () => (await stored()).formation.units.length === 1);
    const [u] = (await stored()).formation.units;
    assert.deepEqual([u.sidc, u.label, u.hvt, u.weapons.map((w) => w.name), u.details], ['10061000001301000000', 'AD', true, ['SA-15'], { strength: '4 TELAR' }]);
  });

  it('lists units and edits the selected one, showing problems by field', async () => {
    const { panel, stored, setFormation, unitSelection } = await setup();
    await setFormation({ units: [{ id: 'u1', sidc: INF, label: 'MRC', x: 0, y: 0 }], graphics: [] });
    await waitFor(() => texts(panel, '[data-unit-row] .unit-name').join() === 'MRC');
    panel.querySelector('[data-unit-row] button').click();
    assert.equal(unitSelection.get(), 'u1');
    await waitFor(() => field(panel, 'unit-x')?.value === '0');
    type(field(panel, 'unit-x'), '999999');
    button(panel, 'Save').click();
    await waitFor(() => /200000/.test(panel.textContent) || /200 km/.test(panel.textContent));
    type(field(panel, 'unit-x'), '400');
    button(panel, 'Save').click();
    await waitFor(async () => (await stored()).formation.units[0].x === 400);
  });

  it('places a unit by clicking the canvas', async () => {
    const { panel, canvas, stored } = await setup();
    button(panel, 'Add unit').click();
    await waitFor(() => button(panel, 'Pick on canvas'));
    button(panel, 'Pick on canvas').click();
    canvas.map.fire('click', { latlng: L.latLng(2500, -700) });
    await waitFor(() => field(panel, 'unit-x').value === '-700' && field(panel, 'unit-y').value === '2500');
    button(panel, 'Save').click();
    await waitFor(async () => (await stored()).formation.units.length === 1);
  });

  it('removes a unit', async () => {
    const { panel, stored, setFormation } = await setup();
    await setFormation({ units: [{ id: 'u1', sidc: INF, label: 'MRC', x: 0, y: 0 }], graphics: [] });
    await waitFor(() => panel.querySelector('[data-unit-row] button'));
    panel.querySelector('[data-unit-row] button').click();
    await waitFor(() => button(panel, 'Remove unit'));
    button(panel, 'Remove unit').click();
    await waitFor(async () => (await stored()).formation.units.length === 0);
  });

  it('draws a line on the canvas, stored in metres', async () => {
    const { panel, canvas, stored } = await setup();
    choose(field(panel, 'template-draw-kind'), 'axisOfAdvance');
    type(field(panel, 'template-draw-label'), 'AXIS');
    button(panel, 'Draw').click();
    canvas.map.fire('click', { latlng: L.latLng(-1000, 0) });
    canvas.map.fire('click', { latlng: L.latLng(4000, 500) });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(async () => (await stored()).formation.graphics.length === 1);
    const [g] = (await stored()).formation.graphics;
    assert.deepEqual([g.kind, g.label, g.side, g.points], ['axisOfAdvance', 'AXIS', 'hostile', [{ x: 0, y: -1000 }, { x: 500, y: 4000 }]]);
  });

  it('asks for a threat model when none is selected', async () => {
    const { panel } = await setup({ withModel: false });
    assert.match(panel.textContent, /Select or create a threat model/);
  });
});
