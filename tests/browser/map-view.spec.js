// COA-1.22: the map view, driven through a real Leaflet map and the real application.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox } from './app-fixture.js';
import { mountMapView } from '../../src/adapters/ui/views/map-view.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createPicker } from '../../src/adapters/ui/map-picker.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { drag } from './pointer.js';

const INFANTRY = '10031000001211000000';
const ARMOR = '10061000001205000000';
let host; let map; let view;
afterEach(() => { view?.destroy(); map?.remove(); host?.remove(); view = null; map = null; host = null; });

async function mountMap({ prefs = createMemoryPrefs(), ...options } = {}) {
  const fixture = createTestApp(options);
  const selection = createSelection();
  const symbolSelection = createSelection();
  const picker = createPicker();
  host = sandbox();
  const layersRoot = document.createElement('div');
  const container = document.createElement('div');
  container.style.cssText = 'width: 800px; height: 600px;';
  host.append(layersRoot, container);
  map = window.L.map(container, { center: [0, 0], zoom: 2 });
  const calls = { ask: 0, types: [] };
  const client = { ...fixture.client, ask: (...args) => { calls.ask += 1; calls.types.push(args[0]); return fixture.client.ask(...args); } };
  view = mountMapView({ client, L: window.L, map, selection, symbolSelection, picker, layersRoot, prefs });
  await view.ready;
  return { ...fixture, selection, symbolSelection, picker, container, layersRoot, prefs, calls };
}

async function coaWithUnits(client, units) {
  const coa = (await client.send('coa.create', { name: 'COA' })).value;
  const symbols = [];
  for (const u of units) symbols.push((await client.send('symbol.add', { coaId: coa.id, ...u })).value.symbol);
  return { coa, symbols };
}

const markers = (container) => [...container.querySelectorAll('.unit-marker')];
const markerFor = (container, symbolId) => container.querySelector(`.unit-marker[data-symbol-id="${symbolId}"]`);
const translate = (el) => el.style.transform;

/** Stop any zoom animation (Leaflet ignores drags during one) and let the map redraw. */
async function settleMap() {
  map.setView([0, 0], 5, { animate: false });
  for (let i = 0; i < 3; i++) await new Promise((res) => requestAnimationFrame(res));
}


describe('map view', () => {
  it('shows the offline grid by default and offers OpenStreetMap, in the panel, without loading it', async () => {
    const { container, layersRoot } = await mountMap();
    await waitFor(() => container.querySelectorAll('canvas.leaflet-tile').length > 0, { message: 'no grid tiles' });
    const radios = [...layersRoot.querySelectorAll('input[type="radio"]')];
    assert.deepEqual(radios.map((r) => r.closest('label').textContent.trim()), ['Grid (offline)', 'OpenStreetMap (online)']);
    assert.deepEqual(radios.map((r) => r.checked), [true, false]);
    assert.equal(container.querySelector('.leaflet-control-layers'), null, 'no floating layer control on the map');
    assert.equal(container.querySelector('img[src*="openstreetmap"]'), null, 'OSM tiles must not load unless chosen');
  });

  it('switches to OpenStreetMap from the panel and remembers the choice', async () => {
    const prefs = createMemoryPrefs();
    const first = await mountMap({ prefs });
    const osm = [...first.layersRoot.querySelectorAll('input[type="radio"]')][1];
    osm.checked = true;
    osm.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => first.container.querySelector('img[src*="openstreetmap"]'), { message: 'OSM tiles not requested' });
    assert.equal(first.container.querySelectorAll('canvas.leaflet-tile').length, 0, 'grid removed');
    view.destroy(); map.remove(); host.remove(); view = null;
    const second = await mountMap({ prefs });
    assert.deepEqual([...second.layersRoot.querySelectorAll('input[type="radio"]')].map((r) => r.checked), [false, true]);
  });

  it('labels each visible grid line once, along the map edges, and relabels on zoom', async () => {
    const { container } = await mountMap();
    const labels = () => [...container.querySelectorAll('.grid-label')].map((l) => l.textContent);
    map.setView([0, 0], 6, { animate: false });
    await waitFor(() => labels().includes('0°') && labels().includes('2°N') && labels().includes('2°E'), { message: `labels: ${labels()}` });
    for (const axis of ['lat', 'lng']) {
      const onAxis = [...container.querySelectorAll(`.grid-label-${axis}`)].map((l) => l.textContent);
      assert.equal(new Set(onAxis).size, onAxis.length, `duplicate ${axis} labels: ${onAxis}`);
    }
    map.setView([0, 0], 9, { animate: false });
    await waitFor(() => labels().includes('0.25°N') && !labels().includes('2°N'), { message: `labels after zoom: ${labels()}` });
  });

  it('draws the selected COA\'s units as milsymbol markers', async () => {
    const { client, selection, container } = await mountMap();
    const { coa, symbols } = await coaWithUnits(client, [
      { sidc: INFANTRY, position: { lat: 10, lng: 20 }, label: 'A/1-5' },
      { sidc: ARMOR, position: { lat: 11, lng: 21 } },
    ]);
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 2);
    const first = markerFor(container, symbols[0].id);
    assert.ok(first.querySelector('svg'), 'drawn with the renderer\'s SVG');
    assert.equal(first.getAttribute('title'), 'A/1-5');
    assert.equal(markerFor(container, symbols[1].id).getAttribute('title'), ARMOR, 'unlabelled units are titled by SIDC');
  });

  it('pins each marker at the renderer\'s anchor point, not its corner', async () => {
    const { client, selection, container } = await mountMap();
    const { coa, symbols } = await coaWithUnits(client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }]);
    const preview = (await client.ask('symbol.preview', { sidc: INFANTRY, label: '', modifiers: {} })).value;
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 1);
    const icon = markerFor(container, symbols[0].id);
    assert.equal(icon.style.marginLeft, `${-Math.round(preview.anchor.x)}px`);
    assert.equal(icon.style.marginTop, `${-Math.round(preview.anchor.y)}px`);
  });

  it('fits the map to the selected COA\'s units', async () => {
    const { client, selection } = await mountMap();
    const { coa } = await coaWithUnits(client, [
      { sidc: INFANTRY, position: { lat: 50, lng: 5 } }, { sidc: INFANTRY, position: { lat: 51, lng: 6 } },
    ]);
    selection.set(coa.id);
    await waitFor(() => map.getZoom() > 5, { message: `zoom stayed ${map?.getZoom()}` });
    assert.ok(map.getBounds().contains([50, 5]) && map.getBounds().contains([51, 6]));
  });

  it('fits to lines, areas and range rings too, not only units', async () => {
    const { client, selection } = await mountMap();
    const coa = (await client.send('coa.create', { name: 'Lines only' })).value;
    await client.send('graphic.add', { coaId: coa.id, kind: 'phaseLine', points: [{ lat: 40, lng: 10 }, { lat: 40, lng: 11 }] });
    await client.send('graphic.add', { coaId: coa.id, kind: 'rangeRing', center: { lat: 41, lng: 12 }, radius: 20000 });
    selection.set(coa.id);
    await waitFor(() => map.getZoom() > 5, { message: `zoom stayed ${map?.getZoom()}` });
    assert.ok(map.getBounds().contains([40, 10]) && map.getBounds().contains([41.17, 12]), 'line and the whole ring are in view');
  });

  it('fits to the first units added to a COA that was selected while empty', async () => {
    const { client, selection, container } = await mountMap();
    const coa = (await client.send('coa.create', { name: 'Empty' })).value;
    selection.set(coa.id);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(map.getZoom() <= 2);
    await client.send('symbol.add', { coaId: coa.id, sidc: INFANTRY, position: { lat: 50, lng: 5 } });
    await waitFor(() => markers(container).length === 1 && map.getZoom() > 5, { message: `zoom ${map.getZoom()}` });
    const zoom = map.getZoom();
    map.setView([50, 5], zoom - 2, { animate: false });
    await client.send('symbol.add', { coaId: coa.id, sidc: INFANTRY, position: { lat: 50.1, lng: 5.1 } });
    await waitFor(() => markers(container).length === 2);
    assert.equal(map.getZoom(), zoom - 2, 'later additions must not keep re-fitting the map');
  });

  it('pans to a selected unit that is out of view', async () => {
    const { client, selection, symbolSelection, container } = await mountMap();
    const { coa, symbols } = await coaWithUnits(client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }, { sidc: INFANTRY, position: { lat: 40, lng: 60 } }]);
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 2);
    await new Promise((r) => setTimeout(r, 400)); // let the selection's fit animation finish
    map.setView([0, 0], 8, { animate: false });
    assert.ok(!map.getBounds().contains([40, 60]), 'test setup: unit should start out of view');
    symbolSelection.set(symbols[1].id);
    await waitFor(() => map.getBounds().contains([40, 60]), { message: 'selected unit not brought into view' });
  });

  it('follows changes made elsewhere: added, moved and removed units', async () => {
    const { client, other, selection, container } = await mountMap();
    const { coa, symbols } = await coaWithUnits(client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }]);
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 1);
    const before = translate(markerFor(container, symbols[0].id));
    await other.send('symbol.add', { coaId: coa.id, sidc: ARMOR, position: { lat: 1, lng: 1 } });
    await waitFor(() => markers(container).length === 2);
    await other.send('symbol.move', { coaId: coa.id, symbolId: symbols[0].id, position: { lat: 5, lng: 5 } });
    await waitFor(() => translate(markerFor(container, symbols[0].id)) !== before);
    await other.send('symbol.remove', { coaId: coa.id, symbolId: symbols[0].id });
    await waitFor(() => markers(container).length === 1 && !markerFor(container, symbols[0].id));
  });

  it('switches to the newly selected COA and clears the map when nothing is selected', async () => {
    const { client, selection, container } = await mountMap();
    const a = await coaWithUnits(client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }]);
    const b = await coaWithUnits(client, [{ sidc: ARMOR, position: { lat: 1, lng: 1 } }, { sidc: ARMOR, position: { lat: 2, lng: 2 } }]);
    selection.set(a.coa.id);
    await waitFor(() => markers(container).length === 1);
    selection.set(b.coa.id);
    await waitFor(() => markers(container).length === 2 && !markerFor(container, a.symbols[0].id));
    selection.set(null);
    await waitFor(() => markers(container).length === 0);
  });

  it('moves a unit when its marker is dragged', async () => {
    const { client, selection, container } = await mountMap();
    const { coa, symbols } = await coaWithUnits(client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }]);
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 1);
    await settleMap();
    await drag(markerFor(container, symbols[0].id), 100, -60);
    let got;
    for (let i = 0; i < 100 && got?.revision !== 3; i++) {
      got = (await client.ask('coa.get', { coaId: coa.id })).value;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(got.revision, 3, 'symbol.move was sent');
    assert.ok(got.symbols[0].position.lng > 0 && got.symbols[0].position.lat > 0, JSON.stringify(got.symbols[0].position));
  });

  it('snaps a dragged marker back and says why when the move is refused', async () => {
    let failSaves = false;
    const repo = new InMemoryCoaRepository();
    const save = repo.save.bind(repo);
    repo.save = (...args) => (failSaves
      ? Promise.resolve({ ok: false, error: { code: 'STORAGE_UNAVAILABLE', message: 'Storage is not available', details: {} } })
      : save(...args));
    const { client, selection, container } = await mountMap({ coaRepository: repo });
    const { coa, symbols } = await coaWithUnits(client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }]);
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 1);
    await settleMap();
    const icon = markerFor(container, symbols[0].id);
    const home = translate(icon);
    failSaves = true;
    await drag(icon, 120, 0);
    await waitFor(() => /Storage is not available/.test(container.querySelector('.map-message').textContent));
    await waitFor(() => translate(markerFor(container, symbols[0].id)) === home, { message: 'marker did not snap back' });
  });

  it('selects a unit when its marker is clicked, and marks the selected marker', async () => {
    const { client, selection, symbolSelection, container } = await mountMap();
    const { coa, symbols } = await coaWithUnits(client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }, { sidc: ARMOR, position: { lat: 1, lng: 1 } }]);
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 2);
    markerFor(container, symbols[1].id).click();
    assert.equal(symbolSelection.get(), symbols[1].id);
    await waitFor(() => markerFor(container, symbols[1].id).classList.contains('is-selected'));
    assert.ok(!markerFor(container, symbols[0].id).classList.contains('is-selected'));
    symbolSelection.set(symbols[0].id);
    await waitFor(() => markerFor(container, symbols[0].id).classList.contains('is-selected') && !markerFor(container, symbols[1].id).classList.contains('is-selected'));
  });

  it('answers "Pick on map" with the clicked position (crosshair while picking), and Escape cancels', async () => {
    const { picker, container } = await mountMap();
    await settleMap();
    let picked = null;
    picker.request((latlng) => { picked = latlng; });
    await waitFor(() => container.classList.contains('is-picking'));
    const point = map.latLngToContainerPoint([10, 20]);
    const r = container.getBoundingClientRect();
    container.dispatchEvent(new MouseEvent('click', { clientX: r.left + point.x, clientY: r.top + point.y, bubbles: true }));
    await waitFor(() => picked !== null);
    assert.ok(Math.abs(picked.lat - 10) < 0.5 && Math.abs(picked.lng - 20) < 0.5, JSON.stringify(picked));
    assert.ok(!container.classList.contains('is-picking'));
    picker.request(() => assert.fail('should have been cancelled'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!picker.isActive());
  });

  it('reloads once for a burst of changes (copying many units does not stutter)', async () => {
    const { client, selection, container, calls } = await mountMap();
    const { coa } = await coaWithUnits(client, [0, 1, 2, 3].map((i) => ({ sidc: INFANTRY, position: { lat: i, lng: 0 } })));
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 4);
    const ids = (await client.ask('coa.get', { coaId: coa.id })).value.symbols.map((s) => s.id);
    calls.types.length = 0;
    await client.send('symbol.copy', { coaId: coa.id, fromCoaId: coa.id, symbolIds: ids, offset: { lat: 0.5, lng: 0 } }); // 4 events
    await waitFor(() => markers(container).length === 8);
    await new Promise((r) => setTimeout(r, 50));
    const reloads = calls.types.filter((t) => t === 'coa.get').length;
    assert.equal(reloads, 1, `expected one reload for the burst of 4 events, got ${reloads}`);
  });

  it('can show units semi-transparent (50%) from the Map section, keeping the selected unit opaque, and remembers it', async () => {
    const prefs = createMemoryPrefs();
    const first = await mountMap({ prefs });
    const { coa, symbols } = await coaWithUnits(first.client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }, { sidc: ARMOR, position: { lat: 1, lng: 1 } }]);
    first.selection.set(coa.id);
    await waitFor(() => markers(first.container).length === 2);
    const toggle = first.layersRoot.querySelector('input[type="checkbox"][name="translucent-units"]');
    assert.match(toggle.closest('label').textContent, /Semi-transparent units \(50%\)/);
    assert.equal(toggle.checked, false);
    assert.equal(getComputedStyle(markerFor(first.container, symbols[0].id)).opacity, '1');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(getComputedStyle(markerFor(first.container, symbols[0].id)).opacity, '0.5');
    first.symbolSelection.set(symbols[1].id);
    await waitFor(() => getComputedStyle(markerFor(first.container, symbols[1].id)).opacity === '1');
    view.destroy(); map.remove(); host.remove(); view = null;
    const second = await mountMap({ prefs });
    assert.equal(second.layersRoot.querySelector('input[name="translucent-units"]').checked, true);
  });

  it('stops listening and removes its layers on destroy', async () => {
    const { client, other, selection, container, layersRoot, calls } = await mountMap();
    const { coa } = await coaWithUnits(client, [{ sidc: INFANTRY, position: { lat: 0, lng: 0 } }]);
    selection.set(coa.id);
    await waitFor(() => markers(container).length === 1);
    view.destroy(); view = null;
    assert.equal(markers(container).length, 0);
    assert.equal(layersRoot.querySelector('input'), null, 'layer choices removed');
    const before = calls.ask;
    await other.send('symbol.add', { coaId: coa.id, sidc: ARMOR, position: { lat: 1, lng: 1 } });
    selection.set(null);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.ask, before, 'the destroyed view still queried the app');
  });
});

describe('map view: Pick on map hint', () => {
  it('shows a hint with Cancel on the map while picking, and removes it afterwards', async () => {
    const { container, picker } = await mountMap();
    const hint = () => container.querySelector('[data-pick-hint]');
    assert.equal(hint(), null);
    let picked = null;
    picker.request((latlng) => { picked = latlng; });
    assert.match(hint().textContent, /Click the map to place the unit/);
    picker.resolve({ lat: 1, lng: 2 });
    assert.equal(hint(), null);
    assert.deepEqual(picked, { lat: 1, lng: 2 });

    picker.request(() => { picked = 'again'; });
    [...hint().querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    assert.equal(picker.isActive(), false);
    assert.equal(hint(), null);
    assert.deepEqual(picked, { lat: 1, lng: 2 });
  });
});
