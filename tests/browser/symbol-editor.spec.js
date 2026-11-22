// COA-1.21: the symbol (unit) editor, driven through the DOM against a real application.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { mountSymbolEditorView } from '../../src/adapters/ui/views/symbol-editor-view.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createPicker } from '../../src/adapters/ui/map-picker.js';

const INFANTRY = '10031000001211000000';
const UNKNOWN = '10031000009999990000';
let host; let view;
afterEach(() => { view?.destroy(); host?.remove(); view = null; host = null; });

async function mountEditor({ units = [], select = true } = {}) {
  const fixture = createTestApp();
  const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
  const symbols = [];
  for (const u of units) symbols.push((await fixture.client.send('symbol.add', { coaId: coa.id, position: { lat: 1, lng: 2 }, ...u })).value.symbol);
  const selection = createSelection(select ? coa.id : null);
  const symbolSelection = createSelection();
  const picker = createPicker();
  host = sandbox();
  view = mountSymbolEditorView({ client: fixture.client, root: host, selection, symbolSelection, picker });
  await view.ready;
  const get = async () => (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
  return { ...fixture, coa, symbols, selection, symbolSelection, picker, root: host, get };
}

const field = (root, name) => root.querySelector(`[data-unit-form] [name="${name}"]`);
const errorFor = (root, name) => root.querySelector(`[data-error-for="${name}"]`).textContent;
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const unitLabels = (root) => texts(root, '[data-unit-label]');
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
const check = (box, on) => { box.checked = on; box.dispatchEvent(new Event('change', { bubbles: true })); };
const save = (root) => button(root.querySelector('[data-unit-form]'), 'Save').click();

describe('symbol editor', () => {
  it('asks for a COA when none is selected', async () => {
    const { root } = await mountEditor({ select: false });
    assert.match(root.textContent, /Select a COA/);
    assert.equal(root.querySelector('[data-unit-form]'), null);
  });

  it('lists the selected COA\'s units with a symbol thumbnail, label or SIDC', async () => {
    const { root } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5' }, { sidc: '10061000001205000000' }] });
    await waitFor(() => root.querySelectorAll('[data-units] [data-thumb] svg').length === 2);
    assert.deepEqual(unitLabels(root), ['A/1-5', '10061000001205000000']);
  });

  it('builds a SIDC from affiliation, unit type, echelon and HQ, with a live preview', async () => {
    const { root } = await mountEditor();
    button(root, 'Add unit').click();
    choose(field(root, 'affiliation'), '6');
    choose(field(root, 'unitType'), '120500');
    choose(field(root, 'echelon'), '15');
    check(field(root, 'hq'), true);
    assert.equal(field(root, 'sidc').value, '10061002151205000000');
    await waitFor(() => root.querySelector('[data-preview] svg') && /valid/i.test(root.querySelector('[data-preview-status]').textContent));
  });

  it('reflects a typed SIDC in the builder, and shows a typed custom SIDC as custom', async () => {
    const { root } = await mountEditor();
    button(root, 'Add unit').click();
    type(field(root, 'sidc'), '10031000161211000000');
    assert.deepEqual([field(root, 'affiliation').value, field(root, 'unitType').value, field(root, 'echelon').value, field(root, 'hq').checked], ['3', '121100', '16', false]);
    type(field(root, 'sidc'), 'SFGPUCI----D---');
    assert.equal(field(root, 'unitType').value, '');
    choose(field(root, 'affiliation'), '6');
    assert.equal(field(root, 'sidc').value, 'SFGPUCI----D---', 'the builder must not overwrite a SIDC it cannot express');
    await waitFor(() => root.querySelector('[data-preview] svg'));
  });

  it('previews an unrecognised SIDC as not valid, with the reason', async () => {
    const { root } = await mountEditor();
    button(root, 'Add unit').click();
    type(field(root, 'sidc'), UNKNOWN);
    await waitFor(() => /not a recognised/i.test(root.querySelector('[data-preview-status]').textContent));
    assert.match(root.querySelector('[data-preview-status]').textContent, /icon/i);
  });

  it('adds a unit with label, position and modifiers, then selects it', async () => {
    const { root, get, symbolSelection } = await mountEditor();
    button(root, 'Add unit').click();
    type(field(root, 'sidc'), INFANTRY);
    type(field(root, 'label'), 'A/1-5');
    type(field(root, 'lat'), '34.05');
    type(field(root, 'lng'), '-117.6');
    type(field(root, 'higherFormation'), '1-5 INF');
    type(field(root, 'direction'), '45');
    save(root);
    await waitFor(() => unitLabels(root).includes('A/1-5'));
    const [symbol] = (await get()).symbols;
    assert.deepEqual({ ...symbol, id: undefined }, {
      id: undefined, sidc: INFANTRY, label: 'A/1-5', position: { lat: 34.05, lng: -117.6 }, modifiers: { higherFormation: '1-5 INF', direction: 45 },
    });
    assert.equal(symbolSelection.get(), symbol.id);
  });

  for (const [what, setup, fieldName, pattern] of [
    ['a malformed SIDC', (root) => type(field(root, 'sidc'), 'abc'), 'sidc', /20 or 30 digits/],
    ['an unrecognised SIDC', (root) => type(field(root, 'sidc'), UNKNOWN), 'sidc', /not a recognised symbol/i],
    ['a latitude out of range', (root) => { type(field(root, 'sidc'), INFANTRY); type(field(root, 'lat'), '95'); }, 'lat', /-90 to 90/],
    ['a missing longitude', (root) => { type(field(root, 'sidc'), INFANTRY); type(field(root, 'lng'), ''); }, 'lng', /number/],
    ['a label over 30 characters', (root) => { type(field(root, 'sidc'), INFANTRY); type(field(root, 'label'), 'x'.repeat(31)); }, 'label', /30/],
    ['a direction of 360', (root) => { type(field(root, 'sidc'), INFANTRY); type(field(root, 'direction'), '360'); }, 'direction', /360/],
  ]) {
    it(`shows the reason next to the field for ${what}, and adds nothing`, async () => {
      const { root, get } = await mountEditor();
      button(root, 'Add unit').click();
      type(field(root, 'lat'), '1'); type(field(root, 'lng'), '2');
      setup(root);
      save(root);
      await waitFor(() => pattern.test(errorFor(root, fieldName)), { message: `${fieldName} error: "${errorFor(root, fieldName)}"` });
      assert.equal(field(root, fieldName).getAttribute('aria-invalid'), 'true');
      assert.deepEqual((await get()).symbols, []);
    });
  }

  it('opens a unit for editing when it is chosen in the list', async () => {
    const { root, symbols, symbolSelection } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5', modifiers: { staffComments: 'Hold' } }] });
    await waitFor(() => unitLabels(root).length === 1);
    root.querySelector('[data-select-unit]').click();
    assert.equal(symbolSelection.get(), symbols[0].id);
    assert.deepEqual([field(root, 'sidc').value, field(root, 'label').value, field(root, 'staffComments').value, field(root, 'lat').value, field(root, 'lng').value],
      [INFANTRY, 'A/1-5', 'Hold', '1', '2']);
    assert.ok(root.querySelector('[data-select-unit][aria-current="true"]'));
  });

  it('opens a unit chosen elsewhere (e.g. clicked on the map)', async () => {
    const { root, symbols, symbolSelection } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5' }] });
    symbolSelection.set(symbols[0].id);
    await waitFor(() => field(root, 'label')?.value === 'A/1-5');
  });

  it('saves an edit: new label, SIDC and position', async () => {
    const { root, symbols, symbolSelection, get } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5' }] });
    symbolSelection.set(symbols[0].id);
    await waitFor(() => field(root, 'label')?.value === 'A/1-5');
    type(field(root, 'label'), 'A/2-5');
    choose(field(root, 'unitType'), '120500');
    type(field(root, 'lat'), '10');
    save(root);
    await waitFor(() => unitLabels(root).includes('A/2-5'));
    const [symbol] = (await get()).symbols;
    assert.deepEqual([symbol.label, symbol.sidc, symbol.position], ['A/2-5', '10031000001205000000', { lat: 10, lng: 2 }]);
  });

  it('saving an unchanged unit changes nothing', async () => {
    const { root, symbols, symbolSelection, get } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5' }] });
    const before = (await get()).revision;
    symbolSelection.set(symbols[0].id);
    await waitFor(() => field(root, 'label')?.value === 'A/1-5');
    save(root);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await get()).revision, before);
  });

  it('cancels without saving', async () => {
    const { root, symbols, symbolSelection, get } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5' }] });
    symbolSelection.set(symbols[0].id);
    await waitFor(() => field(root, 'label')?.value === 'A/1-5');
    type(field(root, 'label'), 'Changed');
    button(root, 'Cancel').click();
    assert.equal(root.querySelector('[data-unit-form]'), null);
    assert.equal(symbolSelection.get(), null);
    assert.equal((await get()).symbols[0].label, 'A/1-5');
  });

  it('fills the position from the map with "Pick on map"', async () => {
    const { root, picker } = await mountEditor();
    button(root, 'Add unit').click();
    button(root, 'Pick on map').click();
    assert.ok(picker.isActive());
    picker.resolve({ lat: 34.1234567891, lng: -117.7654321 });
    assert.deepEqual([field(root, 'lat').value, field(root, 'lng').value], ['34.123457', '-117.765432']);
    assert.ok(!picker.isActive());
  });

  it('deletes a unit after confirmation', async () => {
    const { root, symbols, symbolSelection, get } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5' }, { sidc: INFANTRY, label: 'B/1-5' }] });
    symbolSelection.set(symbols[0].id);
    await waitFor(() => field(root, 'label')?.value === 'A/1-5');
    button(root, 'Delete unit').click();
    const dialog = root.querySelector('dialog');
    assert.ok(dialog.open);
    assert.match(dialog.textContent, /Delete “A\/1-5”\?/);
    button(dialog, 'Delete').click();
    await waitFor(() => unitLabels(root).join() === 'B/1-5');
    assert.equal(symbolSelection.get(), null);
    assert.deepEqual((await get()).symbols.map((s) => s.label), ['B/1-5']);
  });

  it('follows changes made elsewhere, and closes the form if its unit is removed', async () => {
    const { root, coa, other, symbols, symbolSelection } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5' }] });
    symbolSelection.set(symbols[0].id);
    await waitFor(() => field(root, 'label')?.value === 'A/1-5');
    await other.send('symbol.add', { coaId: coa.id, sidc: INFANTRY, position: { lat: 0, lng: 0 }, label: 'New' });
    await waitFor(() => unitLabels(root).includes('New'));
    await other.send('symbol.remove', { coaId: coa.id, symbolId: symbols[0].id });
    await waitFor(() => root.querySelector('[data-unit-form]') === null);
    assert.equal(symbolSelection.get(), null);
  });

  it('closes the form and clears the unit when another COA is selected', async () => {
    const { root, client, symbols, selection, symbolSelection } = await mountEditor({ units: [{ sidc: INFANTRY, label: 'A/1-5' }] });
    symbolSelection.set(symbols[0].id);
    await waitFor(() => field(root, 'label')?.value === 'A/1-5');
    const other = (await client.send('coa.create', { name: 'COA 2' })).value;
    selection.set(other.id);
    assert.equal(root.querySelector('[data-unit-form]'), null, 'closed at once: no moment where the old COA\'s unit can still be edited');
    await waitFor(() => unitLabels(root).length === 0);
    assert.equal(symbolSelection.get(), null);
  });

  it('shows labels as plain text', async () => {
    const { root } = await mountEditor({ units: [{ sidc: INFANTRY, label: '<b>bold</b>' }] });
    await waitFor(() => unitLabels(root).length === 1);
    assert.equal(unitLabels(root)[0], '<b>bold</b>');
    assert.equal(root.querySelector('[data-unit-label] b'), null);
  });
});
