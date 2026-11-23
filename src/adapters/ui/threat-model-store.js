// The selected threat model and the systems list, loaded once per change and shared by the
// Threat models workspace (canvas, template editor, models panel). Like the active-COA store.
//   get()            the selected ThreatModel or null       systems() → Map(id → System)
//   play()           'formation' or the id of the threat COA whose play is shown (playSelection)
//   template()       the template being shown: the formation or that COA's play
//   subscribe(fn(model, { switched, error }))              ready, refresh(), destroy()
//   saveTemplate(change)  change(template copy) → new template; sends threat-model.set-template for the play shown
import { coalesce } from './views/coalesce.js';
import { createSelection } from './selection.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

/** @param {{ client: object, modelSelection: object, playSelection?: object }} options */
export function createThreatModelStore({ client, modelSelection, playSelection = createSelection('formation') }) {
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
    if (playSelection.get() !== 'formation' && !model?.coas.some((c) => c.id === playSelection.get())) {
      playSelection.set('formation'); // the COA shown is gone: show the formation (that load notifies)
      return;
    }
    const error = !got.ok && got.error.code !== 'NOT_FOUND' ? got.error : (!listed.ok ? listed.error : null);
    [...listeners].forEach((fn) => fn(model, { switched, error }));
  }

  const reload = coalesce(() => { if (!destroyed) load(false); });
  const unsubscribes = [
    client.subscribe('threat-model.*', (e) => { const id = e.payload?.modelId ?? e.payload?.model?.id; if (id === modelSelection.get()) reload(); }),
    client.subscribe('system.*', () => reload()),
    modelSelection.subscribe(() => { if (playSelection.get() !== 'formation') playSelection.set('formation'); else load(true); }),
    playSelection.subscribe(() => load(true)),
  ];
  const ready = load(true);

  return {
    get: () => model,
    systems: () => systems,
    play: () => playSelection.get(),
    playSelection,
    template: () => (playSelection.get() === 'formation' ? model?.formation : model?.coas.find((c) => c.id === playSelection.get())?.template) ?? null,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    ready,
    refresh: () => load(false),
    /** Replace the template shown (formation or a COA's play) with `change(copy of it)`. @returns {Promise<Result>} */
    async saveTemplate(change) {
      const current = this.template();
      if (!model || !current) return { ok: false, error: { code: 'NOT_FOUND', message: 'No threat model is selected', details: {} } };
      const template = change(copy(current));
      const result = await client.send('threat-model.set-template', { modelId: model.id, expectedRevision: model.revision, target: playSelection.get(), template });
      if (result.ok && !destroyed && result.value.id === modelSelection.get()) {
        model = result.value; // show it now; the event reload follows
        [...listeners].forEach((fn) => fn(model, { switched: false, error: null }));
      }
      return result;
    },
    destroy() { destroyed = true; listeners.clear(); unsubscribes.forEach((off) => off()); },
  };
}
