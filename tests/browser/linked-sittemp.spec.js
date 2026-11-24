// M10-4a Linked SITTEMPs (D30) in the UI: the Units section says a COA is placed from a play, offers
// Update from template and Move or turn; a unit moved on the map can snap back.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type } from './app-fixture.js';
import { mountSymbolEditorView } from '../../src/adapters/ui/views/symbol-editor-view.js';
import { mountPlacementPreview } from '../../src/adapters/ui/views/placement-preview.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createPicker } from '../../src/adapters/ui/map-picker.js';

const INF = '10061000001211000000';
const ANCHOR = { lat: 34, lng: -118 };
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

async function setup() {
  const fixture = createTestApp();
  let m = (await fixture.client.send('threat-model.create', { name: 'MRB attack' })).value;
  m = (await fixture.client.send('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: {
    units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0 }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }], graphics: [] } })).value;
  const coa = (await fixture.client.send('threat-coa.place', { modelId: m.id, play: 'formation', anchor: ANCHOR, bearing: 0, positions: 'start' })).value;
  const host = sandbox();
  const symbolSelection = createSelection();
  const rePlaced = [];
  const view = mountSymbolEditorView({ client: fixture.client, root: host, selection: createSelection(coa.id), symbolSelection, picker: createPicker(), onRePlace: (c) => rePlaced.push(c) });
  cleanups.push(() => { view.destroy(); host.remove(); });
  await view.ready;
  const get = async () => (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
  return { ...fixture, model: m, coa, host, symbolSelection, rePlaced, get };
}

describe('a COA placed from a threat play (linked)', () => {
  it('says where it was placed from, flags a changed play, and updates from it', async () => {
    const s = await setup();
    const bar = () => s.host.querySelector('[data-linked-coa]');
    await waitFor(() => !bar().hidden && /Placed from MRB attack, its formation/.test(bar().textContent));
    assert.equal(bar().querySelector('.link-changed').hidden, true);
    await s.client.send('threat-model.set-template', { modelId: s.model.id, expectedRevision: s.model.revision, target: 'formation', template: {
      units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0 }, { id: 'u2', sidc: INF, label: '2 MRC', x: 900, y: 0 }, { id: 'u3', sidc: INF, label: '3 MRC', x: 0, y: -2000 }], graphics: [] } });
    await s.client.send('coa.update', { coaId: s.coa.id, description: 'touched' }); // any change to the COA re-reads the link
    await waitFor(() => !bar().querySelector('.link-changed').hidden);
    button(bar(), 'Update from template').click();
    await waitFor(async () => (await s.get()).symbols.length === 3);
    await waitFor(() => bar().querySelector('.link-changed').hidden);
  });

  it('marks a unit moved on the map and snaps it back', async () => {
    const s = await setup();
    const u = s.coa.symbols[0];
    await s.client.send('symbol.move', { coaId: s.coa.id, symbolId: u.id, position: { lat: 34.1, lng: -118 } });
    s.symbolSelection.set(u.id);
    await waitFor(() => button(s.host, 'Snap back to template'));
    assert.match(s.host.querySelector('[data-link-note]').textContent, /Moved off the template/);
    button(s.host, 'Snap back to template').click();
    await waitFor(async () => (await s.get()).symbols[0].link.moved === undefined);
    assert.deepEqual((await s.get()).symbols[0].position, u.position);
    await waitFor(() => /follows the play/.test(s.host.querySelector('[data-link-note]').textContent));
  });

  it('Move or turn… hands the COA to the placement preview, which applies a new bearing to the same COA', async () => {
    const s = await setup();
    await waitFor(() => button(s.host, 'Move or turn…'));
    button(s.host, 'Move or turn…').click();
    assert.equal(s.rePlaced[0].id, s.coa.id);
    const mapHost = sandbox();
    mapHost.style.cssText = 'width: 800px; height: 600px;';
    const map = window.L.map(mapHost, { center: [0, 0], zoom: 12, zoomAnimation: false, fadeAnimation: false });
    const done = [];
    const preview = mountPlacementPreview({ client: s.client, L: window.L, map, selection: createSelection(), onDone: (c, o) => done.push([c, o]) });
    cleanups.push(() => { preview.destroy(); map.remove(); mapHost.remove(); });
    preview.start({ model: s.model, play: 'formation', coa: s.rePlaced[0] });
    await waitFor(() => mapHost.querySelector('[data-placement]'));
    assert.match(mapHost.querySelector('[data-placement]').textContent, /Moving MRB attack/);
    assert.equal(mapHost.querySelector('[name="place-name"]'), null);
    assert.deepEqual(preview.state().anchor, ANCHOR);
    type(mapHost.querySelector('[name="place-bearing"]'), '90');
    button(mapHost, 'Apply').click();
    await waitFor(() => done.length === 1);
    assert.equal(done[0][1].moving, true);
    assert.equal((await s.get()).source.bearing, 90);
    assert.equal((await s.client.ask('coa.list')).value.length, 1, 'no copy was made');
  });
});
