// H-5: large COAs stay fast. A COA with 1000 units and 200 lines appears within a generous budget,
// and one change redraws only what changed (markers and lines are re-used, not rebuilt).
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox } from './app-fixture.js';
import { mountMapView } from '../../src/adapters/ui/views/map-view.js';
import { mountGraphicsLayer } from '../../src/adapters/ui/views/graphics-layer.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';

const BUDGET_MS = 3000; // the target is under 1 s on a mid-range laptop; generous here so CI is not flaky
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

async function bigCoa() {
  const fixture = createTestApp();
  const sidcs = ['10031000161211000000', '10061000161211000000'];
  const units = Array.from({ length: 1000 }, (_, i) => ({ sidc: sidcs[i % 2], lat: 34 + (i % 40) * 0.01, lng: -118 + Math.floor(i / 40) * 0.01, label: `U${i}` }));
  const graphics = Array.from({ length: 200 }, (_, i) => ({ kind: i % 2 ? 'route' : 'phaseLine', label: `L${i}`, points: [{ lat: 34 + i * 0.002, lng: -118 }, { lat: 34 + i * 0.002, lng: -117.8 }] }));
  const { coas: [coa] } = (await fixture.client.send('coa.import', { document: { format: 'coa-builder/import', version: 1, coas: [{ name: 'Big', units, graphics }] } })).value;
  const host = sandbox();
  host.style.cssText = 'width: 1000px; height: 700px;';
  const map = window.L.map(host, { center: [34.2, -117.9], zoom: 11, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
  const selection = createSelection(null);
  const activeCoa = createActiveCoa({ client: fixture.client, selection });
  const views = [
    mountMapView({ client: fixture.client, L: window.L, map, selection, activeCoa }),
    mountGraphicsLayer({ client: fixture.client, L: window.L, map, selection, graphicSelection: createSelection(), activeCoa }),
  ];
  cleanups.push(() => { views.forEach((v) => v.destroy()); activeCoa.destroy(); map.remove(); host.remove(); });
  return { ...fixture, coa, host, selection };
}

describe('large COAs (1000 units, 200 lines)', () => {
  it(`appear within ${BUDGET_MS} ms of being selected`, async () => {
    const { coa, host, selection } = await bigCoa();
    const start = performance.now();
    selection.set(coa.id);
    await waitFor(() => host.querySelectorAll('.unit-marker').length === 1000 && host.querySelectorAll('path.graphic').length === 200, { timeout: 10000 });
    const ms = performance.now() - start;
    assert.ok(ms < BUDGET_MS, `took ${Math.round(ms)} ms`);
  });

  it('a move redraws only that unit: every other marker and every line is the same element', async () => {
    const { coa, host, selection, client } = await bigCoa();
    selection.set(coa.id);
    await waitFor(() => host.querySelectorAll('.unit-marker').length === 1000 && host.querySelectorAll('path.graphic').length === 200, { timeout: 10000 });
    const markersBefore = [...host.querySelectorAll('.unit-marker')];
    const pathsBefore = [...host.querySelectorAll('path.graphic')];
    const moved = coa.symbols[0];
    const el = host.querySelector(`.unit-marker[data-symbol-id="${moved.id}"]`);
    const at = el.style.transform;
    await client.send('symbol.move', { coaId: coa.id, symbolId: moved.id, position: { lat: moved.position.lat + 0.005, lng: moved.position.lng } });
    await waitFor(() => host.querySelector(`.unit-marker[data-symbol-id="${moved.id}"]`).style.transform !== at);
    const markersAfter = new Set(host.querySelectorAll('.unit-marker'));
    assert.equal(markersBefore.filter((m) => markersAfter.has(m)).length, 1000, 'all 1000 markers re-used (the moved one is repositioned)');
    const pathsAfter = new Set(host.querySelectorAll('path.graphic'));
    assert.equal(pathsBefore.filter((p) => pathsAfter.has(p)).length, 200, 'no line was redrawn');
  });

  it('changing one line redraws only that line', async () => {
    const { coa, host, selection, client } = await bigCoa();
    selection.set(coa.id);
    await waitFor(() => host.querySelectorAll('path.graphic').length === 200, { timeout: 10000 });
    const target = coa.graphics[5];
    const others = [...host.querySelectorAll('path.graphic')].filter((p) => p.dataset.graphicId !== target.id);
    await client.send('graphic.update', { coaId: coa.id, graphicId: target.id, side: 'hostile' });
    await waitFor(() => host.querySelector(`path.graphic[data-graphic-id="${target.id}"]`)?.getAttribute('stroke-dasharray'));
    const after = new Set(host.querySelectorAll('path.graphic'));
    assert.equal(others.filter((p) => after.has(p)).length, 199);
  });
});
