// Layout v2 (COA-5b.1): one left tools panel of collapsible sections, tested on the real index.html markup.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { mountUi } from '../../src/adapters/ui/mount-ui.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';
import { createTestApp, BreakableRepository } from './app-fixture.js';

const DEFAULT_SETTINGS = { revision: 0, frame: null, marking: { text: 'UNCLASSIFIED', color: '#007a33' } };
const fakeClient = () => ({
  send: async () => ({ ok: true, value: null }),
  ask: async (type) => ({ ok: true, value: type === 'settings.get' ? DEFAULT_SETTINGS : [] }),
  subscribe: () => () => {},
  revisionOf: () => undefined,
});

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
  it('has one tools panel on the left with COAs, Units, Map and Export sections, and the map beside it', async () => {
    const root = await mount();
    assert.equal(root.querySelector('h1').textContent, 'COA Builder');
    assert.equal(panel(root).getAttribute('aria-label'), 'Tools');
    assert.deepEqual([...root.querySelectorAll('[data-section]')].map((s) => s.dataset.section), ['project', 'coas', 'units', 'graphics', 'map', 'export', 'threat-models', 'threat-coas', 'template', 'unit-templates']);
    for (const name of ['project', 'coas', 'units', 'graphics', 'map', 'export', 'threat-models', 'threat-coas', 'template', 'unit-templates']) assert.equal(sectionToggle(root, name).tagName, 'BUTTON');
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

  it('closing the panel on a wide screen gives the map the whole width (it used to shrink to nothing)', async () => {
    const root = await mount({ width: 1000 });
    panelToggle(root).click();
    assert.ok(!isShown(panel(root)));
    const mapBox = root.querySelector('#map').getBoundingClientRect();
    assert.ok(Math.abs(mapBox.width - 1000) < 2, `map width ${mapBox.width}`);
    panelToggle(root).click();
    assert.ok(root.querySelector('#map').getBoundingClientRect().width < 1000, 'and shares it again when reopened');
  });

  it('follows the screen width as it changes: picking hides the panel only while the screen is narrow', async () => {
    const listeners = new Set();
    const media = { matches: false, addEventListener: (t, fn) => listeners.add(fn), removeEventListener: (t, fn) => listeners.delete(fn) };
    const resize = (narrow) => { media.matches = narrow; listeners.forEach((fn) => fn({ matches: narrow })); };
    const root = await mount({ narrow: undefined, media });
    assert.ok(isShown(panel(root)), 'wide: panel open');

    ui.picker.request(() => {});
    assert.ok(isShown(panel(root)), 'wide: the panel stays while picking');
    ui.picker.cancel();

    resize(true);
    ui.picker.request(() => {});
    assert.ok(!isShown(panel(root)), 'narrow: the panel steps aside while picking');
    ui.picker.cancel();
    assert.ok(isShown(panel(root)), 'and comes back');

    resize(false);
    ui.picker.request(() => {});
    assert.ok(isShown(panel(root)), 'wide again: the panel stays');
    ui.picker.cancel();
    ui.destroy(); ui = null;
    assert.equal(listeners.size, 0, 'destroy stops listening');
  });

  it('on a narrow screen hides the panel while drawing a line, then brings it back; drawing and picking exclude each other', async () => {
    const root = await mount({ narrow: true });
    panelToggle(root).click();
    ui.drawer.request({ shape: 'line' }, () => {});
    assert.ok(!isShown(panel(root)), 'panel should step aside for the map');
    ui.drawer.cancel();
    assert.ok(isShown(panel(root)));

    ui.picker.request(() => {});
    ui.drawer.request({ shape: 'line' }, () => {});
    assert.equal(ui.picker.isActive(), false, 'drawing cancels picking');
    ui.picker.request(() => {});
    assert.equal(ui.drawer.isActive(), false, 'picking cancels drawing');
    ui.picker.cancel();
  });

  it('reads the active COA once per change for the whole UI, not once per view', async () => {
    const fixture = createTestApp();
    const coa = (await fixture.client.send('coa.create', { name: 'A' })).value;
    let gets = 0;
    const client = { ...fixture.client, ask: (type, ...rest) => { if (type === 'coa.get') gets += 1; return fixture.client.ask(type, ...rest); } };
    await mount({ client });
    ui.selection.set(coa.id);
    await new Promise((r) => setTimeout(r, 100));
    gets = 0;
    await fixture.other.send('symbol.add', { coaId: coa.id, sidc: '10031000001211000000', position: { lat: 1, lng: 1 } });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(gets, 1, `coa.get calls after one change: ${gets}`);
  });

  it('raises the storage banner from any view when a change is not saved, and offers a backup from the COAs section', async () => {
    const repo = new BreakableRepository();
    const fixture = createTestApp({ documentRepository: repo });
    const saved = [];
    const root = await mount({ client: fixture.client, saveFile: async (blob, name) => { saved.push(name); } });
    const coa = (await ui.health.client.send('coa.create', { name: 'A' })).value;
    ui.selection.set(coa.id);
    repo.failWrites = 'STORAGE_UNAVAILABLE';
    await ui.health.client.send('coa.update', { coaId: coa.id, name: 'B' });
    const banner = root.querySelector('[data-storage-banner]');
    assert.equal(banner.hidden, false);
    assert.ok(banner.closest('.app-main'), 'over the map area');
    [...root.querySelectorAll('[data-section="coas"] button')].find((b) => b.textContent === 'Back up all COAs').click();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(saved.length, 1);
    assert.match(saved[0], /^coas-backup_/);
  });

  it('shows the version and build in the title\'s tooltip', async () => {
    const root = await mount();
    assert.match(root.querySelector('.app-title').title, /^COA Builder \d+\.\d+\.\d+ \(build (dev|\d{4}-.+)\)$/);
  });

  it('starts the Unit templates section collapsed (until opened; then remembered as usual)', async () => {
    const root = await mount();
    ui.setWorkspace('threat');
    assert.equal(sectionToggle(root, 'unit-templates').getAttribute('aria-expanded'), 'false');
    assert.equal(sectionToggle(root, 'coas').getAttribute('aria-expanded'), 'true');
  });

  it('switches between the Map and Threat models workspaces from the header, and remembers the choice', async () => {
    const prefs = createMemoryPrefs();
    const root = await mount({ prefs });
    const shownSections = () => [...root.querySelectorAll('[data-section]')].filter(isShown).map((s) => s.dataset.section);
    assert.deepEqual(shownSections(), ['project', 'coas', 'units', 'graphics', 'map', 'export', 'unit-templates']);
    assert.ok(isShown(root.querySelector('#map')) && !isShown(root.querySelector('#template-canvas')));
    const threat = root.querySelector('[data-workspace-switch] input[value="threat"]');
    threat.checked = true;
    threat.dispatchEvent(new Event('change', { bubbles: true }));
    assert.deepEqual(shownSections(), ['project', 'threat-models', 'threat-coas', 'template', 'unit-templates']);
    assert.ok(!isShown(root.querySelector('#map')) && isShown(root.querySelector('#template-canvas')));
    assert.ok(!isShown(root.querySelector('[data-region="history"]')), 'undo/redo belong to the map workspace');
    assert.equal(prefs.get('workspace'), 'threat');
    ui.destroy(); host.remove();
    const again = await mount({ prefs });
    assert.ok(isShown(again.querySelector('#template-canvas')), 'reopens in the threat workspace');
  });

  it('has Undo and Redo in the header', async () => {
    const root = await mount();
    const header = root.querySelector('.app-header');
    assert.deepEqual([...header.querySelectorAll('.history-actions button')].map((b) => [b.textContent, b.disabled]), [['Undo', true], ['Redo', true]]);
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

describe('the real app (index.html + main.js)', () => {
  it('starts without errors and exposes coaBuilder for console use', async () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width: 1000px; height: 700px;';
    const errors = [];
    document.getElementById('sandbox').append(frame);
    try {
      frame.src = '../../index.html';
      await new Promise((r) => frame.addEventListener('load', r, { once: true }));
      frame.contentWindow.addEventListener('error', (e) => errors.push(e.message));
      frame.contentWindow.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
      const start = performance.now();
      while (!frame.contentWindow.coaBuilder && errors.length === 0 && performance.now() - start < 4000) await new Promise((r) => setTimeout(r, 25));
      assert.deepEqual(errors, []);
      assert.ok(frame.contentWindow.coaBuilder, 'main.js did not finish starting (an error during start-up?)');
      assert.ok(frame.contentDocument.querySelector('#map.leaflet-container'));
    } finally {
      frame.remove();
    }
  });
});

describe('test helpers', () => {
  it('waitFor awaits an async condition instead of taking the promise as true', async () => {
    let failed = false;
    try { await waitFor(async () => false, { timeout: 30 }); } catch { failed = true; }
    assert.equal(failed, true);
    assert.equal(await waitFor(async () => 'yes'), 'yes');
  });
});
