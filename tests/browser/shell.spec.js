// COA-2.1 — the app shell, tested at the DOM boundary against the real index.html markup.
import { describe, it, afterEach, assert } from './runner.js';
import { mountUi } from '../../src/adapters/ui/mount-ui.js';

const fakeClient = () => ({ send: async () => ({ ok: true, value: null }), ask: async () => ({ ok: true, value: [] }), subscribe: () => () => {} });

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
  ui = mountUi({ client: fakeClient(), L: window.L, root: host.querySelector('#app'), narrow: false, ...options });
  return host.querySelector('#app');
}

const panel = (root, name) => root.querySelector(`#${name}-panel`);
const toggle = (root, name) => root.querySelector(`[aria-controls="${name}-panel"]`);
const isShown = (el) => getComputedStyle(el).display !== 'none';

afterEach(() => { ui?.destroy(); host?.remove(); ui = null; host = null; });

describe('app shell', () => {
  it('shows the title, the map, and labelled COA and symbol panels', async () => {
    const root = await mount();
    assert.equal(root.querySelector('h1').textContent, 'COA Builder');
    assert.equal(root.querySelector('#map').getAttribute('aria-label'), 'Map');
    assert.equal(panel(root, 'coa').getAttribute('aria-label'), 'Courses of action');
    assert.equal(panel(root, 'editor').getAttribute('aria-label'), 'Symbol editor');
  });

  it('opens both panels on a wide screen', async () => {
    const root = await mount({ narrow: false });
    for (const name of ['coa', 'editor']) {
      assert.ok(isShown(panel(root, name)), `${name} panel hidden`);
      assert.equal(toggle(root, name).getAttribute('aria-expanded'), 'true');
    }
  });

  it('starts with both panels closed on a narrow screen', async () => {
    const root = await mount({ narrow: true });
    for (const name of ['coa', 'editor']) {
      assert.ok(!isShown(panel(root, name)), `${name} panel shown`);
      assert.equal(toggle(root, name).getAttribute('aria-expanded'), 'false');
    }
  });

  it('closes and reopens a panel from its toggle, keeping aria-expanded in step', async () => {
    const root = await mount();
    toggle(root, 'coa').click();
    assert.ok(!isShown(panel(root, 'coa')));
    assert.equal(toggle(root, 'coa').getAttribute('aria-expanded'), 'false');
    assert.ok(isShown(panel(root, 'editor')), 'the other panel is unaffected');
    toggle(root, 'coa').click();
    assert.ok(isShown(panel(root, 'coa')));
    assert.equal(toggle(root, 'coa').getAttribute('aria-expanded'), 'true');
  });

  it('on a narrow screen opening one panel closes the other', async () => {
    const root = await mount({ narrow: true });
    toggle(root, 'coa').click();
    toggle(root, 'editor').click();
    assert.ok(!isShown(panel(root, 'coa')) && isShown(panel(root, 'editor')));
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
    toggle(root, 'coa').click();
    assert.equal(toggle(root, 'coa').getAttribute('aria-expanded'), 'true', 'old toggle listener still attached');
    ui = mountUi({ client: fakeClient(), L: window.L, root, narrow: false }); // Leaflet throws if the old map was not removed
    toggle(root, 'coa').click();
    assert.equal(toggle(root, 'coa').getAttribute('aria-expanded'), 'false');
  });

  it('needs a root element and Leaflet', () => {
    assert.throws(() => mountUi({ client: fakeClient(), L: window.L, root: null }), TypeError);
    assert.throws(() => mountUi({ client: fakeClient(), L: undefined, root: document.createElement('div') }), TypeError);
  });
});
