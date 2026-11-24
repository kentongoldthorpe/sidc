// Builds the hexagon: a message bus with every command and query handler registered,
// wired to the driven ports it is given. Adapters talk to the returned object only.
import { createMessageBus } from './bus/message-bus.js';
import { checkPayload } from './message-definition.js';
import { coaStore, settingsStore } from './stores/coa-store.js';
import { scopeDocuments } from './stores/project-scope.js';
import { PROJECT_MESSAGES } from './commands/project-commands.js';
import { UNIT_TEMPLATE_MESSAGES } from './commands/unit-template-commands.js';
import { WEATHER_MESSAGES } from './commands/weather-commands.js';
import { getExportHeader } from './queries/export-header.js';
import { DEFAULT_PROJECT_ID, isProjectId } from '../domain/project.js';
import { createCoa } from './commands/create-coa.js';
import { updateCoa } from './commands/update-coa.js';
import { duplicateCoa } from './commands/duplicate-coa.js';
import { deleteCoa } from './commands/delete-coa.js';
import { importCoas } from './commands/import-coas.js';
import { restoreCoa } from './commands/restore-coa.js';
import { createSystem, updateSystem, deleteSystem, listSystems } from './commands/system-commands.js';
import { createModel, updateModel, setModelTemplate, deleteModel, listModels, getModel, addCoa as addThreatCoa, updateCoa as updateThreatCoa, removeCoa as removeThreatCoa, placeCoa as placeThreatCoa, updateFromTemplate, rePlace, snapToTemplate } from './commands/threat-model-commands.js';
import { addGraphic, updateGraphic, removeGraphic } from './commands/graphic-commands.js';
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
  createCoa, updateCoa, duplicateCoa, deleteCoa, importCoas, restoreCoa,
  addGraphic, updateGraphic, removeGraphic,
  createSystem, updateSystem, deleteSystem, listSystems,
  createModel, updateModel, setModelTemplate, deleteModel, listModels, getModel,
  addThreatCoa, updateThreatCoa, removeThreatCoa, placeThreatCoa, updateFromTemplate, rePlace, snapToTemplate,
  addSymbol, updateSymbol, moveSymbol, removeSymbol, copySymbols, removeSymbols,
  getCoa, listCoas, previewSymbol,
  getSettings, updateSettings,
  ...PROJECT_MESSAGES,
  ...UNIT_TEMPLATE_MESSAGES,
  ...WEATHER_MESSAGES,
  getExportHeader,
]);

const REQUIRED_PORTS = Object.freeze({
  clock: ['now'],
  ids: ['next'],
  symbolRenderer: ['render'],
  documentRepository: ['list', 'get', 'save', 'remove'],
});

/**
 * @param {{ clock: import('./ports/clock.js').Clock,
 *           ids: import('./ports/id-generator.js').IdGenerator,
 *           symbolRenderer: import('./ports/symbol-renderer.js').SymbolRenderer,
 *           documentRepository: import('./ports/document-repository.js').DocumentRepository,  the one storage port (D31)
 *           projectId?: string,  the open project (D27); default "default"
 *           onError?: (error: unknown, event: object) => void }} deps
 * @returns {{ dispatch: Function, query: Function, publish: Function, subscribe: Function, use: Function }}
 */
export function createApplication({ onError, projectId = DEFAULT_PROJECT_ID, ...given } = {}) {
  if (!isProjectId(projectId)) throw new TypeError(`createApplication: "${projectId}" is not a project id`);
  let ports = given;
  for (const [name, methods] of Object.entries(REQUIRED_PORTS)) {
    const missing = methods.filter((m) => typeof ports[name]?.[m] !== 'function');
    if (missing.length) throw new TypeError(`createApplication: port "${name}" must provide ${missing.join(', ')}()`);
  }

  // The app works inside one project (D27): handlers see that project's documents only, and the
  // project messages also see all of storage. COAs and settings get typed views.
  const documents = scopeDocuments(given.documentRepository, projectId);
  ports = { ...given, projectId, allDocuments: given.documentRepository, documentRepository: documents, coaStore: coaStore(documents), settingsStore: settingsStore(documents) };
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
