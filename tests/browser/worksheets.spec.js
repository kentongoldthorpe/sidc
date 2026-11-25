// E6-2: the Worksheets panel: print, save as HTML, CSV templates; blank or pre-filled.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox } from './app-fixture.js';
import { mountWorksheetsView } from '../../src/adapters/ui/views/worksheets-view.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';
import { coaFingerprint } from '../../src/domain/coa-changes.js';

let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };

async function setup({ select = true, realPrint = false } = {}) {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  await fixture.client.send('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: '10031000001211000000', position: { mgrs: '18S UJ 2348 0648' }, label: '1-22 IN' });
  const selection = createSelection(select ? coa.id : null);
  const activeCoa = createActiveCoa({ client: fixture.client, selection });
  const host = sandbox();
  const saved = [];
  const printed = [];
  const prefs = createMemoryPrefs();
  const view = mountWorksheetsView({ client: fixture.client, root: host, activeCoa, prefs, saveFile: async (blob, name) => { saved.push({ blob, name }); },
    ...(realPrint ? {} : { printHtml: async (html) => { printed.push(html); } }) });
  cleanups.push(() => { view.destroy(); activeCoa.destroy(); host.remove(); document.querySelectorAll('iframe[aria-hidden="true"]').forEach((f) => f.remove()); });
  await activeCoa.ready;
  const get = async () => (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
  return { ...fixture, host, saved, printed, prefs, get };
}

describe('Worksheets panel', () => {
  it('prints all three worksheets pre-filled from the selected COA, with its version', async () => {
    const s = await setup();
    button(s.host, 'Print…').click();
    await waitFor(() => s.printed.length === 1);
    const html = s.printed[0];
    assert.match(html, /<h1>Unit worksheet<\/h1>[\s\S]*<h1>Lines and areas worksheet<\/h1>[\s\S]*<h1>Change sheet<\/h1>/);
    assert.match(html, new RegExp(`Version: <b class="fp">${coaFingerprint(await s.get())}</b>`));
    assert.match(html, /<td>1-22 IN<\/td>/);
    assert.match(html, /<div class="banner">UNCLASSIFIED<\/div>/);
  });

  it('saves one worksheet as HTML, blank, on A4 (remembered)', async () => {
    const s = await setup();
    choose(s.host.querySelector('[name="worksheet-kind"]'), 'units');
    choose(s.host.querySelector('[name="worksheet-fill"]'), 'blank');
    choose(s.host.querySelector('[name="worksheet-paper"]'), 'a4');
    button(s.host, 'Save (HTML)').click();
    await waitFor(() => s.saved.length === 1);
    assert.match(s.saved[0].name, /^blank-units-worksheet_\d{6}Z[A-Z]{3}\d{2}\.html$/);
    const html = await s.saved[0].blob.text();
    assert.match(html, /size: A4 landscape/);
    assert.ok(!html.includes('1-22 IN'), 'blank');
    assert.equal(s.prefs.get('worksheetPaper'), 'a4');
    assert.match(s.host.querySelector('[role="status"]').textContent, /open it in a browser and print it/);
  });

  it('downloads the CSV templates to type the worksheets into', async () => {
    const s = await setup();
    button(s.host, 'CSV template').click();
    await waitFor(() => s.saved.length === 3);
    assert.deepEqual(s.saved.map((f) => f.name.replace(/_.*/, '')), ['coa-1-units-template', 'coa-1-lines-template', 'coa-1-changes-template']);
    const changes = await s.saved[2].blob.text();
    assert.match(changes, new RegExp(`# version: ${coaFingerprint(await s.get())}\\r\\nlabel,action,mgrs,newLabel,template,sidc`));
  });

  it('asks for a COA to pre-fill from', async () => {
    const s = await setup({ select: false });
    button(s.host, 'Print…').click();
    await waitFor(() => /Select a COA to pre-fill, or choose Blank/.test(s.host.textContent));
    assert.equal(s.printed.length, 0);
  });

  it('prints through a hidden frame holding the worksheet', async () => {
    const s = await setup({ realPrint: true });
    choose(s.host.querySelector('[name="worksheet-kind"]'), 'changes');
    const frames = [];
    const watch = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => { if (n.tagName === 'IFRAME') frames.push(n.srcdoc); })));
    watch.observe(document.body, { childList: true });
    cleanups.push(() => watch.disconnect());
    button(s.host, 'Print…').click(); // the print dialog is the browser's; headless, it returns at once
    await waitFor(() => frames.some((html) => html.includes('<h1>Change sheet</h1>')));
  });
});
