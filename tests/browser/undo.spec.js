// H-1 Undo and redo: per COA (decision D19), through coa.restore; and undo of Delete COA.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, BreakableRepository } from './app-fixture.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createUndoHistory } from '../../src/adapters/ui/undo-history.js';
import { mountUndoControls } from '../../src/adapters/ui/views/undo-controls.js';
import { mountCoaListView } from '../../src/adapters/ui/views/coa-list-view.js';
import { createSelection } from '../../src/adapters/ui/selection.js';

const INF = '10031000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

async function setup() {
  const repo = new BreakableRepository();
  const fixture = createTestApp({ coaRepository: repo });
  const a = (await fixture.client.send('coa.create', { name: 'Alpha' })).value;
  const b = (await fixture.client.send('coa.create', { name: 'Bravo' })).value;
  const selection = createSelection(a.id);
  const activeCoa = createActiveCoa({ client: fixture.client, selection });
  const history = createUndoHistory({ client: fixture.client, activeCoa });
  await activeCoa.ready;
  const host = sandbox();
  const controls = mountUndoControls({ root: host, history });
  cleanups.push(() => { controls.destroy(); history.destroy(); activeCoa.destroy(); host.remove(); });
  const stored = async (id = a.id) => (await fixture.client.ask('coa.get', { coaId: id })).value;
  const settled = async (revision, id = a.id) => waitFor(() => activeCoa.get()?.id === id && activeCoa.get().revision === revision);
  return { ...fixture, repo, a, b, selection, activeCoa, history, host, stored, settled };
}
const button = (scope, label) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === label);
const key = (k, { shift = false, target = document.body } = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }));

describe('undo and redo', () => {
  it('starts with nothing to undo or redo', async () => {
    const { host } = await setup();
    assert.equal(button(host, 'Undo').disabled, true);
    assert.equal(button(host, 'Redo').disabled, true);
  });

  it('undoes and redoes the last change to the selected COA', async () => {
    const s = await setup();
    await s.client.send('symbol.add', { coaId: s.a.id, sidc: INF, position: { lat: 1, lng: 1 }, label: 'U1' });
    await s.settled(2);
    assert.equal(button(s.host, 'Undo').disabled, false);
    button(s.host, 'Undo').click();
    await waitFor(async () => (await s.stored()).symbols.length === 0);
    await waitFor(() => !button(s.host, 'Redo').disabled);
    assert.equal(button(s.host, 'Undo').disabled, true);
    button(s.host, 'Redo').click();
    await waitFor(async () => (await s.stored()).symbols.map((x) => x.label).join() === 'U1');
    await waitFor(() => button(s.host, 'Redo').disabled);
  });

  it('undoes several changes in order, and a new change clears redo', async () => {
    const s = await setup();
    await s.client.send('coa.update', { coaId: s.a.id, name: 'A1' }); await s.settled(2);
    await s.client.send('coa.update', { coaId: s.a.id, name: 'A2' }); await s.settled(3);
    await s.history.undo(); await waitFor(async () => (await s.stored()).name === 'A1');
    await s.history.undo(); await waitFor(async () => (await s.stored()).name === 'Alpha');
    await waitFor(() => s.history.state().canRedo);
    await s.client.send('coa.update', { coaId: s.a.id, name: 'New' });
    await waitFor(() => s.activeCoa.get().name === 'New');
    await waitFor(() => !s.history.state().canRedo, { message: 'redo is cleared by a new change' });
  });

  it('a group change (copy of several units) is one undo step', async () => {
    const s = await setup();
    const ids = [];
    for (const label of ['1', '2', '3']) ids.push((await s.client.send('symbol.add', { coaId: s.a.id, sidc: INF, position: { lat: 1, lng: 1 }, label })).value.symbol.id);
    await s.settled(4);
    await s.client.send('symbol.copy', { coaId: s.a.id, fromCoaId: s.a.id, symbolIds: ids, offset: { lat: 0.1, lng: 0 } });
    await waitFor(() => s.activeCoa.get().symbols.length === 6);
    await s.history.undo();
    await waitFor(async () => (await s.stored()).symbols.length === 3);
  });

  it('keeps a separate history per COA (D19)', async () => {
    const s = await setup();
    await s.client.send('coa.update', { coaId: s.a.id, name: 'A changed' }); await s.settled(2);
    s.selection.set(s.b.id); await s.settled(1, s.b.id);
    assert.equal(s.history.state().canUndo, false, 'Bravo has no history');
    await s.client.send('coa.update', { coaId: s.b.id, name: 'B changed' }); await s.settled(2, s.b.id);
    await s.history.undo(); await waitFor(async () => (await s.stored(s.b.id)).name === 'Bravo');
    s.selection.set(s.a.id); await s.settled(2);
    assert.equal(s.history.state().canUndo, true, 'Alpha kept its history');
    await s.history.undo(); await waitFor(async () => (await s.stored()).name === 'Alpha');
  });

  it('Ctrl+Z and Ctrl+Shift+Z work, but not while typing in a field (the field undoes its own text)', async () => {
    const s = await setup();
    await s.client.send('coa.update', { coaId: s.a.id, name: 'A1' }); await s.settled(2);
    const input = document.createElement('input'); s.host.append(input);
    key('z', { target: input });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await s.stored()).name, 'A1');
    key('z');
    await waitFor(async () => (await s.stored()).name === 'Alpha');
    await waitFor(() => s.history.state().canRedo);
    key('z', { shift: true });
    await waitFor(async () => (await s.stored()).name === 'A1');
  });

  it('never overwrites a change made elsewhere: it says so and keeps the history', async () => {
    const s = await setup();
    await s.client.send('coa.update', { coaId: s.a.id, name: 'A1' }); await s.settled(2);
    // Another window changes the stored COA without this one seeing it.
    const other = (await s.repo.get(s.a.id)).value;
    await s.repo.save({ ...other, name: 'Elsewhere', revision: 3 }, { expectedRevision: 2 });
    button(s.host, 'Undo').click();
    await waitFor(() => /changed in another window/i.test(s.host.textContent));
    assert.equal((await s.stored()).name, 'Elsewhere');
  });
});

describe('undo of Delete COA', () => {
  it('offers Undo after deleting a COA, which brings it back with the same id and content', async () => {
    const fixture = createTestApp();
    const coa = (await fixture.client.send('coa.create', { name: 'Doomed' })).value;
    await fixture.client.send('symbol.add', { coaId: coa.id, sidc: INF, position: { lat: 1, lng: 1 }, label: 'U' });
    const selection = createSelection(coa.id);
    const host = sandbox();
    const view = mountCoaListView({ client: fixture.client, root: host, selection });
    cleanups.push(() => { view.destroy(); host.remove(); });
    await view.ready;
    [...host.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Delete Doomed').click();
    [...host.querySelectorAll('dialog button')].find((x) => x.textContent === 'Delete').click();
    await waitFor(() => /Deleted “Doomed”/.test(host.textContent));
    button(host, 'Undo').click();
    await waitFor(() => [...host.querySelectorAll('[data-coa-name]')].some((x) => x.textContent === 'Doomed'));
    const back = (await fixture.client.ask('coa.get', { coaId: coa.id })).value;
    assert.deepEqual(back.symbols.map((x) => x.label), ['U']);
    assert.ok(!/Deleted “Doomed”/.test(host.textContent), 'the notice goes away');
  });
});
