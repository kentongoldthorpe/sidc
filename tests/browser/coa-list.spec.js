// COA-1.20: the COA list view, driven through the DOM against a real application.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, press, texts } from './app-fixture.js';
import { mountCoaListView } from '../../src/adapters/ui/views/coa-list-view.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { InMemoryDocumentRepository } from '../../src/adapters/persistence/in-memory-document-repository.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';

const INFANTRY = '10031000001211000000';
let host; let view;
afterEach(() => { view?.destroy(); host?.remove(); view = null; host = null; });

async function mountList(options) {
  const fixture = createTestApp(options);
  const selection = createSelection();
  const calls = { ask: 0 };
  const client = { ...fixture.client, ask: (...args) => { calls.ask += 1; return fixture.client.ask(...args); } };
  host = sandbox();
  view = mountCoaListView({ client, root: host, selection });
  await view.ready;
  return { ...fixture, selection, calls, root: host };
}

const names = (root) => texts(root, '[data-coa-name]');
const itemNamed = (root, name) => [...root.querySelectorAll('[data-coa-id]')].find((li) => li.querySelector('[data-coa-name]').textContent === name);
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label')?.startsWith(label));

async function createViaForm(root, name) {
  type(root.querySelector('[data-new-coa] input'), name);
  root.querySelector('[data-new-coa]').requestSubmit();
}

describe('COA list', () => {
  it('shows an empty state when there are no COAs', async () => {
    const { root } = await mountList();
    assert.match(root.textContent, /No COAs yet/);
  });

  it('creates a COA from the form, lists it, selects it and clears the input', async () => {
    const { root, selection } = await mountList();
    await createViaForm(root, '  Envelopment  ');
    await waitFor(() => names(root).includes('Envelopment'));
    const item = itemNamed(root, 'Envelopment');
    assert.equal(item.querySelector('[aria-current="true"]') !== null, true, 'new COA is selected');
    assert.equal(selection.get(), item.dataset.coaId);
    assert.equal(root.querySelector('[data-new-coa] input').value, '');
    assert.match(item.textContent, /0 units/);
  });

  it('shows why a name is rejected, next to the input, and creates nothing', async () => {
    const { root, client } = await mountList();
    await createViaForm(root, '   ');
    const input = root.querySelector('[data-new-coa] input');
    await waitFor(() => input.getAttribute('aria-invalid') === 'true');
    assert.match(root.querySelector('[data-new-coa] [data-error]').textContent, /blank/i);
    assert.deepEqual((await client.ask('coa.list')).value, []);
    await createViaForm(root, 'Valid');
    await waitFor(() => input.getAttribute('aria-invalid') !== 'true');
    assert.equal(root.querySelector('[data-new-coa] [data-error]').textContent, '');
  });

  it('lists the most recently changed COA first and keeps unit counts current', async () => {
    const { root, client } = await mountList();
    const a = (await client.send('coa.create', { name: 'Alpha' })).value;
    await client.send('coa.create', { name: 'Bravo' });
    await waitFor(() => names(root).length === 2);
    await client.send('symbol.add', { coaId: a.id, sidc: INFANTRY, position: { lat: 0, lng: 0 } });
    await waitFor(() => names(root)[0] === 'Alpha' && /1 unit\b/.test(itemNamed(root, 'Alpha').textContent));
    assert.deepEqual(names(root), ['Alpha', 'Bravo']);
  });

  it('selects the most recently changed COA on start-up when nothing is selected', async () => {
    const fixture = createTestApp();
    await fixture.client.send('coa.create', { name: 'Older' });
    const newer = (await fixture.client.send('coa.create', { name: 'Newer' })).value;
    const selection = createSelection();
    host = sandbox();
    view = mountCoaListView({ client: fixture.client, root: host, selection });
    await view.ready;
    assert.equal(selection.get(), newer.id);
  });

  it('clears the selection when the selected COA is deleted elsewhere', async () => {
    const { root, client, other, selection } = await mountList();
    const coa = (await client.send('coa.create', { name: 'Alpha' })).value;
    await waitFor(() => names(root).includes('Alpha'));
    selection.set(coa.id);
    await other.send('coa.delete', { coaId: coa.id });
    await waitFor(() => selection.get() === null);
  });

  it('selects a COA when it is clicked', async () => {
    const { root, client, selection } = await mountList();
    const a = (await client.send('coa.create', { name: 'Alpha' })).value;
    await client.send('coa.create', { name: 'Bravo' });
    await waitFor(() => names(root).length === 2);
    itemNamed(root, 'Alpha').querySelector('[data-select]').click();
    assert.equal(selection.get(), a.id);
    assert.ok(itemNamed(root, 'Alpha').querySelector('[aria-current="true"]'));
    assert.ok(!itemNamed(root, 'Bravo').querySelector('[aria-current="true"]'));
  });

  it('renames a COA in place (Enter saves)', async () => {
    const { root, client } = await mountList();
    await client.send('coa.create', { name: 'Alpha' });
    await waitFor(() => names(root).includes('Alpha'));
    button(itemNamed(root, 'Alpha'), 'Rename').click();
    const input = root.querySelector('[data-rename] input');
    assert.equal(input.value, 'Alpha');
    assert.equal(document.activeElement, input, 'the rename box gets focus');
    type(input, 'Alpha Prime');
    press(input, 'Enter');
    await waitFor(() => names(root).includes('Alpha Prime'));
    assert.equal(root.querySelector('[data-rename]'), null);
  });

  it('cancels a rename with Escape', async () => {
    const { root, client } = await mountList();
    await client.send('coa.create', { name: 'Alpha' });
    await waitFor(() => names(root).includes('Alpha'));
    button(itemNamed(root, 'Alpha'), 'Rename').click();
    const input = root.querySelector('[data-rename] input');
    type(input, 'Nope');
    press(input, 'Escape');
    await waitFor(() => root.querySelector('[data-rename]') === null);
    assert.deepEqual(names(root), ['Alpha']);
  });

  it('renames and cancels with buttons too (touch screens have no Enter or Escape)', async () => {
    const { root, client } = await mountList();
    await client.send('coa.create', { name: 'Alpha' });
    await waitFor(() => names(root).includes('Alpha'));
    button(itemNamed(root, 'Alpha'), 'Rename').click();
    type(root.querySelector('[data-rename] input'), 'Discarded');
    button(root.querySelector('[data-rename]'), 'Cancel').click();
    await waitFor(() => root.querySelector('[data-rename]') === null);
    assert.deepEqual(names(root), ['Alpha']);
    button(itemNamed(root, 'Alpha'), 'Rename').click();
    type(root.querySelector('[data-rename] input'), 'Saved');
    button(root.querySelector('[data-rename]'), 'Save').click();
    await waitFor(() => names(root).includes('Saved'));
  });

  it('keeps the rename box open with the reason when the new name is rejected', async () => {
    const { root, client } = await mountList();
    await client.send('coa.create', { name: 'Alpha' });
    await waitFor(() => names(root).includes('Alpha'));
    button(itemNamed(root, 'Alpha'), 'Rename').click();
    const input = root.querySelector('[data-rename] input');
    type(input, 'x'.repeat(121));
    press(input, 'Enter');
    await waitFor(() => root.querySelector('[data-rename] [data-error]')?.textContent.includes('120'));
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal((await client.ask('coa.list')).value[0].name, 'Alpha');
  });

  it('duplicates a COA and selects the copy', async () => {
    const { root, client, selection } = await mountList();
    await client.send('coa.create', { name: 'Alpha' });
    await waitFor(() => names(root).includes('Alpha'));
    button(itemNamed(root, 'Alpha'), 'Duplicate').click();
    await waitFor(() => names(root).includes('Alpha (copy)'));
    assert.equal(selection.get(), itemNamed(root, 'Alpha (copy)').dataset.coaId);
  });

  it('asks before deleting, naming the COA; Cancel keeps it', async () => {
    const { root, client } = await mountList();
    await client.send('coa.create', { name: 'Alpha' });
    await waitFor(() => names(root).includes('Alpha'));
    button(itemNamed(root, 'Alpha'), 'Delete').click();
    const dialog = root.querySelector('dialog');
    assert.ok(dialog.open, 'confirmation is shown');
    assert.match(dialog.textContent, /Delete “Alpha”\?/);
    button(dialog, 'Cancel').click();
    assert.ok(!dialog.open);
    assert.deepEqual(names(root), ['Alpha']);
  });

  it('deletes after confirmation and clears the selection if it was selected', async () => {
    const { root, client, selection } = await mountList();
    await client.send('coa.create', { name: 'Alpha' });
    await waitFor(() => names(root).includes('Alpha'));
    itemNamed(root, 'Alpha').querySelector('[data-select]').click();
    button(itemNamed(root, 'Alpha'), 'Delete').click();
    button(root.querySelector('dialog'), 'Delete').click();
    await waitFor(() => names(root).length === 0);
    assert.equal(selection.get(), null);
    assert.deepEqual((await client.ask('coa.list')).value, []);
  });

  it('shows changes made elsewhere (another tab or view) without a reload', async () => {
    const { root, other } = await mountList();
    const coa = (await other.send('coa.create', { name: 'From elsewhere' })).value;
    await waitFor(() => names(root).includes('From elsewhere'));
    await other.send('coa.update', { coaId: coa.id, name: 'Renamed elsewhere' });
    await waitFor(() => names(root).includes('Renamed elsewhere'));
    await other.send('coa.delete', { coaId: coa.id });
    await waitFor(() => names(root).length === 0);
  });

  it('shows names as plain text, never as markup', async () => {
    const { root, client } = await mountList();
    await client.send('coa.create', { name: '<img src=x onerror="window.__pwned=1">' });
    await waitFor(() => names(root).length === 1);
    assert.equal(root.querySelector('img'), null);
    assert.equal(window.__pwned, undefined);
  });

  it('reports a storage failure in an alert', async () => {
    const failing = Object.assign(new InMemoryDocumentRepository(), {
      save: async () => ({ ok: false, error: { code: 'STORAGE_QUOTA_EXCEEDED', message: 'Browser storage is full', details: {} } }),
    });
    const { root } = await mountList({ documentRepository: failing });
    await createViaForm(root, 'Alpha');
    await waitFor(() => /Browser storage is full/.test(root.querySelector('[role="alert"]').textContent));
    assert.equal(names(root).length, 0);
  });

  it('stops listening after destroy', async () => {
    const { other, calls } = await mountList();
    view.destroy(); view = null;
    const before = calls.ask;
    await other.send('coa.create', { name: 'Late' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.ask, before, 'the destroyed view still queried the app');
  });
});

describe('COA list levels (layout v2)', () => {
  /** Mount with levels on, after creating COAs named `names` (oldest first). */
  async function mountWithLevels(names, { prefs = createMemoryPrefs(), select = [] } = {}) {
    const fixture = createTestApp();
    const created = {};
    for (const name of names) {
      created[name] = (await fixture.client.send('coa.create', { name })).value;
      await new Promise((r) => setTimeout(r, 3)); // distinct updatedAt, so "newest" is well defined
    }
    const selection = createSelection();
    const summary = document.createElement('span');
    host = sandbox();
    view = mountCoaListView({ client: fixture.client, root: host, selection, levels: true, prefs, summary });
    await view.ready;
    for (const name of select) selection.set(created[name].id);
    return { ...fixture, root: host, selection, created, summary, prefs };
  }
  const more = (root) => button(root, 'Show more');
  const less = (root) => button(root, 'Show less');

  it('starts at "recent": the active COA plus the 3 most recently used', async () => {
    const { root } = await mountWithLevels(['A', 'B', 'C', 'D', 'E', 'F'], { select: ['B', 'D', 'A', 'F', 'C'] });
    await waitFor(() => names(root)[0] === 'C');
    assert.deepEqual(names(root), ['C', 'F', 'A', 'D']);
  });

  it('fills "recent" with the most recently changed COAs when there is little history', async () => {
    const { root } = await mountWithLevels(['A', 'B', 'C', 'D', 'E']);
    await waitFor(() => names(root).length === 4);
    assert.deepEqual(names(root), ['E', 'D', 'C', 'B'], 'E is auto-selected as the newest, then the next newest');
  });

  it('steps through the levels with Show more / Show less', async () => {
    const { root } = await mountWithLevels(['A', 'B', 'C', 'D', 'E', 'F'], { select: ['A'] });
    await waitFor(() => names(root).length === 4);
    more(root).click();
    await waitFor(() => names(root).length === 6);
    assert.ok(root.querySelector('.coa-items.is-all'), 'the full list scrolls');
    assert.equal(more(root), undefined, 'nothing more to show');
    less(root).click();
    await waitFor(() => names(root).length === 4);
    less(root).click();
    await waitFor(() => names(root).length === 1);
    assert.deepEqual(names(root), ['A']);
    assert.equal(less(root), undefined, 'the active COA is the least to show');
    assert.equal(root.querySelector('.list-levels').textContent.trim(), 'Show more', 'only the buttons, no stray text');
  });

  it('remembers the level and the recently used COAs (in this browser)', async () => {
    const prefs = createMemoryPrefs();
    const first = await mountWithLevels(['A', 'B', 'C', 'D', 'E'], { prefs, select: ['A', 'B'] });
    await waitFor(() => names(first.root)[0] === 'B');
    less(first.root).click();
    view.destroy(); host.remove();
    const selection = createSelection();
    host = sandbox();
    view = mountCoaListView({ client: first.client, root: host, selection, levels: true, prefs });
    await view.ready;
    await waitFor(() => names(host).length === 1);
    assert.deepEqual(names(host), ['B'], 'the last active COA is selected again, at the "active" level');
  });

  it('puts the active COA\'s name in the section summary', async () => {
    const { root, summary, selection, created } = await mountWithLevels(['Alpha', 'Bravo']);
    await waitFor(() => summary.textContent === 'Bravo');
    selection.set(created.Alpha.id);
    await waitFor(() => summary.textContent === 'Alpha');
    void root;
  });

  it('still creates, renames and deletes at the "active" level', async () => {
    const { root } = await mountWithLevels(['A', 'B'], { select: ['A'] });
    await waitFor(() => names(root).length === 2);
    less(root).click();
    await waitFor(() => names(root).length === 1);
    await createViaForm(root, 'New');
    await waitFor(() => names(root).join() === 'New', { message: `names: ${names(root)}` });
  });
});

describe('COA list: Import COAs…', () => {
  const choose = async (root, name, text) => {
    const input = root.querySelector('[data-import] input[type=file]');
    const files = new DataTransfer();
    files.items.add(new File([text], name, { type: 'application/json' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const doc = (coas) => JSON.stringify({ format: 'coa-builder/import', version: 1, coas });

  it('imports every COA in a coa-builder/import file, selects the first and says how many', async () => {
    const { root, selection } = await mountList();
    await choose(root, 'plan.json', doc([
      { name: 'Imported one', units: [{ sidc: INFANTRY, lat: 1, lng: 2, label: 'A' }] },
      { name: 'Imported two' },
    ]));
    await waitFor(() => names(root).length === 2);
    assert.deepEqual(names(root).sort(), ['Imported one', 'Imported two']);
    await waitFor(() => selection.get() === itemNamed(root, 'Imported one').dataset.coaId);
    assert.match(root.querySelector('[data-import-status]').textContent, /Imported 2 COAs from plan\.json/);
  });

  it('lists the problems by field and imports nothing when the file is invalid', async () => {
    const { root } = await mountList();
    await choose(root, 'bad.json', doc([{ name: 'X', units: [{ sidc: 'nope', lat: 100, lon: 2 }] }]));
    await waitFor(() => root.querySelectorAll('[data-import-problems] li').length > 0);
    const problems = texts(root, '[data-import-problems] li').join('\n');
    assert.match(problems, /coas\[0\]\.units\[0\]\.sidc/);
    assert.match(problems, /coas\[0\]\.units\[0\]\.lat/);
    assert.match(problems, /coas\[0\]\.units\[0\]\.lon: unknown field/);
    assert.match(root.querySelector('[data-import-status]').textContent, /Nothing was imported/);
    assert.equal(names(root).length, 0);
  });

  it('explains a file that is not JSON', async () => {
    const { root } = await mountList();
    await choose(root, 'notes.txt', 'just some text');
    await waitFor(() => /not JSON/.test(root.querySelector('[data-import-status]').textContent + texts(root, '[data-import-problems] li').join()));
    assert.equal(names(root).length, 0);
  });

  it('imports a CSV file, and reports its problems by row and column', async () => {
    const { root } = await mountList();
    await choose(root, 'units.csv', `coa,sidc,lat,lng,label\r\nPlan A,${INFANTRY},34,-118,A1\r\nPlan A,bad,34,-118,A2\r\n`);
    await waitFor(() => root.querySelectorAll('[data-import-problems] li').length > 0);
    assert.match(texts(root, '[data-import-problems] li').join('\n'), /^row 3, column sidc: /m);
    await choose(root, 'units.csv', `coa,sidc,lat,lng,label\r\nPlan A,${INFANTRY},34,-118,A1\r\n`);
    await waitFor(() => names(root).includes('Plan A'));
  });

  it('clears the old problems after a later import works', async () => {
    const { root } = await mountList();
    await choose(root, 'bad.json', doc([{ name: '' }]));
    await waitFor(() => root.querySelectorAll('[data-import-problems] li').length > 0);
    await choose(root, 'good.json', doc([{ name: 'Fine' }]));
    await waitFor(() => names(root).includes('Fine'));
    assert.equal(root.querySelectorAll('[data-import-problems] li').length, 0);
    assert.match(root.querySelector('[data-import-status]').textContent, /Imported 1 COA from good\.json/);
  });
});
