// Which COA is active: UI state shared between views (not domain state).
/** @returns {{ get(): string|null, set(id: string|null): void, subscribe(fn: (id: string|null) => void): () => void }} */
export function createSelection(initial = null) {
  let current = initial;
  const listeners = new Set();
  return Object.freeze({
    get: () => current,
    set(id) {
      if (id === current) return;
      current = id;
      [...listeners].forEach((fn) => fn(current));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}
