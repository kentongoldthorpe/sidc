// E6-4: the Overlay at map scale panel.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox } from './app-fixture.js';
import { mountOverlayView } from '../../src/adapters/ui/views/overlay-view.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';

let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };

async function setup({ empty = false } = {}) {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  if (!empty) {
    await fixture.client.send('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: '10031000001211000000', position: { mgrs: '18S UJ 2348 0648' }, label: 'A' });
    await fixture.client.send('symbol.add', { coaId: coa.id, expectedRevision: 2, sidc: '10031000001211000000', position: { mgrs: '18S UJ 3348 0648' }, label: 'B' });
  }
  const activeCoa = createActiveCoa({ client: fixture.client, selection: createSelection(coa.id) });
  const host = sandbox();
  const saved = [];
  const printed = [];
  const prefs = createMemoryPrefs();
  const view = mountOverlayView({ client: fixture.client, root: host, activeCoa, prefs, saveFile: async (blob, name) => { saved.push({ blob, name }); }, printHtml: async (html) => { printed.push(html); } });
  cleanups.push(() => { view.destroy(); activeCoa.destroy(); host.remove(); });
  await activeCoa.ready;
  return { ...fixture, host, saved, printed, prefs };
}

describe('Overlay at map scale', () => {
  it('says how many sheets the COA needs at the chosen scale, and remembers the choice', async () => {
    const s = await setup();
    await waitFor(() => /^1 sheet, UTM zone 18N; each sheet 12\.9 × 7\.3 km\.$/.test(s.host.querySelector('[data-overlay-sheets]').textContent));
    choose(s.host.querySelector('[name="overlay-scale"]'), '25000');
    assert.match(s.host.querySelector('[data-overlay-sheets]').textContent, /^2 sheets \(1 × 2\), UTM zone 18N; each sheet 6\.4 × 3\.7 km\.$/);
    assert.equal(s.prefs.get('overlayScale'), 25000);
  });

  it('prints the overlay with the COA\'s symbols, at scale, and saves it as HTML', async () => {
    const s = await setup();
    button(s.host, 'Print…').click();
    await waitFor(() => s.printed.length === 1);
    assert.match(s.printed[0], /<svg class="map"[^>]* width="257.4mm"/);
    assert.equal((s.printed[0].match(/<image /g) ?? []).length, 2, 'both units, as their symbols');
    assert.match(s.host.textContent, /choose Actual size \(100 %\)/);
    choose(s.host.querySelector('[name="overlay-paper"]'), 'a4');
    choose(s.host.querySelector('[name="overlay-orientation"]'), 'portrait');
    button(s.host, 'Save (HTML)').click();
    await waitFor(() => s.saved.length === 1);
    assert.match(s.saved[0].name, /^coa-1-overlay-1-50000_\d{6}Z[A-Z]{3}\d{2}\.html$/);
    assert.match(await s.saved[0].blob.text(), /@page \{ size: A4 portrait/);
  });

  it('says when there is nothing to print', async () => {
    const s = await setup({ empty: true });
    await waitFor(() => s.host.querySelector('[data-overlay-sheets]').textContent === 'This COA has nothing on it yet.');
    button(s.host, 'Print…').click();
    await waitFor(() => /nothing on it yet/.test(s.host.querySelector('[role="status"]').textContent));
    assert.equal(s.printed.length, 0);
  });
});
