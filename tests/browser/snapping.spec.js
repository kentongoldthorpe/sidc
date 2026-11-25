// Epic 3 backlog B-2: snapping on the map and the template canvas, and the template grid spacing.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox } from './app-fixture.js';
import { mountGraphicsLayer } from '../../src/adapters/ui/views/graphics-layer.js';
import { mountDrawTool } from '../../src/adapters/ui/views/draw-tool.js';
import { mountMapView } from '../../src/adapters/ui/views/map-view.js';
import { mountSnapControl } from '../../src/adapters/ui/views/snap-control.js';
import { mountTemplateCanvas } from '../../src/adapters/ui/views/template-canvas.js';
import { createDrawer } from '../../src/adapters/ui/map-drawer.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createThreatModelStore } from '../../src/adapters/ui/threat-model-store.js';
import { createPicker } from '../../src/adapters/ui/map-picker.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';
import { createSnapSettings, createSnapper, coaSnapTargets, latLngGrid } from '../../src/adapters/ui/snapper.js';
import { stepFor } from '../../src/adapters/ui/views/grid-layer.js';
import { drag } from './pointer.js';

const L = window.L;
const INF = '10061000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
const field = (root, name) => root.querySelector(`[name="${name}"]`);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
const tick = (box) => { box.click(); };

async function mapSetup() {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  await fixture.client.send('symbol.add', { coaId: coa.id, sidc: INF, position: { lat: 1, lng: 1 }, label: 'A' });
  const selection = createSelection(coa.id);
  const host = sandbox();
  const container = document.createElement('div');
  container.style.cssText = 'width: 800px; height: 600px;';
  host.append(container);
  const map = L.map(container, { center: [1, 1], zoom: 7, animate: false });
  const prefs = createMemoryPrefs();
  const settings = createSnapSettings(prefs);
  const activeCoa = createActiveCoa({ client: fixture.client, selection });
  const snapper = createSnapper({ L, map, settings, targets: () => coaSnapTargets(activeCoa.get()), gridAt: latLngGrid(map, stepFor) });
  const drawer = createDrawer();
  const graphicSelection = createSelection();
  const picker = createPicker();
  const control = mountSnapControl({ L, map, settings });
  const layer = mountGraphicsLayer({ client: fixture.client, L, map, selection, graphicSelection, drawer, activeCoa, snapper });
  const tool = mountDrawTool({ L, map, drawer, snapper });
  const view = mountMapView({ client: fixture.client, L, map, selection, picker, activeCoa, snapper });
  cleanups.push(() => { [layer, tool, view, control].forEach((v) => v.destroy()); activeCoa.destroy?.(); map.remove(); host.remove(); });
  await Promise.all([layer.ready, view.ready, activeCoa.ready]);
  await waitFor(() => activeCoa.get()?.symbols.length === 1);
  const stored = async () => (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
  const click = (lat, lng, originalEvent = {}) => map.fire('click', { latlng: L.latLng(lat, lng), originalEvent });
  /** A latlng `dx`, `dy` pixels from another. */
  const offset = (ll, dx, dy) => map.containerPointToLatLng(map.latLngToContainerPoint(ll).add([dx, dy]));
  const drawLine = (points) => new Promise((resolve) => {
    drawer.request({ shape: 'line' }, resolve);
    points.forEach(([p, ev]) => click(p.lat, p.lng, ev));
    map.fire('dblclick', { latlng: L.latLng(points.at(-1)[0].lat, points.at(-1)[0].lng), originalEvent: points.at(-1)[1] ?? {} });
  });
  return { ...fixture, coa, map, settings, prefs, snapper, drawer, picker, container, stored, click, offset, drawLine, graphicSelection };
}

describe('the Snap control', () => {
  it('starts off, turns snapping on and off, and is remembered', async () => {
    const s = await mapSetup();
    const control = s.container.querySelector('[data-snap-control]');
    const button = control.querySelector('.snap-toggle');
    assert.equal(button.textContent, 'Snap');
    assert.equal(control.querySelector('.snap-panel').hidden, true);
    button.click();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    tick(field(control, 'snap-points'));
    choose(field(control, 'snap-angle'), '45');
    assert.deepEqual(s.settings.get(), { points: true, grid: false, angle: 45, templateGrid: 'auto' });
    assert.equal(button.textContent, 'Snap on');
    assert.deepEqual(s.prefs.get('snap'), s.settings.get());
    assert.equal(createSnapSettings(s.prefs).get().angle, 45, 'a new page starts with the same settings');
    assert.equal(field(control, 'snap-template-grid'), null, 'the map has no template grid spacing');
  });
});

describe('snapping on the map', () => {
  it('does nothing while off', async () => {
    const s = await mapSetup();
    const g = await s.drawLine([[s.offset({ lat: 1, lng: 1 }, 4, 3)], [{ lat: 1.5, lng: 1.9 }]]);
    assert.notDeepEqual(g.points[0], { lat: 1, lng: 1 });
  });

  it('puts a point drawn near a unit exactly on it; Alt places it freely', async () => {
    const s = await mapSetup();
    s.settings.set({ points: true });
    const near = s.offset({ lat: 1, lng: 1 }, 5, -4);
    const g = await s.drawLine([[near], [{ lat: 1.5, lng: 1.9 }]]);
    assert.deepEqual(g.points[0], { lat: 1, lng: 1 });
    const free = await s.drawLine([[near, { altKey: true }], [{ lat: 1.5, lng: 1.9 }]]);
    assert.notDeepEqual(free.points[0], { lat: 1, lng: 1 });
  });

  it('turns a segment to the nearest 45° from the last point', async () => {
    const s = await mapSetup();
    s.settings.set({ angle: 45 });
    const a = { lat: 0.5, lng: 0.5 };
    const g = await s.drawLine([[a], [s.offset(a, 200, -12)]]);
    const [p0, p1] = g.points.map((p) => s.map.latLngToContainerPoint(p));
    assert.ok(Math.abs(p1.y - p0.y) < 0.5, `level: ${p0.y} → ${p1.y}`);
  });

  it('puts a point on the nearest intersection of the lat/long grid shown', async () => {
    const s = await mapSetup();
    s.settings.set({ grid: true });
    const step = stepFor(s.map.getZoom());
    const g = await s.drawLine([[{ lat: 0.53, lng: 0.71 }], [{ lat: 1.27, lng: 1.62 }]]);
    for (const p of g.points) for (const v of [p.lat, p.lng]) assert.ok(Math.abs(Math.round(v / step) * step - v) < 1e-9, `${v} on a ${step}° grid`);
  });

  it('snaps a dragged handle onto another point, and a dragged unit onto a line\'s point', async () => {
    const s = await mapSetup();
    s.settings.set({ points: true });
    const line = (await s.client.send('graphic.add', { coaId: s.coa.id, expectedRevision: 2, kind: 'route', points: [{ lat: 0.6, lng: 0.4 }, { lat: 0.6, lng: 1.6 }] })).value.graphic;
    s.graphicSelection.set(line.id);
    await waitFor(() => s.container.querySelectorAll('.graphic-handle:not(.is-mid)').length === 2);
    await frames();
    // Drag the first point to (about) the unit at 1, 1.
    const handle = s.container.querySelector('.graphic-handle:not(.is-mid)');
    const from = s.map.latLngToContainerPoint([0.6, 0.4]);
    const to = s.map.latLngToContainerPoint([1, 1]);
    await drag(handle, to.x - from.x + 3, to.y - from.y - 2);
    await waitFor(async () => (await s.stored()).graphics[0].points[0].lat === 1);
    assert.deepEqual((await s.stored()).graphics[0].points[0], { lat: 1, lng: 1 });
    // Drag the unit near the line's other point.
    s.graphicSelection.set(null);
    await frames();
    const unit = s.container.querySelector('.unit-marker');
    const u = s.map.latLngToContainerPoint([1, 1]);
    const end = s.map.latLngToContainerPoint([0.6, 1.6]);
    await drag(unit, end.x - u.x - 4, end.y - u.y + 3);
    await waitFor(async () => (await s.stored()).symbols[0].position.lng === 1.6);
    assert.deepEqual((await s.stored()).symbols[0].position, { lat: 0.6, lng: 1.6 });
  });

  it('snaps a place picked on the map', async () => {
    const s = await mapSetup();
    s.settings.set({ points: true });
    const picked = new Promise((resolve) => s.picker.request(resolve));
    const near = s.offset({ lat: 1, lng: 1 }, -3, 6);
    s.click(near.lat, near.lng);
    assert.deepEqual(await picked, { lat: 1, lng: 1 });
  });
});

describe('the template grid and snapping on the canvas', () => {
  async function canvasSetup() {
    const fixture = createTestApp();
    const model = (await fixture.client.send('threat-model.create', { name: 'MRB' })).value;
    await fixture.client.send('threat-model.set-template', { modelId: model.id, expectedRevision: 1, target: 'formation', template: { units: [{ id: 'a', sidc: INF, label: 'A', x: 0, y: 0 }], graphics: [] } });
    const modelSelection = createSelection(model.id);
    const unitSelection = createSelection();
    const store = createThreatModelStore({ client: fixture.client, modelSelection });
    const host = sandbox();
    const el = document.createElement('div');
    el.style.cssText = 'width: 800px; height: 600px;';
    host.append(el);
    const settings = createSnapSettings(createMemoryPrefs());
    const canvas = mountTemplateCanvas({ client: fixture.client, L, container: el, store, unitSelection, snapSettings: settings });
    cleanups.push(() => { canvas.destroy(); store.destroy(); host.remove(); });
    await Promise.all([store.ready, canvas.ready]);
    canvas.map.setView([0, 0], -3, { animate: false });
    const stored = async () => (await fixture.client.ask('threat-model.get', { modelId: model.id })).value;
    return { ...fixture, canvas, el, settings, store, stored };
  }

  it('offers the grid spacing, draws the grid at it and says so', async () => {
    const s = await canvasSetup();
    const control = s.el.querySelector('[data-snap-control]');
    control.querySelector('.snap-toggle').click();
    assert.deepEqual([...field(control, 'snap-template-grid').options].map((o) => o.value), ['auto', '50', '100', '250', '500', '1000', '2500', '5000', '10000']);
    assert.match(s.el.querySelector('[data-grid-spacing]').textContent, /^Grid .* \(auto\)$/);
    choose(field(control, 'snap-template-grid'), '250');
    assert.equal(s.settings.get().templateGrid, 250);
    await waitFor(() => /^Grid 250 m/.test(s.el.querySelector('[data-grid-spacing]').textContent));
    const xs = [...s.el.querySelectorAll('.template-grid-label.is-x')].map((l) => l.textContent);
    assert.ok(xs.length > 0 && xs.every((t) => /^(\d+(\.\d)? km|\d+ m)$/.test(t)), xs.join());
  });

  it('puts a clicked place on the chosen grid, and snaps a dragged unit to it', async () => {
    const s = await canvasSetup();
    s.settings.set({ grid: true, templateGrid: 500 });
    const picked = new Promise((resolve) => s.canvas.picker.request(resolve));
    s.canvas.map.fire('click', { latlng: L.latLng(1180, -730), originalEvent: {} });
    assert.deepEqual(await picked, { x: -500, y: 1000 });
    await frames();
    const marker = s.el.querySelector('.template-unit[data-unit-id="a"]');
    const px = 2 ** s.canvas.map.getZoom(); // pixels per metre
    await drag(marker, 1400 * px, -1700 * px);
    await waitFor(async () => (await s.stored()).formation.units[0].x !== 0);
    const [u] = (await s.stored()).formation.units;
    assert.deepEqual([u.x % 500, u.y % 500], [0, 0], JSON.stringify(u));
  });

  it('snaps a line drawn on the canvas to the unit and to 45°', async () => {
    const s = await canvasSetup();
    s.settings.set({ points: true, angle: 45 });
    const map = s.canvas.map;
    const near = map.containerPointToLatLng(map.latLngToContainerPoint([0, 0]).add([4, -3]));
    const done = new Promise((resolve) => s.canvas.drawer.request({ shape: 'line' }, resolve));
    map.fire('click', { latlng: near, originalEvent: {} });
    const second = map.containerPointToLatLng(map.latLngToContainerPoint([0, 0]).add([150, -160]));
    map.fire('click', { latlng: second, originalEvent: {} });
    map.fire('dblclick', { latlng: second, originalEvent: {} });
    const g = await done;
    assert.deepEqual([g.points[0].lat, g.points[0].lng], [0, 0], 'on the unit');
    assert.ok(Math.abs(Math.abs(g.points[1].lat) - Math.abs(g.points[1].lng)) < 1, `45°: ${JSON.stringify(g.points[1])}`);
  });
});
