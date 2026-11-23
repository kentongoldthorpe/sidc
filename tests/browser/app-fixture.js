// A real application for UI tests: real handlers, in-memory storage, real milsymbol.
// Views are driven through the DOM; the app is only read back to check effects.
import { createApplication } from '../../src/application/create-application.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { InMemorySettingsRepository } from '../../src/adapters/persistence/in-memory-settings-repository.js';
import { MilsymbolRenderer } from '../../src/adapters/rendering/milsymbol-renderer.js';
import { SystemClock } from '../../src/adapters/system/system-clock.js';
import { CryptoIdGenerator } from '../../src/adapters/system/crypto-id-generator.js';
import { createAppClient } from '../../src/adapters/ui/app-client.js';

export function createTestApp({ coaRepository = new InMemoryCoaRepository() } = {}) {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator(window.crypto);
  const app = createApplication({ clock, ids, coaRepository, symbolRenderer: new MilsymbolRenderer(window.ms), settingsRepository: new InMemorySettingsRepository() });
  return { app, client: createAppClient(app, { clock, ids, source: 'ui.test' }), other: createAppClient(app, { clock, ids, source: 'other-tab' }) };
}

/** A fresh element in the off-screen sandbox. */
export function sandbox(html = '') {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.getElementById('sandbox').append(host);
  return host;
}

/** Type into an input the way a user would (value + input event). */
export function type(input, text) {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
export const texts = (root, selector) => [...root.querySelectorAll(selector)].map((el) => el.textContent.trim());
