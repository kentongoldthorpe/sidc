// Driven port: IdGenerator. The core never creates random ids itself.
/**
 * @typedef {Object} IdGenerator
 * @property {(prefix?: string) => string} next  a new id, unique for the lifetime of the app,
 *   non-blank and at most 128 characters. Ids may start with `prefix` (e.g. "msg", "coa").
 */
export {};
