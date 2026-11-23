// COA-8.2: lines, areas and range rings on the map — drawing (draw tool), showing and editing
// (graphics layer) and the "Lines & areas" panel section, against a real application.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { mountGraphicsLayer } from '../../src/adapters/ui/views/graphics-layer.js';
import { mountDrawTool } from '../../src/adapters/ui/views/draw-tool.js';
import { mountGraphicsView } from '../../src/adapters/ui/views/graphics-view.js';
import { createDrawer } from '../../src/adapters/ui/map-drawer.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { drag } from './pointer.js';

const L = window.L;
const PL = [{ lat: 1, lng: 1 }, { lat: 2, lng: 3 }];
const OBJ = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 2, lng: 2 }];
let host; let map; let mounted = [];
afterEach(() => { mounted.forEach((m) => m.destroy()); mounted = []; map?.remove(); host?.remove(); map = null; host = null; });

async function setup({ graphics = [] } = {}) {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  for (const g of graphics) await fixture.client.send('graphic.add', { coaId: coa.id, ...g });
  const selection = createSelection(coa.id);
  const graphicSelection = createSelection();
  const drawer = createDrawer();
  host = sandbox();
  const panel = document.createElement('div');
  const container = document.createElement('div');
  container.style.cssText = 'width: 800px; height: 600px;';
  host.append(panel, container);
  map = L.map(container, { center: [1, 1], zoom: 6, animate: false });
  const ctx = { client: fixture.client, L, map, selection, graphicSelection, drawer };
  const layer = mountGraphicsLayer(ctx);
  const tool = mountDrawTool({ L, map, drawer });
  const view = mountGraphicsView({ ...ctx, root: panel });
  mounted.push(layer, tool, view);
  await Promise.all([layer.ready, view.ready]);
  const stored = async () => (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
  return { ...fixture, coa, selection, graphicSelection, drawer, panel, container, stored };
}

const paths = (container) => [...container.querySelectorAll('path.graphic')];
const pathFor = (container, id) => container.querySelector(`path.graphic[data-graphic-id="${id}"]`);
const click = (lat, lng) => map.fire('click', { latlng: L.latLng(lat, lng) });
const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const field = (panel, name) => panel.querySelector(`[name="${name}"]`);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };


describe('graphics layer: showing lines, areas and range rings', () => {
  it('draws each graphic in its side colour (or its own colour), hostile ones dashed, areas filled', async () => {
    const { container, stored } = await setup({ graphics: [
      { expectedRevision: 1, kind: 'phaseLine', points: PL, label: 'PL GOLD' },
      { expectedRevision: 2, kind: 'objective', points: OBJ, side: 'hostile', label: 'OBJ IRON' },
      { expectedRevision: 3, kind: 'rangeRing', center: { lat: 1, lng: 1 }, radius: 50000, color: '#000000' },
    ] });
    const [line, area, ring] = (await stored()).graphics;
    await waitFor(() => paths(container).length === 3);
    assert.equal(pathFor(container, line.id).getAttribute('stroke'), '#1f4fbf');
    assert.equal(pathFor(container, line.id).getAttribute('fill'), 'none');
    assert.equal(pathFor(container, area.id).getAttribute('stroke'), '#d0021b');
    assert.ok(pathFor(container, area.id).getAttribute('stroke-dasharray'), 'hostile is dashed');
    assert.notEqual(pathFor(container, area.id).getAttribute('fill'), 'none');
    assert.equal(pathFor(container, ring.id).getAttribute('stroke'), '#000000');
    assert.deepEqual(texts(container, '.graphic-label').sort(), ['OBJ IRON', 'PL GOLD']);
  });

  it('shows labels as plain text, never as HTML (labels can come from import files)', async () => {
    window.__labelInjected = false;
    const evil = '<img src=x onerror=__labelInjected=1>'; // within the 40-character label limit
    const { container } = await setup({ graphics: [
      { expectedRevision: 1, kind: 'route', points: PL, label: evil },
      { expectedRevision: 2, kind: 'rangeRing', center: { lat: 1, lng: 1 }, radius: 5000, label: evil },
    ] });
    await waitFor(() => container.querySelectorAll('.graphic-label').length === 2);
    await frames(3);
    assert.deepEqual(texts(container, '.graphic-label'), [evil, evil]);
    assert.equal(container.querySelector('.graphic-label img'), null);
    assert.equal(window.__labelInjected, false, 'script in a label ran');
  });

  it('puts an arrowhead at the end of an axis of advance', async () => {
    const { container } = await setup({ graphics: [{ expectedRevision: 1, kind: 'axisOfAdvance', points: PL }] });
    await waitFor(() => container.querySelector('.graphic-arrow'));
  });

  it('redraws when graphics change, and clears when no COA is selected', async () => {
    const { container, client, coa, selection } = await setup();
    assert.equal(paths(container).length, 0);
    await client.send('graphic.add', { coaId: coa.id, kind: 'route', points: PL });
    await waitFor(() => paths(container).length === 1);
    selection.set(null);
    await waitFor(() => paths(container).length === 0);
  });

  it('selects a graphic when it is clicked, and shows handles on its points', async () => {
    const { container, graphicSelection, stored } = await setup({ graphics: [{ expectedRevision: 1, kind: 'route', points: PL }] });
    const [g] = (await stored()).graphics;
    await waitFor(() => pathFor(container, g.id));
    pathFor(container, g.id).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    assert.equal(graphicSelection.get(), g.id);
    await waitFor(() => container.querySelectorAll('.graphic-handle:not(.is-mid)').length === 2);
    assert.equal(container.querySelectorAll('.graphic-handle.is-mid').length, 1);
  });

  it('hides the label of the selected graphic, so it never covers the handles', async () => {
    const { container, graphicSelection, stored } = await setup({ graphics: [{ expectedRevision: 1, kind: 'route', points: PL, label: 'MSR TAMPA' }] });
    const [g] = (await stored()).graphics;
    await waitFor(() => texts(container, '.graphic-label').join() === 'MSR TAMPA');
    graphicSelection.set(g.id);
    await waitFor(() => container.querySelectorAll('.graphic-label').length === 0);
    graphicSelection.set(null);
    await waitFor(() => texts(container, '.graphic-label').join() === 'MSR TAMPA');
  });

  it('dragging a point handle saves the moved point; dragging a midpoint inserts one', async () => {
    const { container, graphicSelection, stored } = await setup({ graphics: [{ expectedRevision: 1, kind: 'route', points: PL }] });
    const [g] = (await stored()).graphics;
    graphicSelection.set(g.id);
    await waitFor(() => container.querySelectorAll('.graphic-handle').length === 3);
    await frames();
    await drag(container.querySelector('.graphic-handle:not(.is-mid)'), 40, 0);
    await waitFor(async () => (await stored()).revision === 3);
    const moved = (await stored()).graphics[0].points;
    assert.ok(moved[0].lng > PL[0].lng + 0.1, JSON.stringify(moved));
    assert.deepEqual(moved[1], PL[1]);

    await waitFor(() => container.querySelectorAll('.graphic-handle.is-mid').length === 1);
    await frames();
    await drag(container.querySelector('.graphic-handle.is-mid'), 0, 30);
    await waitFor(async () => (await stored()).graphics[0].points.length === 3);
  });

  it('right-clicking a point handle removes the point, but never below the minimum', async () => {
    const { container, graphicSelection, stored } = await setup({ graphics: [{ expectedRevision: 1, kind: 'route', points: [...PL, { lat: 3, lng: 4 }] }] });
    const [g] = (await stored()).graphics;
    graphicSelection.set(g.id);
    await waitFor(() => container.querySelectorAll('.graphic-handle:not(.is-mid)').length === 3);
    container.querySelector('.graphic-handle:not(.is-mid)').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await waitFor(async () => (await stored()).graphics[0].points.length === 2);
    await waitFor(() => container.querySelectorAll('.graphic-handle:not(.is-mid)').length === 2);
    container.querySelector('.graphic-handle:not(.is-mid)').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await frames(5);
    assert.equal((await stored()).graphics[0].points.length, 2);
  });

  it('a range ring has a centre handle and a radius handle', async () => {
    const { container, graphicSelection, stored } = await setup({ graphics: [{ expectedRevision: 1, kind: 'rangeRing', center: { lat: 1, lng: 1 }, radius: 50000 }] });
    const [g] = (await stored()).graphics;
    graphicSelection.set(g.id);
    await waitFor(() => container.querySelectorAll('.graphic-handle').length === 2);
    await frames();
    await drag(container.querySelector('.graphic-handle.is-radius'), 60, 0);
    await waitFor(async () => (await stored()).graphics[0].radius > 60000);
  });
});

describe('draw tool', () => {
  const drawn = (drawer, request) => new Promise((resolve) => drawer.request(request, resolve));

  it('collects clicked points for a line; a double-click finishes without doubling the last point', async () => {
    const { drawer } = await setup();
    const result = drawn(drawer, { shape: 'line' });
    click(1, 1); click(2, 2); click(3, 3); click(3, 3);
    map.fire('dblclick', { latlng: L.latLng(3, 3) });
    assert.deepEqual(await result, { points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }] });
    assert.equal(drawer.isActive(), false);
  });

  it('Enter finishes, Backspace removes the last point, Esc cancels; too few points do not finish', async () => {
    const { drawer } = await setup();
    let done = null;
    drawer.request({ shape: 'area' }, (g) => { done = g; });
    click(0, 0); click(0, 1);
    key('Enter');
    assert.equal(done, null, 'an area needs three points');
    click(5, 5); key('Backspace'); click(1, 1);
    key('Enter');
    assert.deepEqual(done, { points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }] });

    let cancelled = 'not called';
    drawer.request({ shape: 'line' }, (g) => { cancelled = g; });
    click(0, 0);
    key('Escape');
    assert.equal(cancelled, 'not called');
    assert.equal(drawer.isActive(), false);
  });

  it('a range ring is a centre click then a radius click, or just a centre with a typed radius', async () => {
    const { drawer } = await setup();
    const ring = drawn(drawer, { shape: 'circle' });
    click(0, 0); click(0, 1);
    const { center, radius } = await ring;
    assert.deepEqual(center, { lat: 0, lng: 0 });
    assert.ok(Math.abs(radius - 111195) < 500, String(radius));
    assert.deepEqual(await (() => { const r = drawn(drawer, { shape: 'circle', radius: 5000 }); click(2, 2); return r; })(), { center: { lat: 2, lng: 2 }, radius: 5000 });
  });

  it('shows what to do while drawing, with a Cancel button', async () => {
    const { drawer, container } = await setup();
    drawer.request({ shape: 'line' }, () => {});
    assert.match(container.querySelector('[data-draw-hint]').textContent, /double-click or press Enter to finish/i);
    button(container.querySelector('[data-draw-hint]'), 'Cancel').click();
    assert.equal(drawer.isActive(), false);
    assert.equal(container.querySelector('[data-draw-hint]'), null);
  });
});

describe('Lines & areas panel section', () => {
  it('draws a new phase line with the chosen side and label, and selects it', async () => {
    const { panel, stored, graphicSelection } = await setup();
    choose(field(panel, 'draw-kind'), 'phaseLine');
    choose(field(panel, 'draw-side'), 'hostile');
    type(field(panel, 'draw-label'), 'PL RED');
    button(panel, 'Draw').click();
    click(1, 1); click(2, 2); key('Enter');
    await waitFor(async () => (await stored()).graphics.length === 1);
    const [g] = (await stored()).graphics;
    assert.deepEqual([g.kind, g.side, g.label, g.points.length], ['phaseLine', 'hostile', 'PL RED', 2]);
    await waitFor(() => graphicSelection.get() === g.id);
  });

  it('draws a range ring with a typed radius in km', async () => {
    const { panel, stored } = await setup();
    const radiusShown = () => getComputedStyle(field(panel, 'draw-radius').closest('label')).display !== 'none';
    choose(field(panel, 'draw-kind'), 'phaseLine');
    assert.equal(radiusShown(), false, 'no radius for a line (hidden must win over .field display)');
    choose(field(panel, 'draw-kind'), 'rangeRing');
    assert.ok(radiusShown(), 'radius shown for rings');
    type(field(panel, 'draw-radius'), '12.5');
    button(panel, 'Draw').click();
    click(1, 1);
    await waitFor(async () => (await stored()).graphics.length === 1);
    assert.equal((await stored()).graphics[0].radius, 12500);
  });

  it('lists graphics by label or kind, and edits the selected one (only changed fields)', async () => {
    const { panel, stored, graphicSelection } = await setup({ graphics: [
      { expectedRevision: 1, kind: 'phaseLine', points: PL, label: 'PL GOLD' },
      { expectedRevision: 2, kind: 'objective', points: OBJ },
    ] });
    await waitFor(() => texts(panel, '[data-graphic-item] .graphic-name').length === 2);
    assert.deepEqual(texts(panel, '[data-graphic-item] .graphic-name'), ['PL GOLD', 'Objective']);
    const [line] = (await stored()).graphics;
    [...panel.querySelectorAll('[data-graphic-item] button')].find((b) => b.textContent.includes('PL GOLD')).click();
    assert.equal(graphicSelection.get(), line.id);
    await waitFor(() => field(panel, 'graphic-label'));
    assert.deepEqual([...field(panel, 'graphic-kind').options].map((o) => o.value), ['phaseLine', 'boundary', 'axisOfAdvance', 'route', 'line']);
    choose(field(panel, 'graphic-kind'), 'boundary');
    field(panel, 'graphic-custom-color').click();
    field(panel, 'graphic-color').value = '#000000';
    field(panel, 'graphic-color').dispatchEvent(new Event('input', { bubbles: true }));
    button(panel, 'Save').click();
    await waitFor(async () => (await stored()).graphics[0].kind === 'boundary');
    const saved = (await stored()).graphics[0];
    assert.deepEqual([saved.label, saved.color, saved.side], ['PL GOLD', '#000000', 'friendly']);
  });

  it('keeps what you are typing when the graphic changes elsewhere, and saves only your changes', async () => {
    const { panel, stored, graphicSelection, other, coa } = await setup({ graphics: [{ expectedRevision: 1, kind: 'route', points: PL, label: 'OLD' }] });
    const [g] = (await stored()).graphics;
    graphicSelection.set(g.id);
    await waitFor(() => field(panel, 'graphic-label'));
    const input = field(panel, 'graphic-label');
    type(input, 'TYPING');
    const moved = [{ lat: 5, lng: 5 }, { lat: 6, lng: 6 }];
    await other.send('graphic.update', { coaId: coa.id, graphicId: g.id, points: moved, side: 'hostile' });
    await waitFor(() => field(panel, 'graphic-side').value === 'hostile', { message: 'untouched fields follow the change' });
    assert.equal(field(panel, 'graphic-label'), input, 'the editor was not rebuilt');
    assert.equal(input.value, 'TYPING');
    button(panel, 'Save').click();
    await waitFor(async () => (await stored()).graphics[0].label === 'TYPING');
    const saved = (await stored()).graphics[0];
    assert.deepEqual([saved.points, saved.side], [moved, 'hostile'], 'the other change is kept');
  });

  it('deletes the selected graphic', async () => {
    const { panel, stored, graphicSelection } = await setup({ graphics: [{ expectedRevision: 1, kind: 'route', points: PL }] });
    const [g] = (await stored()).graphics;
    graphicSelection.set(g.id);
    await waitFor(() => button(panel, 'Delete'));
    button(panel, 'Delete').click();
    await waitFor(async () => (await stored()).graphics.length === 0);
    await waitFor(() => graphicSelection.get() === null);
  });

  it('asks for a COA when none is selected', async () => {
    const { panel, selection } = await setup();
    selection.set(null);
    await waitFor(() => /Select a COA/.test(panel.textContent));
    assert.ok(button(panel, 'Draw').closest('[hidden]'), 'the draw form is hidden');
  });
});

describe('sectors of fire on the map (T-4)', () => {
  const SECTOR = { kind: 'sector', center: { lat: 1, lng: 1 }, radius: 50000, bearing: 90, arc: 60, label: 'Gun' };

  it('shows a sector as a wedge pointing along its bearing, labelled out along it', async () => {
    const { container, stored } = await setup({ graphics: [{ expectedRevision: 1, ...SECTOR }] });
    const [g] = (await stored()).graphics;
    await waitFor(() => pathFor(container, g.id));
    const box = pathFor(container, g.id).getBoundingClientRect();
    const centre = map.latLngToContainerPoint([1, 1]);
    const mapBox = container.getBoundingClientRect();
    assert.ok(box.left >= mapBox.left + centre.x - 2, 'the wedge lies east of its centre (bearing 90°)');
    assert.deepEqual(texts(container, '.graphic-label'), ['Gun']);
  });

  it('is drawn with two clicks: the centre, then where it points at its range', async () => {
    const { panel, stored } = await setup();
    choose(field(panel, 'draw-kind'), 'sector');
    assert.ok(!field(panel, 'draw-arc').closest('.position').hidden, 'arc shown for sectors');
    type(field(panel, 'draw-arc'), '40');
    button(panel, 'Draw').click();
    click(1, 1); click(1, 2);
    await waitFor(async () => (await stored()).graphics.length === 1);
    const [g] = (await stored()).graphics;
    assert.equal(g.kind, 'sector');
    assert.equal(g.arc, 40);
    assert.ok(Math.abs(g.bearing - 90) < 0.5, `bearing ${g.bearing}`);
    assert.ok(Math.abs(g.radius - 111178) < 300, `radius ${g.radius}`);
  });

  it('dragging the rim handle changes range and direction; the editor changes them by number', async () => {
    const { container, graphicSelection, stored, panel } = await setup({ graphics: [{ expectedRevision: 1, ...SECTOR }] });
    const [g] = (await stored()).graphics;
    graphicSelection.set(g.id);
    await waitFor(() => container.querySelectorAll('.graphic-handle').length === 2);
    await frames();
    await drag(container.querySelector('.graphic-handle.is-radius'), -20, -60);
    await waitFor(async () => (await stored()).revision === 2);
    const moved = (await stored()).graphics[0];
    assert.ok(moved.bearing < 90 && moved.radius !== 50000, JSON.stringify(moved));

    await waitFor(() => field(panel, 'graphic-bearing')?.value === String(moved.bearing));
    type(field(panel, 'graphic-bearing'), '200');
    type(field(panel, 'graphic-arc'), '90');
    type(field(panel, 'graphic-min-radius'), '5');
    button(panel, 'Save').click();
    await waitFor(async () => (await stored()).graphics[0].bearing === 200);
    const saved = (await stored()).graphics[0];
    assert.deepEqual([saved.arc, saved.minRadius], [90, 5000]);
  });
});
