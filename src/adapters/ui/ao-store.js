// The project's area of operations, for the views that flag items outside it (E6-6): loaded from the
// settings, and again whenever they change.
//   get() → { name, points } | null    subscribe(fn(ao)) → off    ready    destroy()
export function createAoStore({ client }) {
  let ao = null;
  let seq = 0;
  const listeners = new Set();
  async function load() {
    const mine = ++seq;
    const got = await client.ask('settings.get');
    if (mine !== seq) return;
    ao = got.ok ? got.value?.ao ?? null : null;
    [...listeners].forEach((fn) => fn(ao));
  }
  const off = client.subscribe('settings.*', () => { load(); });
  const ready = load();
  return {
    get: () => ao,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    ready,
    destroy() { off(); listeners.clear(); },
  };
}
