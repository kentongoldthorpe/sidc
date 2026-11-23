// Per-viewer UI preferences (open sections, list level, recent COAs, base map). Conveniences only:
// stored as JSON in browser storage when available, silently forgotten when not.
const PREFIX = 'coa-builder:ui:';

/** @param {Storage | undefined} storage e.g. localStorage (may be missing or throw) */
export function createPrefs(storage) {
  return Object.freeze({
    get(key, fallback) {
      try {
        const raw = storage?.getItem(PREFIX + key);
        return raw === null || raw === undefined ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { storage?.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* not remembered; harmless */ }
    },
  });
}

/** In-memory prefs, for tests and when storage is unavailable. */
export function createMemoryPrefs() {
  const values = new Map();
  return Object.freeze({
    get: (key, fallback) => (values.has(key) ? structuredClone(values.get(key)) : fallback),
    set: (key, value) => { values.set(key, structuredClone(value)); },
  });
}
