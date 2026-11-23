// T-5 Place on map: preview a threat play on the map, move and rotate it, then create the SITTEMP COA.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, mountFullApp } from './app-fixture.js';
import { mountUi } from '../../src/adapters/ui/mount-ui.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';
import { drag } from './pointer.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { mountPlacementPreview } from '../../src/adapters/ui/views/placement-preview.js';
import { distance, initialBearing } from '../../src/domain/geodesy.js';

const L = window.L;
const INF = '10061000151211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

async function setup() {
  const fixture = createTestApp();
  const gun = (await fixture.client.send('system.create', { name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 })).value;
  let m = (await fixture.client.send('threat-model.create', { name: 'MRB attack' })).value;
  m = (await fixture.client.send('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: {
    units: [{ id: 'u1', sidc: INF, label: 'Lead', x: 0, y: 3000, systems: [gun.id] }, { id: 'u2', sidc: INF, label: 'Rear', x: 0, y: 0 }], graphics: [],
  } })).value;
  m = (await fixture.client.send('threat-coa.add', { modelId: m.id, expectedRevision: m.revision, name: 'COA 1' })).value;
  const play = JSON.parse(JSON.stringify(m.coas[0].template));
  play.units[0].end = { x: 0, y: 6000 };
  m = (await fixture.client.send('threat-model.set-template', { modelId: m.id, expectedRevision: m.revision, target: m.coas[0].id, template: play })).value;
  const host = sandbox();
  host.style.cssText = 'width: 900px; height: 700px;';
  const map = L.map(host, { center: [34, -118], zoom: 12, zoomAnimation: false, fadeAnimation: false });
  const selection = createSelection(null);
  const events = { done: [], cancelled: 0 };
  const preview = mountPlacementPreview({ client: fixture.client, L, map, selection, onDone: (coa) => events.done.push(coa), onCancel: () => { events.cancelled += 1; } });
  cleanups.push(() => { preview.destroy(); map.remove(); host.remove(); });
  const systems = new Map([[gun.id, gun]]);
  return { ...fixture, model: m, coaId: m.coas[0].id, map, host, selection, preview, events, systems };
}
const control = (host) => host.querySelector('[data-placement]');
const field = (host, name) => host.querySelector(`[name="${name}"]`);
const button = (host, label) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
const centreOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

describe('placing a threat play on the map', () => {
  it('previews the whole play at the centre of the view, attacking north, with its name and options', async () => {
    const s = await setup();
    s.preview.start({ model: s.model, play: s.coaId, systems: s.systems });
    await waitFor(() => s.host.querySelectorAll('.placement-unit').length === 2);
    assert.match(control(s.host).textContent, /Placing COA 1/);
    assert.equal(field(s.host, 'place-bearing').value, '0');
    assert.equal(field(s.host, 'place-positions').value, 'endWithMoves');
    assert.equal(field(s.host, 'place-name').value, 'COA 1 (SITTEMP)');
    const { anchor, bearing } = s.preview.state();
    assert.ok(Math.abs(anchor.lat - 34) < 1e-6 && Math.abs(anchor.lng + 118) < 1e-6 && bearing === 0);
    assert.ok(s.host.querySelector('path.placement-shape'), 'the gun sector and the move are previewed');
    const lead = centreOf(s.host.querySelector('.placement-unit[data-unit-id="u1"]'));
    const rear = centreOf(s.host.querySelector('.placement-unit[data-unit-id="u2"]'));
    assert.ok(lead.y < rear.y - 50, 'the lead unit is north (up) of the rear one');
  });

  it('a typed bearing turns the preview: 90° puts the lead unit east of the rear one', async () => {
    const s = await setup();
    s.preview.start({ model: s.model, play: s.coaId, systems: s.systems });
    await waitFor(() => field(s.host, 'place-bearing'));
    type(field(s.host, 'place-bearing'), '90');
    await frames();
    const lead = centreOf(s.host.querySelector('.placement-unit[data-unit-id="u1"]'));
    const rear = centreOf(s.host.querySelector('.placement-unit[data-unit-id="u2"]'));
    assert.ok(lead.x > rear.x + 50 && Math.abs(lead.y - rear.y) < 10, JSON.stringify({ lead, rear }));
  });

  it('drags the anchor handle to move the whole play, and the rotate handle to turn it', async () => {
    const s = await setup();
    s.preview.start({ model: s.model, play: s.coaId, systems: s.systems });
    await waitFor(() => s.host.querySelector('.placement-anchor'));
    await frames();
    const before = s.preview.state().anchor;
    await drag(s.host.querySelector('.placement-anchor'), 100, 50);
    await waitFor(() => s.preview.state().anchor.lng > before.lng);
    assert.ok(s.preview.state().anchor.lat < before.lat);
    await frames();
    const rotate = s.host.querySelector('.placement-rotate');
    const a = centreOf(s.host.querySelector('.placement-anchor'));
    const r = centreOf(rotate);
    const radius = Math.hypot(r.x - a.x, r.y - a.y);
    await drag(rotate, a.x + radius - r.x, a.y - r.y); // swing it round to the east of the anchor
    await waitFor(() => s.preview.state().bearing > 45 && s.preview.state().bearing < 135, { message: `bearing ${s.preview.state().bearing}` });
    assert.equal(field(s.host, 'place-bearing').value, String(s.preview.state().bearing));
  });

  it('Place creates the SITTEMP COA where the preview shows it, selects it, and ends', async () => {
    const s = await setup();
    s.preview.start({ model: s.model, play: s.coaId, systems: s.systems });
    await waitFor(() => field(s.host, 'place-bearing'));
    type(field(s.host, 'place-bearing'), '45');
    type(field(s.host, 'place-name'), 'SITTEMP north');
    button(s.host, 'Place').click();
    await waitFor(() => s.events.done.length === 1);
    const [coa] = s.events.done;
    assert.equal(coa.name, 'SITTEMP north');
    assert.equal(coa.source.bearing, 45);
    assert.equal(s.selection.get(), coa.id);
    assert.ok(Math.abs(initialBearing(coa.symbols[1].position, coa.symbols[0].position) - 45) < 0.01, 'lead is 45° from rear');
    assert.ok(Math.abs(distance(coa.symbols[1].position, coa.symbols[0].position) - 6000) < 1, 'at its end position, 6 km on');
    assert.equal(control(s.host), null);
    assert.equal(s.host.querySelectorAll('.placement-unit').length, 0);
  });

  it('Cancel removes the preview and creates nothing', async () => {
    const s = await setup();
    s.preview.start({ model: s.model, play: 'formation', systems: s.systems });
    await waitFor(() => button(s.host, 'Cancel'));
    assert.equal(field(s.host, 'place-positions').value, 'start', 'the formation has no moves');
    button(s.host, 'Cancel').click();
    assert.equal(s.events.cancelled, 1);
    assert.equal(control(s.host), null);
    assert.deepEqual((await s.client.ask('coa.list')).value, []);
  });
});

describe('Place on map from the Threat COAs panel (whole app)', () => {
  async function app() {
    const full = await mountFullApp({ mountUi, createMemoryPrefs });
    cleanups.push(() => { full.ui.destroy(); full.host.remove(); });
    const { client } = full.fixture;
    let m = (await client.send('threat-model.create', { name: 'Recon screen' })).value;
    m = (await client.send('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: { units: [{ id: 'u1', sidc: INF, label: 'Scout', x: 0, y: 0 }], graphics: [] } })).value;
    full.ui.setWorkspace('threat');
    full.ui.modelSelection.set(m.id);
    await waitFor(() => full.root.querySelector('[data-place-on-map]') && !full.root.querySelector('[data-region="threat-coas"] .stack[hidden]'));
    return full;
  }

  it('switches to the map with the preview; Place adds the COA to the list and selects it', async () => {
    const { root, ui, fixture } = await app();
    const before = (await fixture.client.ask('coa.list')).value.length;
    root.querySelector('[data-place-on-map]').click();
    assert.equal(root.dataset.workspace, 'map');
    await waitFor(() => root.querySelector('[data-placement]') && root.querySelector('.placement-unit'));
    assert.match(root.querySelector('[data-placement]').textContent, /Recon screen formation/);
    button(control(root), 'Place').click();
    await waitFor(() => !root.querySelector('[data-placement]'));
    const list = (await fixture.client.ask('coa.list')).value;
    assert.equal(list.length, before + 1);
    const placed = list.find((c) => c.name === 'Recon screen (SITTEMP)');
    assert.ok(placed);
    assert.equal(ui.selection.get(), placed.id);
    await waitFor(() => [...root.querySelectorAll('[data-region="coa-list"] li')].some((li) => li.textContent.includes('Recon screen (SITTEMP)')));
  });

  it('Cancel goes back to the threat workspace; switching workspace drops the preview', async () => {
    const { root, ui } = await app();
    root.querySelector('[data-place-on-map]').click();
    await waitFor(() => control(root));
    button(control(root), 'Cancel').click();
    assert.equal(root.dataset.workspace, 'threat');
    root.querySelector('[data-place-on-map]').click();
    await waitFor(() => root.querySelector('[data-placement]'));
    ui.setWorkspace('threat');
    assert.equal(root.querySelector('[data-placement]'), null);
    assert.equal(root.querySelectorAll('.placement-unit').length, 0);
  });
});
