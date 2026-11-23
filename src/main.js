// Composition root: the only module that reads browser and vendor globals and picks
// concrete adapters. Everything else receives what it needs from here.
import { createApplication } from './application/create-application.js';
import { pickStorage } from './adapters/persistence/pick-storage.js';
import { MilsymbolRenderer } from './adapters/rendering/milsymbol-renderer.js';
import { SystemClock } from './adapters/system/system-clock.js';
import { CryptoIdGenerator } from './adapters/system/crypto-id-generator.js';
import { createAppClient } from './adapters/ui/app-client.js';
import { mountUi } from './adapters/ui/mount-ui.js';
import { createPrefs } from './adapters/ui/prefs.js';

const { L, ms, crypto, document } = globalThis;

const clock = new SystemClock();
const ids = new CryptoIdGenerator(crypto);

// GeoJSON files when served by serve.ps1; otherwise this browser's storage; otherwise memory only.
const storage = await pickStorage({
  fetch: globalThis.fetch,
  getStorage: () => globalThis.localStorage, // a function: reading localStorage itself can throw
});

const prefs = createPrefs(globalThis.localStorage);
const symbolRenderer = new MilsymbolRenderer(ms);
const appIn = (projectId) => createApplication({
  clock,
  ids,
  projectId,
  documentRepository: storage.documentRepository,
  symbolRenderer,
  onError: (error, event) => console.error(`COA Builder: a subscriber failed on ${event.type}`, error),
});

// The app runs inside one project (D27): the one this browser last opened, if it still exists.
const DEFAULT_PROJECT = 'default';
let projectId = prefs.get('project', DEFAULT_PROJECT);
let app;
try { app = appIn(projectId); } catch { app = null; }
let client = app && createAppClient(app, { clock, ids, source: 'ui' });
const found = client && await client.ask('project.get');
if (!found?.ok && projectId !== DEFAULT_PROJECT) {
  projectId = DEFAULT_PROJECT;
  prefs.set('project', projectId);
  client?.close();
  app = appIn(projectId);
  client = createAppClient(app, { clock, ids, source: 'ui' });
}

mountUi({
  client,
  L,
  root: document.getElementById('app'),
  prefs,
  storageLabel: storage.label,
  // Opening another project starts the app afresh inside it, like opening another ArcGIS Pro project.
  openProject: (id) => { prefs.set('project', id); globalThis.location.reload(); },
});

// For manual testing from the browser console until the views exist, e.g.
//   const { value: coa } = await coaBuilder.client.send('coa.create', { name: 'COA 1' })
globalThis.coaBuilder = Object.freeze({ client, storage: storage.kind, projectId });
