// M10-3a Rich units (D28) in the UI: the unit editor sets HVT, facing, weapons and details; the map
// badges HVTs and draws each unit's weapon ranges from the unit.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type } from './app-fixture.js';
import { mountSymbolEditorView } from '../../src/adapters/ui/views/symbol-editor-view.js';
import { mountMapView } from '../../src/adapters/ui/views/map-view.js';
import { mountGraphicsLayer } from '../../src/adapters/ui/views/graphics-layer.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createPicker } from '../../src/adapters/ui/map-picker.js';

const HOSTILE = '10061000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

const field = (root, name) => root.querySelector(`[data-unit-form] [name="${name}"]`);
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };

async function withCoa(units = []) {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'SITTEMP' })).value;
  const symbols = [];
  for (const u of units) symbols.push((await fixture.client.send('symbol.add', { coaId: coa.id, sidc: HOSTILE, position: { lat: 34, lng: -118 }, ...u })).value.symbol);
  const get = async () => (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
  return { ...fixture, coa, symbols, get };
}

describe('unit editor: HVT, facing, weapons and details', () => {
  it('sets them on a unit, copying a weapon from a unit template', async () => {
    const s = await withCoa([{ label: 'AD' }]);
    await s.client.send('unit-template.create', { name: 'AD Bty', sidc: HOSTILE, weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 12000 }] });
    const host = sandbox();
    const symbolSelection = createSelection();
    const view = mountSymbolEditorView({ client: s.client, root: host, selection: createSelection(s.coa.id), symbolSelection, picker: createPicker() });
    cleanups.push(() => { view.destroy(); host.remove(); });
    await view.ready;
    symbolSelection.set(s.symbols[0].id);
    await waitFor(() => field(host, 'hvt'));
    field(host, 'hvt').click();
    type(field(host, 'facing'), '45');
    choose(field(host, 'unit-weapons-pick'), '0');
    type(field(host, 'details-strength'), '4 TELAR');
    button(host.querySelector('[data-unit-form]'), 'Save').click();
    await waitFor(async () => (await s.get()).symbols[0].hvt === true);
    const [u] = (await s.get()).symbols;
    assert.deepEqual([u.facing, u.weapons, u.details], [45, [{ name: 'SA-15', role: 'airDefence', maxRange: 12000, arc: 360 }], { strength: '4 TELAR' }]);
  });

  it('removes a weapon and clears the HVT tag', async () => {
    const s = await withCoa([{ label: 'AD', hvt: true, weapons: [{ name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 }] }]);
    const host = sandbox();
    const symbolSelection = createSelection();
    const view = mountSymbolEditorView({ client: s.client, root: host, selection: createSelection(s.coa.id), symbolSelection, picker: createPicker() });
    cleanups.push(() => { view.destroy(); host.remove(); });
    await view.ready;
    symbolSelection.set(s.symbols[0].id);
    await waitFor(() => button(host, 'Remove'));
    assert.equal(field(host, 'hvt').checked, true);
    button(host, 'Remove').click();
    field(host, 'hvt').click();
    button(host.querySelector('[data-unit-form]'), 'Save').click();
    await waitFor(async () => (await s.get()).symbols[0].hvt === undefined);
    assert.equal('weapons' in (await s.get()).symbols[0], false);
  });
});

describe('the map: HVT badge and weapon ranges', () => {
  it('badges an HVT and draws a ring and a sector from the unit, following its changes', async () => {
    const s = await withCoa([{ label: 'AD', hvt: true, facing: 90, weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 12000 }, { name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 }] }]);
    const host = sandbox();
    host.style.cssText = 'width: 800px; height: 600px;';
    const map = window.L.map(host, { center: [34, -118], zoom: 9 });
    const selection = createSelection(s.coa.id);
    const symbolSelection = createSelection();
    const markers = mountMapView({ client: s.client, L: window.L, map, selection, symbolSelection, picker: createPicker() });
    const layer = mountGraphicsLayer({ client: s.client, L: window.L, map, selection, graphicSelection: createSelection() });
    cleanups.push(() => { markers.destroy(); layer.destroy(); map.remove(); host.remove(); });
    await Promise.all([markers.ready, layer.ready]);
    await waitFor(() => host.querySelector('.unit-marker.is-hvt') && host.querySelectorAll(`[data-coverage-of="${s.symbols[0].id}"]`).length === 2);
    assert.ok(host.querySelector('.unit-coverage.role-airDefence') && host.querySelector('.unit-coverage.role-direct'));
    await s.client.send('symbol.update', { coaId: s.coa.id, symbolId: s.symbols[0].id, weapons: [], hvt: false });
    await waitFor(() => host.querySelectorAll('[data-coverage-of]').length === 0 && !host.querySelector('.unit-marker.is-hvt'));
  });
});
