// T-1: the Systems panel (decision D22): add, edit and delete weapon and sensor systems.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { mountSystemsView } from '../../src/adapters/ui/views/systems-view.js';

let view; let host;
afterEach(() => { view?.destroy(); host?.remove(); view = null; host = null; });

async function mount() {
  const fixture = createTestApp();
  host = sandbox();
  view = mountSystemsView({ client: fixture.client, root: host });
  await view.ready;
  const list = async () => (await fixture.client.ask('system.list')).value;
  return { ...fixture, root: host, list };
}
const field = (root, name) => root.querySelector(`[name="${name}"]`);
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
const rows = (root) => texts(root, '[data-system-id] .system-name');

async function addSystem(root, { name, role, max, min = '', arc = '' }) {
  button(root, 'Add system').click();
  await waitFor(() => field(root, 'system-name'));
  type(field(root, 'system-name'), name);
  choose(field(root, 'system-role'), role);
  type(field(root, 'system-max'), max);
  if (min) type(field(root, 'system-min'), min);
  if (arc) type(field(root, 'system-arc'), arc);
  button(root, 'Save').click();
}

describe('Systems panel', () => {
  it('says how to start when there are no systems', async () => {
    const { root } = await mount();
    assert.match(root.textContent, /No systems yet/);
  });

  it('adds a system: ranges typed in km are stored in metres, the arc defaults to all round', async () => {
    const { root, list } = await mount();
    await addSystem(root, { name: 'SA-15', role: 'airDefence', max: '12' });
    await waitFor(() => rows(root).join() === 'SA-15');
    assert.deepEqual((await list()).map(({ name, role, maxRange, arc }) => ({ name, role, maxRange, arc })), [{ name: 'SA-15', role: 'airDefence', maxRange: 12000, arc: 360 }]);
    assert.match(root.querySelector('[data-system-id]').textContent, /Air defence.*12 km.*all round/);
  });

  it('keeps a minimum range and an arc, accepting a decimal comma', async () => {
    const { root, list } = await mount();
    await addSystem(root, { name: 'T-72 gun', role: 'direct', max: '2,5', min: '0.1', arc: '60' });
    await waitFor(async () => (await list()).length === 1);
    const [s] = await list();
    assert.deepEqual([s.maxRange, s.minRange, s.arc], [2500, 100, 60]);
    await waitFor(() => /0\.1–2\.5 km.*60°/.test(root.querySelector('[data-system-id]').textContent));
  });

  it('shows problems next to the fields and saves nothing', async () => {
    const { root, list } = await mount();
    await addSystem(root, { name: '', role: 'sensor', max: 'far', min: '3', arc: '400' });
    await waitFor(() => root.querySelectorAll('.field-error:not(:empty)').length >= 2);
    assert.match(root.textContent, /Name must not be blank/i);
    assert.match(root.textContent, /maximum range/i);
    assert.equal(field(root, 'system-name').getAttribute('aria-invalid'), 'true');
    assert.deepEqual(await list(), []);
  });

  it('edits a system from its row (only changed fields), and lists by name', async () => {
    const { root, list, client } = await mount();
    await client.send('system.create', { name: 'SA-8', role: 'airDefence', maxRange: 10000 });
    await client.send('system.create', { name: '2S19', role: 'indirect', maxRange: 24700 });
    await waitFor(() => rows(root).join() === '2S19,SA-8');
    [...root.querySelectorAll('[data-system-id] button')].find((b) => b.textContent.includes('SA-8')).click();
    await waitFor(() => field(root, 'system-name')?.value === 'SA-8');
    assert.equal(field(root, 'system-max').value, '10');
    type(field(root, 'system-max'), '15');
    button(root, 'Save').click();
    await waitFor(async () => (await list()).find((s) => s.name === 'SA-8').maxRange === 15000);
    assert.equal((await list()).find((s) => s.name === 'SA-8').revision, 2);
  });

  it('deletes a system', async () => {
    const { root, list, client } = await mount();
    await client.send('system.create', { name: 'Radar', role: 'sensor', maxRange: 40000 });
    await waitFor(() => rows(root).length === 1);
    root.querySelector('[data-system-id] button').click();
    await waitFor(() => button(root, 'Delete'));
    button(root, 'Delete').click();
    await waitFor(async () => (await list()).length === 0);
    await waitFor(() => rows(root).length === 0);
  });

  it('follows changes made elsewhere in the fields you have not touched, and saves only yours', async () => {
    const { root, client, other, list } = await mount();
    const s = (await client.send('system.create', { name: 'BMP-2 gun', role: 'direct', maxRange: 2000 })).value;
    await waitFor(() => rows(root).length === 1);
    root.querySelector('[data-system-id] button').click();
    await waitFor(() => field(root, 'system-name'));
    type(field(root, 'system-arc'), '90');
    await other.send('system.update', { systemId: s.id, expectedRevision: 1, name: 'BMP-2 30 mm' });
    await waitFor(() => rows(root).join() === 'BMP-2 30 mm');
    await waitFor(() => field(root, 'system-name').value === 'BMP-2 30 mm', { message: 'the untouched name follows' });
    assert.equal(field(root, 'system-arc').value, '90', 'what you typed stays');
    button(root, 'Save').click();
    await waitFor(async () => (await list())[0].arc === 90);
    assert.equal((await list())[0].name, 'BMP-2 30 mm');
  });
});
