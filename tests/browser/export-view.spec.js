// COA-6a.1: the Export section (frame and marking) and the frame drawn on the map.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type } from './app-fixture.js';
import { mountExportView } from '../../src/adapters/ui/views/export-view.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';
import { mapAreaRatio } from '../../src/adapters/export/slide-layout.js';

let host; let map; let view;
afterEach(() => { view?.destroy(); map?.remove(); host?.remove(); view = null; map = null; host = null; });

async function mountExport({ prefs = createMemoryPrefs(), saveFile } = {}) {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  const selection = createSelection(coa.id);
  host = sandbox();
  const panel = document.createElement('div');
  const container = document.createElement('div');
  container.style.cssText = 'width: 900px; height: 600px;';
  host.append(panel, container);
  map = window.L.map(container, { center: [34, -117], zoom: 9 });
  view = mountExportView({ client: fixture.client, root: panel, L: window.L, map, selection, prefs, ...(saveFile ? { saveFile } : {}) });
  await view.ready;
  const settings = async () => (await fixture.client.ask('settings.get')).value;
  return { ...fixture, coa, selection, panel, container, prefs, settings };
}

const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const radio = (panel, value) => panel.querySelector(`input[name="aspect"][value="${value}"]`);
const pick = (input) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); };
const frameEl = (container) => container.querySelector('.export-frame');
const ratioOf = (el) => { const r = el.getBoundingClientRect(); return r.width / r.height; };

describe('export frame', () => {
  it('offers 16:9, 4:3 and 5:4, and shows no frame until one is set', async () => {
    const { panel, container } = await mountExport();
    assert.deepEqual([...panel.querySelectorAll('input[name="aspect"]')].map((r) => r.value), ['16:9', '4:3', '5:4']);
    assert.equal(frameEl(container), null);
    assert.match(panel.textContent, /No frame yet/);
  });

  it('sets the shared frame from the current view: the slide map shape, map centre, fitting inside the view', async () => {
    const { panel, container, settings } = await mountExport();
    pick(radio(panel, '4:3'));
    button(panel, 'Set shared frame from current view').click();
    await waitFor(async () => false, { timeout: 1 }).catch(() => {});
    let frame;
    for (let i = 0; i < 50 && !frame; i++) { frame = (await settings()).frame; await new Promise((r) => setTimeout(r, 20)); }
    assert.equal(frame.aspect, '4:3');
    assert.ok(Math.abs(frame.center.lat - 34) < 1e-6 && Math.abs(frame.center.lng + 117) < 1e-6, JSON.stringify(frame.center));
    await waitFor(() => frameEl(container));
    const box = frameEl(container).getBoundingClientRect();
    const mapBox = container.getBoundingClientRect();
    assert.ok(Math.abs(ratioOf(frameEl(container)) - mapAreaRatio('4:3')) < 0.02, `ratio ${ratioOf(frameEl(container))} vs ${mapAreaRatio('4:3')}`);
    assert.ok(box.left >= mapBox.left && box.right <= mapBox.right && box.top >= mapBox.top && box.bottom <= mapBox.bottom, 'frame fits inside the view');
    assert.ok(box.height > mapBox.height * 0.6 || box.width > mapBox.width * 0.9, 'and fills most of it');
  });

  it('changing the ratio reshapes the frame that is in use', async () => {
    const { panel, container, settings } = await mountExport();
    button(panel, 'Set shared frame from current view').click();
    await waitFor(() => frameEl(container) && Math.abs(ratioOf(frameEl(container)) - mapAreaRatio('16:9')) < 0.02);
    pick(radio(panel, '5:4'));
    await waitFor(() => Math.abs(ratioOf(frameEl(container)) - mapAreaRatio('5:4')) < 0.02, { message: 'frame not reshaped' });
    assert.equal((await settings()).frame.aspect, '5:4');
  });

  it('the frame stays on the same ground when the map is panned', async () => {
    const { panel, container } = await mountExport();
    button(panel, 'Set shared frame from current view').click();
    await waitFor(() => frameEl(container));
    const before = frameEl(container).getBoundingClientRect().left;
    map.panBy([200, 0], { animate: false });
    await waitFor(() => Math.abs(frameEl(container).getBoundingClientRect().left - (before - 200)) < 2);
  });

  it('gives a COA its own frame (reshaping only that one), says so, and goes back to the shared frame', async () => {
    const { panel, container, client, coa, settings } = await mountExport();
    button(panel, 'Set shared frame from current view').click();
    await waitFor(() => frameEl(container) && Math.abs(ratioOf(frameEl(container)) - mapAreaRatio('16:9')) < 0.02);
    map.setView([35, -116], 10, { animate: false });
    button(panel, 'Give this COA its own frame').click();
    await waitFor(() => /This COA has its own frame/.test(panel.textContent));
    pick(radio(panel, '5:4'));
    await waitFor(() => Math.abs(ratioOf(frameEl(container)) - mapAreaRatio('5:4')) < 0.02, { message: 'own frame not reshaped' });
    assert.equal((await client.ask('coa.get', { coaId: coa.id })).value.frame.aspect, '5:4');
    assert.equal((await settings()).frame.aspect, '16:9', 'the shared frame is untouched');
    button(panel, 'Use shared frame').click();
    await waitFor(() => /Using the shared frame/.test(panel.textContent));
    map.setView([34, -117], 9, { animate: false }); // back over the shared frame (Leaflet draws nothing for an off-screen shape)
    await waitFor(() => Math.abs(ratioOf(frameEl(container)) - mapAreaRatio('16:9')) < 0.02, { message: `overlay did not return to the shared frame: ${container.querySelectorAll('.export-frame').length} outlines, ratio ${ratioOf(frameEl(container))}, d=${frameEl(container)?.getAttribute('d')}` });
    assert.equal('frame' in (await client.ask('coa.get', { coaId: coa.id })).value, false);
  });

  it('shows the shared frame for a COA without its own', async () => {
    const { panel, container, client, selection } = await mountExport();
    button(panel, 'Set shared frame from current view').click();
    await waitFor(() => frameEl(container));
    const other = (await client.send('coa.create', { name: 'COA 2' })).value;
    selection.set(other.id);
    await waitFor(() => /Using the shared frame/.test(panel.textContent) && frameEl(container));
  });

  it('follows a frame changed elsewhere', async () => {
    const { panel, container, other } = await mountExport();
    await other.send('settings.update', { expectedRevision: 0, frame: { aspect: '4:3', center: { lat: 34, lng: -117 }, width: 0.2 } });
    await waitFor(() => frameEl(container) && Math.abs(ratioOf(frameEl(container)) - mapAreaRatio('4:3')) < 0.02);
    assert.equal(radio(panel, '4:3').checked, true);
  });

  it('"Zoom to frame" brings an off-screen frame into view', async () => {
    const { panel, container } = await mountExport();
    button(panel, 'Set shared frame from current view').click();
    await waitFor(() => frameEl(container));
    map.setView([0, 0], 9, { animate: false });
    button(panel, 'Zoom to frame').click();
    await waitFor(() => map.getBounds().contains([34, -117]) && Math.abs(ratioOf(frameEl(container)) - mapAreaRatio('16:9')) < 0.02, { message: 'frame not brought into view' });
  });

  it('can hide the frame on the map, and remembers that', async () => {
    const prefs = createMemoryPrefs();
    const first = await mountExport({ prefs });
    button(first.panel, 'Set shared frame from current view').click();
    await waitFor(() => frameEl(first.container));
    const toggle = first.panel.querySelector('input[name="show-frame"]');
    assert.equal(toggle.checked, true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => frameEl(first.container) === null);
    view.destroy(); map.remove(); host.remove(); view = null;
    const second = await mountExport({ prefs });
    assert.equal(second.panel.querySelector('input[name="show-frame"]').checked, false);
  });

  it('removes its overlay and stops listening on destroy', async () => {
    const { panel, container, other } = await mountExport();
    button(panel, 'Set shared frame from current view').click();
    await waitFor(() => frameEl(container));
    view.destroy(); view = null;
    assert.equal(frameEl(container), null);
    await other.send('settings.update', { expectedRevision: 1, frame: null });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(frameEl(container), null);
  });
});

describe('classification marking', () => {
  it('defaults to UNCLASSIFIED on green, shown as a preview banner', async () => {
    const { panel } = await mountExport();
    assert.equal(panel.querySelector('[name="marking-text"]').value, 'UNCLASSIFIED');
    assert.equal(panel.querySelector('[name="marking-color"]').value, '#007a33');
    const banner = panel.querySelector('[data-marking-preview]');
    assert.equal(banner.textContent, 'UNCLASSIFIED');
    assert.equal(getComputedStyle(banner).backgroundColor, 'rgb(0, 122, 51)');
  });

  it('uses dark text on light banners and light text on dark ones', async () => {
    const { panel } = await mountExport();
    const banner = panel.querySelector('[data-marking-preview]');
    assert.equal(getComputedStyle(banner).color, 'rgb(255, 255, 255)', 'white on green');
    button(panel, 'TOP SECRET (orange)').click();
    assert.equal(getComputedStyle(banner).color, 'rgb(0, 0, 0)', 'black on orange');
  });

  it('saves a new marking, with quick colour choices for the standard banners', async () => {
    const { panel, settings } = await mountExport();
    type(panel.querySelector('[name="marking-text"]'), 'CUI');
    button(panel, 'CUI (purple)').click();
    assert.equal(panel.querySelector('[name="marking-color"]').value, '#502b85');
    button(panel, 'Save marking').click();
    let marking;
    for (let i = 0; i < 50 && marking?.text !== 'CUI'; i++) { marking = (await settings()).marking; await new Promise((r) => setTimeout(r, 20)); }
    assert.deepEqual(marking, { text: 'CUI', color: '#502b85' });
  });

  it('refuses a blank marking and says why', async () => {
    const { panel, settings } = await mountExport();
    type(panel.querySelector('[name="marking-text"]'), '   ');
    button(panel, 'Save marking').click();
    await waitFor(() => /blank/i.test(panel.querySelector('[data-error-for="marking-text"]').textContent));
    assert.equal((await settings()).marking.text, 'UNCLASSIFIED');
  });
});

describe('export data files (JSON, GeoJSON, CSV)', () => {
  const INF = '10031000001211000000';
  async function withSaved(options) {
    const saved = [];
    const ctx = await mountExport({ ...options, saveFile: async (blob, name) => { saved.push({ name, type: blob.type, text: await blob.text() }); } });
    await ctx.client.send('symbol.add', { coaId: ctx.coa.id, sidc: INF, position: { lat: 34, lng: -117 }, label: 'A' });
    const other = (await ctx.client.send('coa.create', { name: 'COA 2' })).value;
    await ctx.client.send('symbol.add', { coaId: other.id, sidc: INF, position: { lat: 35, lng: -116 }, label: 'B' });
    return { ...ctx, saved, other };
  }
  const dataRadio = (panel, value) => panel.querySelector(`input[name="data-format"][value="${value}"]`);

  it('offers JSON, GeoJSON, CSV, the weapons CSV, KML, KMZ, TAK and NVG, JSON first, each with its name', async () => {
    const { panel } = await mountExport();
    assert.deepEqual([...panel.querySelectorAll('input[name="data-format"]')].map((r) => r.value), ['json', 'geojson', 'csv', 'weapons', 'kml', 'kmz', 'tak', 'nvg']);
    assert.deepEqual([...panel.querySelectorAll('input[name="data-format"] + span')].map((s) => s.textContent), ['JSON', 'GeoJSON', 'CSV', 'Weapons', 'KML', 'KMZ', 'TAK', 'NVG']);
    assert.equal(dataRadio(panel, 'json').checked, true);
  });

  it('downloads the selected COA as a re-importable JSON file, read fresh at download time', async () => {
    const { panel, saved } = await withSaved();
    button(panel, 'Download this COA').click();
    await waitFor(() => saved.length === 1);
    assert.match(saved[0].name, /^coa-1_\d{6}Z[A-Z]{3}\d{2}\.json$/);
    assert.equal(saved[0].type, 'application/json');
    const doc = JSON.parse(saved[0].text);
    assert.equal(doc.format, 'coa-builder/import');
    assert.deepEqual(doc.coas.map((c) => [c.name, c.units.map((u) => u.label)]), [['COA 1', ['A']]]);
    assert.match(panel.querySelector('[role=status]').textContent, /Saved coa-1_.*\.json/);
  });

  it('downloads all COAs in one file in the chosen format, and remembers the format', async () => {
    const prefs = createMemoryPrefs();
    const { panel, saved } = await withSaved({ prefs });
    pick(dataRadio(panel, 'csv'));
    button(panel, 'Download all COAs').click();
    await waitFor(() => saved.length === 1);
    assert.match(saved[0].name, /^coas_\d{6}Z[A-Z]{3}\d{2}\.csv$/);
    assert.match(saved[0].type, /^text\/csv/);
    const lines = saved[0].text.replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.match(lines[0], /^# UNCLASSIFIED \/\/ Default \/\/ exported \d{6}Z[A-Z]{3}\d{2} \/\/ COA Builder [\d.]+ \/\/ csv v1$/, 'the marking comes first');
    assert.deepEqual(lines.slice(2).map((l) => l.split(',')[0]), ['COA 1', 'COA 2']);
    assert.equal(prefs.get('dataFormat'), 'csv');
  });

  it('GeoJSON holds every unit as a point', async () => {
    const { panel, saved } = await withSaved();
    pick(dataRadio(panel, 'geojson'));
    button(panel, 'Download all COAs').click();
    await waitFor(() => saved.length === 1);
    const doc = JSON.parse(saved[0].text);
    assert.deepEqual(doc.features.map((f) => [f.properties.coa, f.geometry.coordinates]), [['COA 1', [-117, 34]], ['COA 2', [-116, 35]]]);
  });

  it('asks for a COA to be selected before downloading this COA', async () => {
    const { panel, saved, selection } = await withSaved();
    selection.set(null);
    await new Promise((r) => setTimeout(r, 30));
    button(panel, 'Download this COA').click();
    await waitFor(() => /Select a COA first/.test(panel.querySelector('[role=status]').textContent));
    assert.equal(saved.length, 0);
  });
});

describe('KMZ, TAK and NVG export (Epic 5 X-3, X-5)', () => {
  it('saves a zip with doc.kml first and each unit\'s symbol as a PNG icon the KML points at', async () => {
    const saved = [];
    const { panel, client } = await mountExport({ saveFile: async (blob, name) => { saved.push({ name, blob }); } });
    const coa = (await client.send('coa.create', { name: 'KMZ test' })).value;
    await client.send('symbol.add', { coaId: coa.id, sidc: '10061000001211000000', position: { lat: 34, lng: -118 }, label: 'A', hvt: true });
    await client.send('symbol.add', { coaId: coa.id, sidc: '10031000001211000000', position: { lat: 34.1, lng: -118 }, label: 'B' });
    pick(panel.querySelector('input[name="data-format"][value="kmz"]'));
    button(panel, 'Download all COAs').click();
    await waitFor(() => saved.length === 1, { timeout: 5000 });
    assert.match(saved[0].name, /\.kmz$/);
    const bytes = new Uint8Array(await saved[0].blob.arrayBuffer());
    const files = readZip(bytes);
    assert.equal(files[0].name, 'doc.kml');
    assert.deepEqual(files.slice(1).map((f) => f.name).sort(), ['icons/10031000001211000000.png', 'icons/10061000001211000000.png']);
    for (const f of files.slice(1)) assert.deepEqual([...f.data.slice(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
    const kml = new TextDecoder().decode(files[0].data);
    assert.match(kml, /<Icon><href>icons\/10061000001211000000.png<\/href><\/Icon>/);
    assert.match(kml, /<name>A \[HVT\]<\/name>/);
  });

  it('saves a TAK data package (X-5): the manifest, then one CoT event per unit and drawing, with the marking', async () => {
    const saved = [];
    const { panel, client } = await mountExport({ saveFile: async (blob, name) => { saved.push({ name, blob }); } });
    const coa = (await client.send('coa.create', { name: 'TAK test' })).value;
    await client.send('symbol.add', { coaId: coa.id, sidc: '10061000001211000000', position: { lat: 34, lng: -118 }, label: 'A', hvt: true });
    pick(panel.querySelector('input[name="data-format"][value="tak"]'));
    button(panel, 'Download all COAs').click();
    await waitFor(() => saved.length === 1, { timeout: 5000 });
    assert.match(saved[0].name, /^coas_\d{6}Z[A-Z]{3}\d{2}\.zip$/);
    const files = readZip(new Uint8Array(await saved[0].blob.arrayBuffer()));
    const stored = (await client.ask('coa.get', { coaId: coa.id })).value;
    const path = `cot/coa-builder.${coa.id}.${stored.symbols[0].id}.cot`;
    assert.equal(files[0].name, 'MANIFEST/manifest.xml');
    assert.ok(files.some((f) => f.name === path), path);
    const manifest = new DOMParser().parseFromString(new TextDecoder().decode(files[0].data), 'application/xml');
    assert.equal(manifest.querySelector('parsererror'), null);
    assert.deepEqual([...manifest.querySelectorAll('Content')].map((c) => c.getAttribute('zipEntry')), files.slice(1).map((f) => f.name));
    assert.match(manifest.querySelector('Parameter[name="name"]').getAttribute('value'), /COAs \(UNCLASSIFIED\)$/);
    const event = new DOMParser().parseFromString(new TextDecoder().decode(files.find((f) => f.name === path).data), 'application/xml').documentElement;
    assert.deepEqual([event.getAttribute('type'), event.querySelector('contact').getAttribute('callsign'), event.querySelector('point').getAttribute('lat')], ['a-h-G-U', 'A [HVT]', '34']);
    assert.match(event.querySelector('remarks').textContent, /^UNCLASSIFIED \| COA: TAK test \| HVT/);
  });

  it('saves NVG 2.0 (X-5): a well-formed document with the unit as a point carrying its symbol code', async () => {
    const saved = [];
    const { panel, client } = await mountExport({ saveFile: async (blob, name) => { saved.push({ name, blob }); } });
    const coa = (await client.send('coa.create', { name: 'NVG test' })).value;
    await client.send('symbol.add', { coaId: coa.id, sidc: '10061000001211000000', position: { lat: 34, lng: -118 }, label: 'A' });
    pick(panel.querySelector('input[name="data-format"][value="nvg"]'));
    button(panel, 'Download all COAs').click();
    await waitFor(() => saved.length === 1, { timeout: 5000 });
    assert.match(saved[0].name, /\.nvg$/);
    const doc = new DOMParser().parseFromString(await saved[0].blob.text(), 'application/xml');
    assert.equal(doc.querySelector('parsererror'), null);
    assert.equal(doc.documentElement.getAttribute('version'), '2.0.2');
    const point = doc.getElementsByTagName('point')[0];
    assert.deepEqual([point.getAttribute('symbol'), point.getAttribute('label'), point.getAttribute('x')], ['2525d:10061000001211000000', 'A', '-118']);
  });
});

/** The stored files of a ZIP (enough to check our own writer). */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = [];
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.slice(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    files.push({ name, data: bytes.slice(start, start + size) });
    at = start + size;
  }
  return files;
}
