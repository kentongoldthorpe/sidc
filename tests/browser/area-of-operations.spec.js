// E6-6: setting the area of operations, its outline, and the flags on items outside it.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type } from './app-fixture.js';
import { mountAoView } from '../../src/adapters/ui/views/ao-view.js';
import { mountSymbolEditorView } from '../../src/adapters/ui/views/symbol-editor-view.js';
import { mountCoaVersionView } from '../../src/adapters/ui/views/coa-version-view.js';
import { createAoStore } from '../../src/adapters/ui/ao-store.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createPicker } from '../../src/adapters/ui/map-picker.js';
import { mgrsOf } from '../../src/domain/mgrs.js';

const L = window.L;
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

async function setup() {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  await fixture.client.send('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: '10031000001211000000', position: { mgrs: '18S UJ 2500 0500' }, label: 'In' });
  await fixture.client.send('symbol.add', { coaId: coa.id, expectedRevision: 2, sidc: '10031000001211000000', position: { mgrs: '18S UJ 2500 5000' }, label: 'Typo' });
  const selection = createSelection(coa.id);
  const activeCoa = createActiveCoa({ client: fixture.client, selection });
  const aoStore = createAoStore({ client: fixture.client });
  const host = sandbox();
  const panel = document.createElement('div');
  const editorEl = document.createElement('div');
  const versionEl = document.createElement('div');
  const container = document.createElement('div');
  container.style.cssText = 'width: 600px; height: 400px;';
  host.append(panel, editorEl, versionEl, container);
  const map = L.map(container, { center: [38.86, -77.05], zoom: 11, animate: false });
  const views = [
    mountAoView({ client: fixture.client, root: panel, L, map, aoStore }),
    mountSymbolEditorView({ client: fixture.client, root: editorEl, selection, symbolSelection: createSelection(), picker: createPicker(), activeCoa, aoStore }),
    mountCoaVersionView({ client: fixture.client, root: versionEl, activeCoa, aoStore }),
  ];
  cleanups.push(() => { views.forEach((v) => v.destroy()); aoStore.destroy(); activeCoa.destroy(); map.remove(); host.remove(); });
  await Promise.all([activeCoa.ready, aoStore.ready, views[1].ready]);
  return { ...fixture, panel, editorEl, versionEl, container, map, aoStore };
}

describe('area of operations', () => {
  it('is set from two corners as a box, outlined on the map, and cleared', async () => {
    const s = await setup();
    assert.equal(s.panel.querySelector('[data-ao-summary]').textContent, 'Not set.');
    type(s.panel.querySelector('[name="ao-name"]'), 'AO IRON');
    type(s.panel.querySelector('[name="ao-points"]'), '18S UJ 2000 0000\n18S UJ 3000 1000');
    button(s.panel, 'Set').click();
    await waitFor(() => /^AO IRON: 4 corners, the first at 18S UJ 20 00\.$/.test(s.panel.querySelector('[data-ao-summary]').textContent));
    assert.ok(s.container.querySelector('path.ao-outline'));
    assert.equal(mgrsOf(s.aoStore.get().points[2]), '18S UJ 3000 1000');
    s.panel.querySelector('[data-clear-ao]').click();
    await waitFor(() => s.panel.querySelector('[data-ao-summary]').textContent === 'Not set.');
    assert.equal(s.container.querySelector('path.ao-outline'), null);
  });

  it('says which line is wrong', async () => {
    const s = await setup();
    type(s.panel.querySelector('[name="ao-points"]'), '18S UJ 2000 0000\n18S UJ 300 1000');
    button(s.panel, 'Set').click();
    assert.match(s.panel.querySelector('.field-error').textContent, /^Line 2: .*same number of digits/);
  });

  it('flags units outside it in the list and the COA panel, and warns while a grid is typed', async () => {
    const s = await setup();
    assert.equal(s.versionEl.querySelector('[data-outside-ao]').textContent, '');
    type(s.panel.querySelector('[name="ao-name"]'), 'AO IRON');
    type(s.panel.querySelector('[name="ao-points"]'), '18S UJ 2000 0000\n18S UJ 3000 1000');
    button(s.panel, 'Set').click();
    await waitFor(() => /^⚠ 1 outside AO IRON: Typo\. Check their grids\.$/.test(s.versionEl.querySelector('[data-outside-ao]').textContent));
    await waitFor(() => [...s.editorEl.querySelectorAll('[data-unit-grid]')].map((x) => x.classList.contains('is-outside')).join() === 'false,true');
    assert.match(s.editorEl.querySelectorAll('[data-unit-grid]')[1].textContent, /^⚠ 18S UJ 2500 5000$/);
    [...s.editorEl.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add unit').click();
    await waitFor(() => s.editorEl.querySelector('[data-unit-form] [name="mgrs"]'));
    type(s.editorEl.querySelector('[data-unit-form] [name="mgrs"]'), '18S UJ 2500 5000');
    assert.match(s.editorEl.querySelector('[data-ao-warning]').textContent, /^⚠ Outside AO IRON: check the grid\.$/);
    type(s.editorEl.querySelector('[data-unit-form] [name="mgrs"]'), '18S UJ 2500 0500');
    assert.equal(s.editorEl.querySelector('[data-ao-warning]').textContent, '');
  });
});
