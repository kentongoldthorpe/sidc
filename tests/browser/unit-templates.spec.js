// M10-3b Unit templates (D29): the panel, starting a map unit from a template, and moving the old
// systems list over.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { mountUnitTemplatesView } from '../../src/adapters/ui/views/unit-templates-view.js';
import { mountSymbolEditorView } from '../../src/adapters/ui/views/symbol-editor-view.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createPicker } from '../../src/adapters/ui/map-picker.js';

let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const field = (root, name) => root.querySelector(`[name="${name}"]`);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };

async function panel() {
  const fixture = createTestApp();
  const host = sandbox();
  const saved = [];
  const view = mountUnitTemplatesView({ client: fixture.client, root: host, saveFile: async (blob, name) => saved.push({ blob, name }) });
  cleanups.push(() => { view.destroy(); host.remove(); });
  await view.ready;
  return { ...fixture, host, saved, list: async () => (await fixture.client.ask('unit-template.list')).value };
}

describe('Unit templates panel', () => {
  it('creates a template with a symbol from the builder, a typed weapon and details', async () => {
    const s = await panel();
    button(s.host, 'New template').click();
    type(field(s.host, 'template-name'), 'BMP-2 Coy');
    choose(field(s.host, 'template-unit-type'), '121100');
    type(field(s.host, 'template-label'), 'MRC');
    type(field(s.host, 'template-weapons-name'), '30 mm cannon');
    type(field(s.host, 'template-weapons-max'), '2');
    button(s.host, 'Add weapon').click();
    type(field(s.host, 'template-strength'), '10 BMP-2');
    button(s.host, 'Save').click();
    await waitFor(async () => (await s.list()).length === 1);
    const [t] = await s.list();
    assert.deepEqual([t.name, t.label, t.sidc.slice(3, 4), t.weapons, t.details], ['BMP-2 Coy', 'MRC', '6', [{ name: '30 mm cannon', role: 'direct', maxRange: 2000, arc: 360 }], { strength: '10 BMP-2' }]);
    await waitFor(() => texts(s.host, '[data-template-id] .system-name').join() === 'BMP-2 Coy');
  });

  it('edits and deletes a template', async () => {
    const s = await panel();
    await s.client.send('unit-template.create', { name: 'Old', sidc: '10061000001211000000' });
    await waitFor(() => s.host.querySelector('[data-template-id] button'));
    s.host.querySelector('[data-template-id] button').click();
    type(field(s.host, 'template-name'), 'New');
    field(s.host, 'template-hvt').click();
    button(s.host, 'Save').click();
    await waitFor(async () => (await s.list())[0]?.name === 'New');
    assert.equal((await s.list())[0].hvt, true);
    await waitFor(() => s.host.querySelector('[data-template-id] button'));
    s.host.querySelector('[data-template-id] button').click();
    button(s.host, 'Delete template').click();
    [...s.host.querySelectorAll('dialog button')].find((b) => b.textContent === 'Delete').click();
    await waitFor(async () => (await s.list()).length === 0);
  });

  it('offers to turn the old systems list into templates', async () => {
    const s = await panel();
    await s.client.send('system.create', { name: 'SA-15', role: 'airDefence', maxRange: 12000 });
    await waitFor(() => !s.host.querySelector('[data-from-systems]').hidden);
    assert.match(s.host.querySelector('[data-from-systems]').textContent, /1 system/);
    button(s.host, 'Make a template from it').click();
    await waitFor(async () => (await s.list()).length === 1);
    await waitFor(() => s.host.querySelector('[data-from-systems]').hidden);
  });

  it('exports the templates as a file and imports one', async () => {
    const s = await panel();
    await s.client.send('unit-template.create', { name: 'AD Bty', sidc: '10061000001301000000', weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 12000 }] });
    button(s.host, 'Export templates').click();
    await waitFor(() => s.saved.length === 1);
    const doc = JSON.parse(await s.saved[0].blob.text());
    assert.equal(doc.format, 'coa-builder/unit-templates');
    const files = new DataTransfer();
    files.items.add(new File([JSON.stringify(doc)], 'templates.json', { type: 'application/json' }));
    const input = s.host.querySelector('input[type="file"]');
    input.files = files.files;
    input.dispatchEvent(new Event('change'));
    await waitFor(async () => (await s.list()).length === 2);
  });
});

describe('a map unit started from a template', () => {
  it('copies the template into the new unit; changing the template later does not change the unit', async () => {
    const fixture = createTestApp();
    const t = (await fixture.client.send('unit-template.create', { name: 'AD Bty', sidc: '10061000001301000000', label: 'AD', hvt: true, weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 12000 }] })).value;
    const coa = (await fixture.client.send('coa.create', { name: 'SITTEMP' })).value;
    const host = sandbox();
    const view = mountSymbolEditorView({ client: fixture.client, root: host, selection: createSelection(coa.id), symbolSelection: createSelection(), picker: createPicker() });
    cleanups.push(() => { view.destroy(); host.remove(); });
    await view.ready;
    button(host, 'Add unit').click();
    await waitFor(() => field(host, 'unit-template'));
    choose(field(host, 'unit-template'), t.id);
    type(field(host, 'lat'), '34');
    type(field(host, 'lng'), '-118');
    button(host.querySelector('[data-unit-form]'), 'Save').click();
    const get = async () => (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
    await waitFor(async () => (await get()).symbols.length === 1);
    const [u] = (await get()).symbols;
    assert.deepEqual([u.sidc, u.label, u.hvt, u.weapons[0].name, u.position], ['10061000001301000000', 'AD', true, 'SA-15', { lat: 34, lng: -118 }]);
    await fixture.client.send('unit-template.update', { templateId: t.id, expectedRevision: 1, weapons: [] });
    assert.equal((await get()).symbols[0].weapons.length, 1, 'the unit keeps its copy');
  });
});
