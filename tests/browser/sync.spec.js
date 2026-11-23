// H-2: two windows of the same person stay in step (decision D20: one user, several tabs).
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createApplication } from '../../src/application/create-application.js';
import { LocalStorageCoaRepository } from '../../src/adapters/persistence/local-storage-coa-repository.js';
import { InMemorySettingsRepository } from '../../src/adapters/persistence/in-memory-settings-repository.js';
import { MilsymbolRenderer } from '../../src/adapters/rendering/milsymbol-renderer.js';
import { SystemClock } from '../../src/adapters/system/system-clock.js';
import { CryptoIdGenerator } from '../../src/adapters/system/crypto-id-generator.js';
import { createAppClient } from '../../src/adapters/ui/app-client.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createCrossWindowSync } from '../../src/adapters/ui/cross-window-sync.js';
import { FakeStorage } from '../support/fake-storage.js';

const INF = '10031000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

/** One "window": its own app and client over the shared browser storage, like a second tab. */
function windowOn(storage, channel) {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator(window.crypto);
  const app = createApplication({ clock, ids, coaRepository: new LocalStorageCoaRepository({ storage }), symbolRenderer: new MilsymbolRenderer(window.ms), settingsRepository: new InMemorySettingsRepository() });
  const client = createAppClient(app, { clock, ids, source: 'ui' });
  const win = new EventTarget();
  win.BroadcastChannel = window.BroadcastChannel;
  const calls = { list: 0, settings: 0, notes: [] };
  return { client, win, calls, channel };
}

async function twoWindows() {
  const storage = new FakeStorage();
  const channel = `coa-builder-test-${Math.random()}`;
  const a = windowOn(storage, channel);
  const b = windowOn(storage, channel);
  const coa = (await a.client.send('coa.create', { name: 'Shared' })).value;
  for (const w of [a, b]) {
    w.selection = createSelection(coa.id);
    w.activeCoa = createActiveCoa({ client: w.client, selection: w.selection });
    await w.activeCoa.ready;
    w.sync = createCrossWindowSync({
      client: w.client, win: w.win, channelName: channel, activeCoa: w.activeCoa,
      refreshList: () => { w.calls.list += 1; }, refreshSettings: () => { w.calls.settings += 1; },
      onUpdated: (text) => w.calls.notes.push(text),
    });
    cleanups.push(() => { w.sync.destroy(); w.activeCoa.destroy(); });
  }
  return { a, b, coa, storage };
}

describe('cross-window sync', () => {
  it('shows a change made in another window, and says so', async () => {
    const { a, b, coa } = await twoWindows();
    await a.client.send('symbol.add', { coaId: coa.id, sidc: INF, position: { lat: 1, lng: 1 }, label: 'From A' });
    await waitFor(() => b.activeCoa.get().symbols.length === 1, { message: 'window B reloads the active COA' });
    assert.equal(b.activeCoa.get().symbols[0].label, 'From A');
    await waitFor(() => b.calls.list > 0, { message: 'and its COA list' });
    assert.match(b.calls.notes.join(), /another window/);
  });

  it('the other window can keep editing straight away (no "changed elsewhere" conflict)', async () => {
    const { a, b, coa } = await twoWindows();
    await a.client.send('coa.update', { coaId: coa.id, name: 'Renamed in A' });
    await waitFor(() => b.activeCoa.get().name === 'Renamed in A');
    const result = await b.client.send('coa.update', { coaId: coa.id, name: 'Then B' });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    await waitFor(() => a.activeCoa.get().name === 'Then B');
  });

  it('does not echo: a window does not reload for its own changes', async () => {
    const { a, coa } = await twoWindows();
    await a.client.send('coa.update', { coaId: coa.id, name: 'Mine' });
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(a.calls.notes, []);
  });

  it('settings changed in another window reload there', async () => {
    const { a, b } = await twoWindows();
    await a.client.send('settings.update', { expectedRevision: 0, marking: { text: 'SECRET', color: '#c8102e' } });
    await waitFor(() => b.calls.settings > 0);
  });

  it('catches up when the window gets focus (a change it was not told about, e.g. another browser)', async () => {
    const { b, coa, storage } = await twoWindows();
    const silent = windowOn(storage, 'no-channel'); // no sync: it announces nothing
    await silent.client.send('coa.update', { coaId: coa.id, name: 'Changed quietly' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(b.activeCoa.get().name, 'Shared', 'not told yet');
    b.win.dispatchEvent(new Event('focus'));
    await waitFor(() => b.activeCoa.get().name === 'Changed quietly');
  });
});
