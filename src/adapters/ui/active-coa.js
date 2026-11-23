// The active COA, loaded once per change and shared by every view (map, units, lines & areas,
// export). Before this, each view fetched the COA itself on every event: five reads per drag, and
// views that could disagree for a moment.
//
//   subscribe(fn(coa | null, { switched, error }))  after every load
//     switched: a different COA (or none) is now selected; error: a failed load (not NOT_FOUND)
//   get()      the latest loaded COA, or null
//   ready      the first load
//   refresh()  load again now
import { coalesce } from './views/coalesce.js';

/** @param {{ client: object, selection: object }} options */
export function createActiveCoa({ client, selection }) {
  let coa = null;
  let seq = 0;
  let destroyed = false;
  const listeners = new Set();

  async function load(switched) {
    const mine = ++seq;
    const coaId = selection.get();
    let error = null;
    if (coaId === null) {
      coa = null;
    } else {
      const result = await client.ask('coa.get', { coaId });
      if (destroyed || mine !== seq) return; // a newer load is on its way
      coa = result.ok ? result.value : null;
      if (!result.ok && result.error.code !== 'NOT_FOUND') error = result.error;
    }
    [...listeners].forEach((fn) => fn(coa, { switched, error }));
  }

  const reload = coalesce(() => { if (!destroyed) load(false); });
  const onEvent = (event) => {
    const id = event.payload?.coaId ?? event.payload?.coa?.id;
    if (id !== undefined && id === selection.get()) reload();
  };
  const unsubscribes = [
    client.subscribe('coa.*', onEvent),
    client.subscribe('symbol.*', onEvent),
    client.subscribe('graphic.*', onEvent),
    selection.subscribe(() => load(true)),
  ];
  const ready = load(true);

  return {
    get: () => coa,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    ready,
    refresh: () => load(false),
    destroy() {
      destroyed = true;
      listeners.clear();
      unsubscribes.forEach((off) => off());
    },
  };
}
