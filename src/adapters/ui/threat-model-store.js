// The selected threat model and the systems list, loaded once per change and shared by the
// Threat models workspace (canvas, template editor, models panel). Like the active-COA store.
//   get()            the selected ThreatModel or null       systems() → Map(id → System)
//   subscribe(fn(model, { switched, error }))              ready, refresh(), destroy()
//   saveFormation(change)  change(template copy) → new template; sends threat-model.set-template
import { coalesce } from './views/coalesce.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

/** @param {{ client: object, modelSelection: object }} options */
export function createThreatModelStore({ client, modelSelection }) {
  let model = null;
  let systems = new Map();
  let seq = 0;
  let destroyed = false;
  const listeners = new Set();

  async function load(switched) {
    const mine = ++seq;
    const modelId = modelSelection.get();
    const [got, listed] = await Promise.all([
      modelId === null ? Promise.resolve({ ok: true, value: null }) : client.ask('threat-model.get', { modelId }),
      client.ask('system.list', {}),
    ]);
    if (destroyed || mine !== seq) return;
    model = got.ok ? got.value : null;
    if (listed.ok) systems = new Map(listed.value.map((s) => [s.id, s]));
    const error = !got.ok && got.error.code !== 'NOT_FOUND' ? got.error : (!listed.ok ? listed.error : null);
    [...listeners].forEach((fn) => fn(model, { switched, error }));
  }

  const reload = coalesce(() => { if (!destroyed) load(false); });
  const unsubscribes = [
    client.subscribe('threat-model.*', (e) => { const id = e.payload?.modelId ?? e.payload?.model?.id; if (id === modelSelection.get()) reload(); }),
    client.subscribe('system.*', () => reload()),
    modelSelection.subscribe(() => load(true)),
  ];
  const ready = load(true);

  return {
    get: () => model,
    systems: () => systems,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    ready,
    refresh: () => load(false),
    /** Replace the formation with `change(copy of it)`. @returns {Promise<Result>} */
    async saveFormation(change) {
      if (!model) return { ok: false, error: { code: 'NOT_FOUND', message: 'No threat model is selected', details: {} } };
      const template = change(copy(model.formation));
      const result = await client.send('threat-model.set-template', { modelId: model.id, expectedRevision: model.revision, target: 'formation', template });
      if (result.ok && !destroyed && result.value.id === modelSelection.get()) {
        model = result.value; // show it now; the event reload follows
        [...listeners].forEach((fn) => fn(model, { switched: false, error: null }));
      }
      return result;
    },
    destroy() { destroyed = true; listeners.clear(); unsubscribes.forEach((off) => off()); },
  };
}
