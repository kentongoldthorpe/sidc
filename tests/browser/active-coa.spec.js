// The active-COA store: one coa.get per change of the selected COA, shared by every view.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp } from './app-fixture.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createSelection } from '../../src/adapters/ui/selection.js';

const INF = '10031000001211000000';
let store;
afterEach(() => { store?.destroy(); store = null; });

async function setup() {
  const fixture = createTestApp();
  const a = (await fixture.client.send('coa.create', { name: 'A' })).value;
  const b = (await fixture.client.send('coa.create', { name: 'B' })).value;
  const asks = [];
  const client = { ...fixture.client, ask: (type, ...rest) => { asks.push(type); return fixture.client.ask(type, ...rest); } };
  const selection = createSelection(a.id);
  store = createActiveCoa({ client, selection });
  const seen = [];
  store.subscribe((coa, info) => seen.push({ name: coa?.name ?? null, ...info }));
  await store.ready;
  return { ...fixture, a, b, selection, asks, seen, gets: () => asks.filter((t) => t === 'coa.get').length };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('active COA store', () => {
  it('loads the selected COA once, however many views listen', async () => {
    const s = await setup();
    store.subscribe(() => {}); store.subscribe(() => {});
    assert.equal(store.get().name, 'A');
    assert.equal(s.gets(), 1);
  });

  it('reloads once for a burst of changes to the active COA (units, lines, the COA itself)', async () => {
    const s = await setup();
    const before = s.gets();
    await s.other.send('symbol.add', { coaId: s.a.id, sidc: INF, position: { lat: 1, lng: 1 } });
    await s.other.send('graphic.add', { coaId: s.a.id, kind: 'route', points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] });
    await s.other.send('coa.update', { coaId: s.a.id, name: 'A2' });
    await waitFor(() => store.get().name === 'A2');
    await settle();
    assert.equal(s.gets() - before, 1, 'one reload for the burst');
    assert.equal(store.get().symbols.length, 1);
    assert.equal(store.get().graphics.length, 1);
    assert.equal(s.seen.at(-1).switched, false);
  });

  it('ignores changes to other COAs', async () => {
    const s = await setup();
    const before = s.gets();
    await s.other.send('symbol.add', { coaId: s.b.id, sidc: INF, position: { lat: 1, lng: 1 } });
    await settle();
    assert.equal(s.gets(), before);
  });

  it('follows the selection: switched is true, and null when nothing is selected', async () => {
    const s = await setup();
    s.selection.set(s.b.id);
    await waitFor(() => store.get()?.name === 'B');
    assert.equal(s.seen.at(-1).switched, true);
    s.selection.set(null);
    await waitFor(() => store.get() === null);
    assert.deepEqual(s.seen.at(-1), { name: null, switched: true, error: null });
  });

  it('becomes null when the active COA is deleted', async () => {
    const s = await setup();
    await s.other.send('coa.delete', { coaId: s.a.id });
    await waitFor(() => store.get() === null);
    assert.equal(s.seen.at(-1).error, null, 'a deleted COA is not an error');
  });

  it('keeps only the latest selection when selections change quickly', async () => {
    const s = await setup();
    s.selection.set(s.b.id); s.selection.set(s.a.id); s.selection.set(s.b.id);
    await waitFor(() => store.get()?.name === 'B');
    await settle();
    assert.equal(store.get().name, 'B');
    assert.equal(s.seen.at(-1).name, 'B', 'a slower, older load never overwrites the latest');
  });

  it('stops listening when destroyed', async () => {
    const s = await setup();
    store.destroy();
    const before = s.gets();
    await s.other.send('symbol.add', { coaId: s.a.id, sidc: INF, position: { lat: 1, lng: 1 } });
    s.selection.set(s.b.id);
    await settle();
    assert.equal(s.gets(), before);
    store = null;
  });
});
