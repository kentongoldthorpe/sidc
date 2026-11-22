// Test double for the Web Storage API (localStorage). Optional quota in characters, and switches to
// simulate a browser where storage is blocked.
export class FakeStorage {
  #items = new Map();
  #quota;

  /** @param {{ quota?: number }} [options] total characters (keys + values) allowed */
  constructor({ quota = Infinity } = {}) { this.#quota = quota; }

  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.has(String(key)) ? this.#items.get(String(key)) : null; }
  removeItem(key) { this.#items.delete(String(key)); }
  clear() { this.#items.clear(); }

  setItem(key, value) {
    const k = String(key); const v = String(value);
    let used = 0;
    for (const [ik, iv] of this.#items) if (ik !== k) used += ik.length + iv.length;
    if (used + k.length + v.length > this.#quota) {
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.#items.set(k, v);
  }
}

/** A storage whose every call throws, as when the browser blocks site data. */
export const blockedStorage = () => new Proxy({}, {
  get() { throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); },
});
