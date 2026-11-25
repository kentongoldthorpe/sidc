// G-1: the MGRS grid overlay on the map, its cursor readout, and snapping to it.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox } from './app-fixture.js';
import { mountMapView } from '../../src/adapters/ui/views/map-view.js';
import { mountDrawTool } from '../../src/adapters/ui/views/draw-tool.js';
import { createMgrsLayer } from '../../src/adapters/ui/views/mgrs-layer.js';
import { createDrawer } from '../../src/adapters/ui/map-drawer.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';
import { createSnapSettings, createSnapper } from '../../src/adapters/ui/snapper.js';
import { toUtm } from '../../src/domain/mgrs.js';

const L = window.L;
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

async function setup({ prefs = createMemoryPrefs(), center = [38.8895, -77.0352], zoom = 13 } = {}) {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  const host = sandbox();
  const layers = document.createElement('div');
  const container = document.createElement('div');
  container.style.cssText = 'width: 800px; height: 600px;';
  host.append(layers, container);
  const map = L.map(container, { center, zoom, animate: false });
  const mgrsGrid = createMgrsLayer(L);
  const settings = createSnapSettings(createMemoryPrefs());
  const snapper = createSnapper({ L, map, settings, targets: () => [], gridAt: (ll) => mgrsGrid.snap(ll) });
  const drawer = createDrawer();
  const view = mountMapView({ client: fixture.client, L, map, selection: createSelection(coa.id), layersRoot: layers, prefs, snapper, mgrsGrid });
  const tool = mountDrawTool({ L, map, drawer, snapper });
  cleanups.push(() => { tool.destroy(); view.destroy(); map.remove(); host.remove(); });
  await view.ready;
  const toggle = () => layers.querySelector('[name="mgrs-grid"]');
  return { ...fixture, map, container, layers, toggle, mgrsGrid, settings, drawer, prefs };
}

describe('MGRS grid overlay', () => {
  it('is off until ticked; then draws 1 km lines with labels, and is remembered', async () => {
    const s = await setup();
    assert.equal(s.toggle().checked, false);
    assert.equal(s.container.querySelectorAll('.mgrs-grid-line').length, 0);
    s.toggle().click();
    await waitFor(() => s.container.querySelectorAll('.mgrs-grid-line').length > 10);
    assert.equal(s.mgrsGrid.spacing(), 1000);
    const labels = [...s.container.querySelectorAll('.mgrs-label-e')].map((l) => l.textContent);
    assert.ok(labels.length > 3 && labels.every((t) => /^\d\d$/.test(t)), labels.join());
    assert.equal(s.prefs.get('mgrsGrid'), true);
    s.toggle().click();
    await waitFor(() => s.container.querySelectorAll('.mgrs-grid-line').length === 0);
    assert.equal(s.container.querySelector('.mgrs-labels'), null);
  });

  it('starts on when it was left on, and changes its spacing with the zoom', async () => {
    const prefs = createMemoryPrefs();
    prefs.set('mgrsGrid', true);
    const s = await setup({ prefs, zoom: 10 });
    assert.equal(s.toggle().checked, true);
    await waitFor(() => s.container.querySelectorAll('.mgrs-grid-line').length > 0);
    assert.equal(s.mgrsGrid.spacing(), 10000);
    s.map.setZoom(15, { animate: false });
    await waitFor(() => s.mgrsGrid.spacing() === 1000);
    s.map.setZoom(16, { animate: false });
    await waitFor(() => s.mgrsGrid.spacing() === 100);
    await waitFor(() => [...s.container.querySelectorAll('.mgrs-label-e')].some((l) => /^\d{3}$/.test(l.textContent)));
    s.map.setZoom(4, { animate: false });
    await waitFor(() => s.container.querySelectorAll('.mgrs-zone').length > 0);
    assert.ok([...s.container.querySelectorAll('.mgrs-zone')].some((z) => z.textContent === '18S'));
  });

  it('shows the MGRS reference under the pointer', async () => {
    const s = await setup();
    s.toggle().click();
    s.map.fire('mousemove', { latlng: L.latLng(38.8895, -77.0352) });
    await waitFor(() => s.container.querySelector('[data-mgrs-readout]').textContent.startsWith('18S UJ'));
    assert.match(s.container.querySelector('[data-mgrs-readout]').textContent, /^18S UJ \d{3} \d{3}$/, '100 m at this zoom');
    s.map.setZoom(18, { animate: false });
    s.map.fire('mousemove', { latlng: L.latLng(38.8895, -77.0352) });
    await waitFor(() => /^18S UJ \d{5} \d{5}$/.test(s.container.querySelector('[data-mgrs-readout]').textContent));
  });

  it('snaps to the MGRS grid shown', async () => {
    const s = await setup();
    s.toggle().click();
    s.settings.set({ grid: true });
    const done = new Promise((resolve) => s.drawer.request({ shape: 'line' }, resolve));
    s.map.fire('click', { latlng: L.latLng(38.8895, -77.0352), originalEvent: {} });
    s.map.fire('click', { latlng: L.latLng(38.9, -77.02), originalEvent: {} });
    s.map.fire('dblclick', { latlng: L.latLng(38.9, -77.02), originalEvent: {} });
    const g = await done;
    for (const p of g.points) {
      const u = toUtm(p);
      for (const v of [u.easting, u.northing]) assert.ok(Math.abs(v - Math.round(v / 1000) * 1000) < 0.01, `${v} on the 1 km grid`);
    }
  });
});
