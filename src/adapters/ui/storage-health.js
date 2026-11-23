// Storage health (UI adapter state): watches every reply that passes through the app client and
// notices storage failures, so the UI can say a change was not saved and what to do about it.
//   const health = createStorageHealth(client)   →  health.client: use it instead of `client`
//   health.get()        { ok: true, recovered? } | { ok: false, code, message }
//   health.subscribe(fn), health.retry(), health.destroy()
// While the store is unreachable it checks again every `retryMs` with a cheap read (coa.list).
// Full storage is not probed (that would need a write): the next successful save clears it.
const PROBLEMS = new Set(['STORAGE_UNAVAILABLE', 'STORAGE_QUOTA_EXCEEDED', 'UNEXPECTED']);

export function createStorageHealth(client, { retryMs = 5000 } = {}) {
  let state = { ok: true };
  let timer = null;
  let destroyed = false;
  const listeners = new Set();

  const set = (next) => {
    state = Object.freeze(next);
    [...listeners].forEach((fn) => fn(state));
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!destroyed && !state.ok && state.code !== 'STORAGE_QUOTA_EXCEEDED') timer = setTimeout(retry, retryMs);
  };
  const observe = (kind) => (result) => {
    if (!result.ok && PROBLEMS.has(result.error.code)) {
      set({ ok: false, code: result.error.code, message: result.error.message });
      schedule();
    } else if (result.ok && !state.ok && (kind === 'command' || state.code === 'STORAGE_UNAVAILABLE')) {
      clearTimeout(timer);
      set({ ok: true, recovered: true });
    }
    return result;
  };

  const wrapped = Object.freeze({
    ...client,
    send: (...args) => client.send(...args).then(observe('command')),
    ask: (...args) => client.ask(...args).then(observe('query')),
  });

  async function retry() {
    if (destroyed || state.ok) return;
    const result = await wrapped.ask('coa.list', {});
    if (!result.ok) schedule();
  }

  return {
    client: wrapped,
    get: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    retry,
    destroy() { destroyed = true; clearTimeout(timer); listeners.clear(); },
  };
}
