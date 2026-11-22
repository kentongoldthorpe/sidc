// Immutability and plain-data helpers shared by every layer.

/**
 * Freeze `value` and everything reachable from it. Returns the same reference.
 * Safe with cycles; recurses even into already-frozen parents.
 * @template T @param {T} value @returns {T}
 */
export function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * True when `value` is plain JSON data: strings, finite numbers, booleans, null,
 * dense arrays and plain objects of those. Rejects undefined, NaN, functions,
 * class instances, Maps, cycles, etc. so that JSON.parse(JSON.stringify(v)) equals v.
 * @param {unknown} value @returns {boolean}
 */
export function isJsonValue(value, ancestors = new Set()) {
  switch (typeof value) {
    case 'string': case 'boolean': return true;
    case 'number': return Number.isFinite(value);
    case 'object': break;
    default: return false;
  }
  if (value === null) return true;
  if (ancestors.has(value)) return false;
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) return false;
  if (Object.getOwnPropertySymbols(value).length) return false;

  ancestors.add(value);
  try {
    if (isArray) {
      for (let i = 0; i < value.length; i++) {
        if (!(i in value) || !isJsonValue(value[i], ancestors)) return false;
      }
      return true;
    }
    return Object.keys(value).every((k) => isJsonValue(value[k], ancestors));
  } finally {
    ancestors.delete(value);
  }
}

/** @param {unknown} value @returns {boolean} plain (non-array) JSON object */
export const isJsonObject = (value) => isPlainObject(value) && isJsonValue(value);

/**
 * Deep, frozen copy of JSON data. The original is left untouched.
 * @template T @param {T} value @returns {T}
 * @throws {TypeError} when value is not plain JSON data
 */
export function cloneJson(value) {
  if (!isJsonValue(value)) throw new TypeError('cloneJson: value is not plain JSON data');
  return deepFreeze(JSON.parse(JSON.stringify(value)));
}
