// Builds the hexagon: a message bus with every command and query handler registered,
// wired to the driven ports it is given. Adapters talk to the returned object only.
import { createMessageBus } from './bus/message-bus.js';
import { checkPayload } from './message-definition.js';
import { createCoa } from './commands/create-coa.js';
import { updateCoa } from './commands/update-coa.js';
import { duplicateCoa } from './commands/duplicate-coa.js';
import { deleteCoa } from './commands/delete-coa.js';
import { importCoas } from './commands/import-coas.js';
import { addSymbol } from './commands/add-symbol.js';
import { updateSymbol } from './commands/update-symbol.js';
import { moveSymbol } from './commands/move-symbol.js';
import { removeSymbol } from './commands/remove-symbol.js';
import { copySymbols } from './commands/copy-symbols.js';
import { removeSymbols } from './commands/remove-symbols.js';
import { getCoa } from './queries/get-coa.js';
import { listCoas } from './queries/list-coas.js';
import { previewSymbol } from './queries/preview-symbol.js';
import { getSettings } from './queries/get-settings.js';
import { updateSettings } from './commands/update-settings.js';

/** Every message the application accepts. */
export const MESSAGES = Object.freeze([
  createCoa, updateCoa, duplicateCoa, deleteCoa, importCoas,
  addSymbol, updateSymbol, moveSymbol, removeSymbol, copySymbols, removeSymbols,
  getCoa, listCoas, previewSymbol,
  getSettings, updateSettings,
]);

const REQUIRED_PORTS = Object.freeze({
  clock: ['now'],
  ids: ['next'],
  coaRepository: ['list', 'get', 'save', 'remove'],
  symbolRenderer: ['render'],
  settingsRepository: ['get', 'save'],
});

/**
 * @param {{ clock: import('./ports/clock.js').Clock,
 *           ids: import('./ports/id-generator.js').IdGenerator,
 *           coaRepository: import('./ports/coa-repository.js').CoaRepository,
 *           symbolRenderer: import('./ports/symbol-renderer.js').SymbolRenderer,
 *           settingsRepository: import('./ports/settings-repository.js').SettingsRepository,
 *           onError?: (error: unknown, event: object) => void }} deps
 * @returns {{ dispatch: Function, query: Function, publish: Function, subscribe: Function, use: Function }}
 */
export function createApplication({ onError, ...ports } = {}) {
  for (const [name, methods] of Object.entries(REQUIRED_PORTS)) {
    const missing = methods.filter((m) => typeof ports[name]?.[m] !== 'function');
    if (missing.length) throw new TypeError(`createApplication: port "${name}" must provide ${missing.join(', ')}()`);
  }

  const bus = createMessageBus({ clock: ports.clock, ids: ports.ids, ...(onError ? { onError } : {}) });

  for (const definition of MESSAGES) {
    const register = definition.kind === 'command' ? bus.registerCommand : bus.registerQuery;
    register(definition.type, async (envelope, ctx) => {
      const checked = checkPayload(definition, envelope);
      if (!checked.ok) return checked;
      return definition.handle({ payload: envelope.payload, ctx, ports, envelope });
    });
  }

  const { dispatch, query, publish, subscribe, use } = bus;
  return Object.freeze({ dispatch, query, publish, subscribe, use });
}
