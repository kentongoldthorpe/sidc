// Composition root: the only module that reads browser and vendor globals and picks
// concrete adapters. Everything else receives what it needs from here.
import { createApplication } from './application/create-application.js';
import { InMemoryCoaRepository } from './adapters/persistence/in-memory-coa-repository.js';
import { MilsymbolRenderer } from './adapters/rendering/milsymbol-renderer.js';
import { SystemClock } from './adapters/system/system-clock.js';
import { CryptoIdGenerator } from './adapters/system/crypto-id-generator.js';
import { createAppClient } from './adapters/ui/app-client.js';
import { mountUi } from './adapters/ui/mount-ui.js';

const { L, ms, crypto, document } = globalThis;

const clock = new SystemClock();
const ids = new CryptoIdGenerator(crypto);

const app = createApplication({
  clock,
  ids,
  coaRepository: new InMemoryCoaRepository(), // replaced by file / browser storage in Milestone 3
  symbolRenderer: new MilsymbolRenderer(ms),
  onError: (error, event) => console.error(`COA Builder: a subscriber failed on ${event.type}`, error),
});

const client = createAppClient(app, { clock, ids, source: 'ui' });

mountUi({
  client,
  L,
  root: document.getElementById('app'),
  storageLabel: 'Not saved: memory only',
});

// For manual testing from the browser console until the views exist, e.g.
//   const { value: coa } = await coaBuilder.client.send('coa.create', { name: 'COA 1' })
globalThis.coaBuilder = Object.freeze({ client });
