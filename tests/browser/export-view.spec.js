// COA-6a.1: the Export section (frame and marking) and the frame drawn on the map.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type } from './app-fixture.js';
import { mountExportView } from '../../src/adapters/ui/views/export-view.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';
import { mapAreaRatio } from '../../src/adapters/export/slide-layout.js';

let host; let map; let view;
afterEach(() => { view?.destroy(); map?.remove(); host?.remove(); view = null; map = null; host = null; });

async function mountExport({ prefs = createMemoryPrefs() } = {}) {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  const selection = createSelection(coa.id);
  host = sandbox();
  const panel = document.createElement('div');
  const container = document.createElement('div');
  container.style.cssText = 'width: 900px; height: 600px;';
  host.append(panel, container);
  map = window.L.map(container, { center: [34, -117], zoom: 9 });
  view = mountExportView({ client: fixture.client, root: panel, L: window.L, map, selection, prefs });
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
