// H-4 Fail safely: a storage problem shows a banner with what to do; backups work even then.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, BreakableRepository } from './app-fixture.js';
import { createStorageHealth } from '../../src/adapters/ui/storage-health.js';
import { mountStorageBanner } from '../../src/adapters/ui/views/storage-banner.js';
import { backupAllCoas } from '../../src/adapters/ui/backup.js';
import { createActiveCoa } from '../../src/adapters/ui/active-coa.js';
import { createSelection } from '../../src/adapters/ui/selection.js';

const INF = '10031000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

async function setup({ retryMs = 20 } = {}) {
  const repo = new BreakableRepository();
  const fixture = createTestApp({ coaRepository: repo });
  const a = (await fixture.client.send('coa.create', { name: 'Alpha' })).value;
  const b = (await fixture.client.send('coa.create', { name: 'Bravo' })).value;
  const health = createStorageHealth(fixture.client, { retryMs });
  const selection = createSelection(a.id);
  const activeCoa = createActiveCoa({ client: health.client, selection });
  await activeCoa.ready;
  const saved = [];
  const saveFile = async (blob, name) => { saved.push({ name, text: await blob.text() }); };
  const host = sandbox();
  const banner = mountStorageBanner({ root: host, health, backup: () => backupAllCoas({ client: health.client, activeCoa, saveFile }) });
  cleanups.push(() => { banner.destroy(); health.destroy(); activeCoa.destroy(); host.remove(); });
  return { ...fixture, repo, health, client: health.client, host, a, b, activeCoa, saved, saveFile };
}
const bannerEl = (host) => host.querySelector('[data-storage-banner]');
const shown = (host) => !bannerEl(host).hidden;
const button = (scope, label) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === label);

describe('storage health and banner', () => {
  it('shows nothing while storage works', async () => {
    const { host, client, a } = await setup();
    await client.send('symbol.add', { coaId: a.id, sidc: INF, position: { lat: 1, lng: 1 } });
    assert.equal(shown(host), false);
    assert.equal(bannerEl(host).getAttribute('role'), 'alert');
  });

  it('says a change was not saved when the file server stops, keeps checking, and says when it is back', async () => {
    const { host, client, repo, a, health } = await setup();
    repo.failWrites = 'STORAGE_UNAVAILABLE'; repo.failReads = 'STORAGE_UNAVAILABLE';
    const result = await client.send('symbol.add', { coaId: a.id, sidc: INF, position: { lat: 1, lng: 1 } });
    assert.equal(result.ok, false, 'the view still gets the failure');
    await waitFor(() => shown(host));
    assert.match(bannerEl(host).textContent, /not saved/i);
    assert.match(bannerEl(host).textContent, /serve\.ps1/);
    assert.equal(health.get().ok, false);
    repo.failWrites = null; repo.failReads = null;
    await waitFor(() => health.get().ok, { message: 'a background check should notice storage is back' });
    await waitFor(() => /working again/i.test(bannerEl(host).textContent));
  });

  it('explains full browser storage, and offers a backup', async () => {
    const { host, client, repo, a, saved } = await setup();
    repo.failWrites = 'STORAGE_QUOTA_EXCEEDED';
    await client.send('coa.update', { coaId: a.id, name: 'Alpha 2' });
    await waitFor(() => /storage is full/i.test(bannerEl(host).textContent));
    button(bannerEl(host), 'Back up all COAs').click();
    await waitFor(() => saved.length === 1);
    const doc = JSON.parse(saved[0].text);
    assert.equal(doc.format, 'coa-builder/import');
    assert.deepEqual(doc.coas.map((c) => c.name).sort(), ['Alpha', 'Bravo'], 'reading still works when only writing fails');
  });

  it('Retry now checks straight away; queries alone never raise the banner when they succeed', async () => {
    const { host, client, repo, a, health } = await setup({ retryMs: 60_000 });
    repo.failWrites = 'STORAGE_UNAVAILABLE';
    await client.send('coa.update', { coaId: a.id, name: 'X' });
    await waitFor(() => shown(host));
    repo.failWrites = null;
    button(bannerEl(host), 'Retry now').click();
    await waitFor(() => health.get().ok);
  });
});

describe('back up all COAs', () => {
  it('saves every COA in one re-importable JSON file named with the DTG', async () => {
    const { client, activeCoa, saveFile, saved } = await setup();
    const message = await backupAllCoas({ client, activeCoa, saveFile });
    assert.match(saved[0].name, /^coas-backup_\d{6}Z[A-Z]{3}\d{2}\.json$/);
    assert.equal(JSON.parse(saved[0].text).coas.length, 2);
    assert.match(message, /Backed up 2 COAs/);
  });

  it('when storage cannot be read, still saves the COA on screen and says what is missing', async () => {
    const { client, repo, activeCoa, saveFile, saved } = await setup();
    repo.failReads = 'STORAGE_UNAVAILABLE';
    const message = await backupAllCoas({ client, activeCoa, saveFile });
    assert.deepEqual(JSON.parse(saved[0].text).coas.map((c) => c.name), ['Alpha']);
    assert.match(message, /Backed up 1 COA .*could not be read/);
  });
});
