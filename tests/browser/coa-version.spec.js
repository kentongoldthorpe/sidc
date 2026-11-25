// E6-3: the selected COA's version, and Update from file… with its preview.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { mountCoaVersionView } from '../../src/adapters/ui/views/coa-version-view.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { coaFingerprint } from '../../src/domain/coa-changes.js';
import { mgrsOf } from '../../src/domain/mgrs.js';

const INF = '10031000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label));

async function setup() {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  await fixture.client.send('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INF, position: { mgrs: '18S UJ 2348 0648' }, label: '1 MRC' });
  await fixture.client.send('symbol.add', { coaId: coa.id, expectedRevision: 2, sidc: INF, position: { mgrs: '18S UJ 2410 0702' }, label: '2 MRC' });
  const selection = createSelection(coa.id);
  const activeCoa = createActiveCoa({ client: fixture.client, selection });
  const host = sandbox();
  const view = mountCoaVersionView({ client: fixture.client, root: host, activeCoa });
  cleanups.push(() => { view.destroy(); activeCoa.destroy(); host.remove(); });
  await activeCoa.ready;
  const get = async () => (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
  const choose = (text, name = 'sheet.csv') => {
    const input = host.querySelector('input[type="file"]');
    const files = new DataTransfer();
    files.items.add(new File([text], name, { type: 'text/csv' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change'));
  };
  return { ...fixture, coaId: coa.id, host, activeCoa, get, choose };
}

describe('the COA version and Update from file…', () => {
  it('shows the selected COA\'s version fingerprint, and the new one after a change', async () => {
    const s = await setup();
    const fp = coaFingerprint(await s.get());
    await waitFor(() => s.host.querySelector('[data-coa-version] .fingerprint')?.textContent === fp);
    await s.client.send('coa.update', { coaId: s.coaId, expectedRevision: 3, description: 'x' });
    await waitFor(() => s.host.querySelector('[data-coa-version] .fingerprint').textContent !== fp);
  });

  it('previews a change sheet made from this version, and applies it with who entered and checked it', async () => {
    const s = await setup();
    const fp = coaFingerprint(await s.get());
    s.choose(`# version: ${fp}\nlabel,action,mgrs\n2 MRC,change,18S UJ 2420 0710\n1 MRC,remove,\n`);
    const dialog = document.querySelector('dialog.update-dialog');
    await waitFor(() => dialog.open && dialog.querySelectorAll('[data-change]').length === 2);
    assert.match(dialog.querySelector('[data-version-note]').textContent, new RegExp(`Made from version ${fp}: the COA's version now`));
    assert.equal(dialog.querySelector('[name="based-on"]').value, fp);
    assert.deepEqual(texts(dialog, '[data-change] td:nth-child(2)'), ['Unit 2 MRC', 'Unit 1 MRC']);
    assert.match(dialog.querySelector('[data-change="change"]').textContent, /grid 18S UJ 2410 0702 → 18S UJ 2420 0710 \(128 m\)/);
    assert.equal(dialog.querySelector('.accept-mismatch').hidden, true);
    type(dialog.querySelector('[name="entered-by"]'), 'SGT A');
    type(dialog.querySelector('[name="checked-by"]'), 'CPL B');
    button(dialog, 'Apply 2 changes').click();
    await waitFor(async () => (await s.get()).symbols.length === 1);
    assert.equal(mgrsOf((await s.get()).symbols[0].position), '18S UJ 2420 0710');
    assert.equal(dialog.open, false);
    await waitFor(() => /Last updated from sheet\.csv at \d{6}Z: 0 added, 1 changed, 1 removed; entered by SGT A, read back by CPL B\./.test(s.host.querySelector('[data-last-transfer]').textContent));
    assert.match(s.host.textContent, /Updated COA 1 from sheet\.csv: 0 added, 1 changed, 1 removed\. Version [0-9A-Z]{4}-[0-9A-Z]{4}\. Undo puts it back\./);
  });

  it('warns when the sheet was made from another version, and applies only once that is ticked', async () => {
    const s = await setup();
    s.choose('# version: 0000-0000\nlabel,action,mgrs\n2 MRC,change,18S UJ 2420 0710\n');
    const dialog = document.querySelector('dialog.update-dialog');
    await waitFor(() => dialog.open && dialog.querySelector('[data-change]'));
    assert.match(dialog.querySelector('[data-version-note]').textContent, /^Made from version 0000-0000, but COA 1 is now at version/);
    const apply = button(dialog, 'Apply 1 change');
    assert.equal(apply.disabled, true);
    assert.equal(dialog.querySelector('.accept-mismatch').hidden, false);
    dialog.querySelector('[name="accept-mismatch"]').click();
    assert.equal(apply.disabled, false);
    apply.click();
    await waitFor(async () => mgrsOf((await s.get()).symbols[1].position) === '18S UJ 2420 0710');
  });

  it('lists the problems in a file by row and column, and applies nothing', async () => {
    const s = await setup();
    s.choose('label,action,mgrs\nGhost,change,18S UJ 2420 0710\n2 MRC,change,18S UJ 242 071 9\n');
    const dialog = document.querySelector('dialog.update-dialog');
    await waitFor(() => dialog.open && dialog.querySelectorAll('.import-problems li').length > 0);
    assert.deepEqual(texts(dialog, '.import-problems li').map((t) => t.replace(/:.*/, '')), ['row 3, column mgrs']);
    assert.equal(button(dialog, 'Apply').disabled, true);
    s.choose('label,action,mgrs\nGhost,change,18S UJ 2420 0710\n');
    await waitFor(() => /row 2, column label: "Ghost" is not in the COA/.test(dialog.querySelector('.import-problems').textContent));
  });

  it('asks for the version when the file does not say, and checks a typed one', async () => {
    const s = await setup();
    s.choose('label,action,mgrs\n2 MRC,change,18S UJ 2420 0710\n');
    const dialog = document.querySelector('dialog.update-dialog');
    await waitFor(() => dialog.open && dialog.querySelector('[data-change]'));
    assert.match(dialog.querySelector('[data-version-note]').textContent, /does not say which version/);
    const typed = dialog.querySelector('[name="based-on"]');
    typed.value = coaFingerprint(await s.get()).toLowerCase();
    typed.dispatchEvent(new Event('change'));
    await waitFor(() => /the COA's version now/.test(dialog.querySelector('[data-version-note]').textContent));
  });

  it('shows its dialog even when the COAs section is collapsed (the dialog belongs to the page)', async () => {
    const s = await setup();
    s.host.style.display = 'none';
    s.choose('label,action,mgrs\n2 MRC,change,18S UJ 2420 0710\n');
    const dialog = document.querySelector('dialog.update-dialog');
    await waitFor(() => dialog.open && dialog.querySelector('[data-change]'));
    assert.ok(dialog.getBoundingClientRect().width > 200, 'visible');
  });
});
