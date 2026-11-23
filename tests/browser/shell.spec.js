// Layout v2 (COA-5b.1): one left tools panel of collapsible sections, tested on the real index.html markup.
import { describe, it, afterEach, assert } from './runner.js';
import { mountUi } from '../../src/adapters/ui/mount-ui.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';

const fakeClient = () => ({ send: async () => ({ ok: true, value: null }), ask: async () => ({ ok: true, value: [] }), subscribe: () => () => {}, revisionOf: () => undefined });

let host;
let ui;

/** Mount the UI on a fresh copy of the real index.html #app markup. */
async function mount({ width = 1200, ...options } = {}) {
  const html = await (await fetch('../../index.html')).text();
  const app = new DOMParser().parseFromString(html, 'text/html').querySelector('#app');
  host = document.createElement('div');
  host.style.cssText = `position: relative; width: ${width}px; height: 700px;`;
  host.append(document.importNode(app, true));
  document.getElementById('sandbox').append(host);
  ui = mountUi({ client: fakeClient(), L: window.L, root: host.querySelector('#app'), narrow: false, prefs: createMemoryPrefs(), ...options });
  await ui.ready;
  return host.querySelector('#app');
}

const panel = (root) => root.querySelector('#side-panel');
const panelToggle = (root) => root.querySelector('[aria-controls="side-panel"]');
const section = (root, name) => root.querySelector(`[data-section="${name}"]`);
const sectionToggle = (root, name) => section(root, name).querySelector('.section-toggle');
const sectionBody = (root, name) => section(root, name).querySelector('.section-body');
const isShown = (el) => getComputedStyle(el).display !== 'none';

afterEach(() => { ui?.destroy(); host?.remove(); ui = null; host = null; });

describe('app shell (layout v2)', () => {
  it('has one tools panel on the left with COAs, Units and Map sections, and the map beside it', async () => {
    const root = await mount();
    assert.equal(root.querySelector('h1').textContent, 'COA Builder');
    assert.equal(panel(root).getAttribute('aria-label'), 'Tools');
    assert.deepEqual([...root.querySelectorAll('[data-section]')].map((s) => s.dataset.section), ['coas', 'units', 'map']);
    for (const name of ['coas', 'units', 'map']) assert.equal(sectionToggle(root, name).tagName, 'BUTTON');
    const panelBox = panel(root).getBoundingClientRect();
    const mapBox = root.querySelector('#map').getBoundingClientRect();
    assert.ok(panelBox.right <= mapBox.left + 1, 'panel is left of the map');
  });

  it('opens the panel on a wide screen and starts it closed on a narrow one', async () => {
    let root = await mount({ narrow: false });
    assert.ok(isShown(panel(root)));
    assert.equal(panelToggle(root).getAttribute('aria-expanded'), 'true');
    ui.destroy(); host.remove();
    root = await mount({ narrow: true });
    assert.ok(!isShown(panel(root)));
    assert.equal(panelToggle(root).getAttribute('aria-expanded'), 'false');
  });

  it('hides and shows the whole panel from the header button', async () => {
    const root = await mount();
    panelToggle(root).click();
    assert.ok(!isShown(panel(root)));
    assert.equal(panelToggle(root).getAttribute('aria-expanded'), 'false');
    panelToggle(root).click();
    assert.ok(isShown(panel(root)));
  });

  it('collapses and expands a section from its header, keeping aria-expanded in step', async () => {
    const root = await mount();
    assert.ok(isShown(sectionBody(root, 'units')));
    sectionToggle(root, 'units').click();
    assert.ok(!isShown(sectionBody(root, 'units')));
    assert.equal(sectionToggle(root, 'units').getAttribute('aria-expanded'), 'false');
    assert.ok(isShown(sectionBody(root, 'coas')), 'other sections are unaffected');
    sectionToggle(root, 'units').click();
    assert.ok(isShown(sectionBody(root, 'units')));
  });

  it('remembers which sections are collapsed (in this browser)', async () => {
    const prefs = createMemoryPrefs();
    let root = await mount({ prefs });
    sectionToggle(root, 'map').click();
    ui.destroy(); host.remove();
    root = await mount({ prefs });
    assert.ok(!isShown(sectionBody(root, 'map')));
    assert.equal(sectionToggle(root, 'map').getAttribute('aria-expanded'), 'false');
  });

  it('on a narrow screen hides the panel while picking a position on the map, then brings it back', async () => {
    const root = await mount({ narrow: true });
    panelToggle(root).click();
    assert.ok(isShown(panel(root)));
    ui.picker.request(() => {});
    assert.ok(!isShown(panel(root)), 'panel should step aside for the map');
    ui.picker.resolve({ lat: 0, lng: 0 });
    assert.ok(isShown(panel(root)));
  });

  it('says where data is stored, as plain text', async () => {
    const root = await mount({ storageLabel: '<b>Memory</b> only' });
    const status = root.querySelector('[data-storage-status]');
    assert.equal(status.textContent, '<b>Memory</b> only');
    assert.equal(status.querySelector('b'), null);
  });

  it('mounts a Leaflet map in the map region', async () => {
    const root = await mount();
    assert.ok(root.querySelector('#map').classList.contains('leaflet-container'));
    assert.ok(root.querySelector('#map .leaflet-control-zoom'), 'zoom control present');
  });

  it('destroy releases the map and the toggles, so the UI can be mounted again', async () => {
    const root = await mount();
    ui.destroy();
    panelToggle(root).click();
    assert.equal(panelToggle(root).getAttribute('aria-expanded'), 'true', 'old toggle listener still attached');
    ui = mountUi({ client: fakeClient(), L: window.L, root, narrow: false, prefs: createMemoryPrefs() });
    panelToggle(root).click();
    assert.equal(panelToggle(root).getAttribute('aria-expanded'), 'false');
  });

  it('needs a root element and Leaflet', () => {
    assert.throws(() => mountUi({ client: fakeClient(), L: window.L, root: null }), TypeError);
    assert.throws(() => mountUi({ client: fakeClient(), L: undefined, root: document.createElement('div') }), TypeError);
  });
});
