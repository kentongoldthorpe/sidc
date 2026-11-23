// Composition root: the only module that reads browser and vendor globals and picks
// concrete adapters. Everything else receives what it needs from here.
import { createApplication } from './application/create-application.js';
import { pickCoaRepository } from './adapters/persistence/pick-coa-repository.js';
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
const storage = await pickCoaRepository({
  fetch: globalThis.fetch,
  getStorage: () => globalThis.localStorage, // a function: reading localStorage itself can throw
});

const app = createApplication({
  clock,
  ids,
  coaRepository: storage.repository,
  symbolRenderer: new MilsymbolRenderer(ms),
  onError: (error, event) => console.error(`COA Builder: a subscriber failed on ${event.type}`, error),
});

const client = createAppClient(app, { clock, ids, source: 'ui' });

mountUi({
  client,
  L,
  root: document.getElementById('app'),
  prefs: createPrefs(globalThis.localStorage),
  storageLabel: storage.label,
});

// For manual testing from the browser console until the views exist, e.g.
//   const { value: coa } = await coaBuilder.client.send('coa.create', { name: 'COA 1' })
globalThis.coaBuilder = Object.freeze({ client, storage: storage.kind });
