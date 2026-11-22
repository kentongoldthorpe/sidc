// The CoaSummary shape and order that every CoaRepository adapter's list() returns.

/** @returns {import('../../application/ports/coa-repository.js').CoaSummary} */
export const toSummary = ({ id, name, symbols, revision, updatedAt }) =>
  ({ id, name, symbolCount: symbols.length, revision, updatedAt });

/** Most recently updated first, then name, then id. */
export const bySummaryOrder = (a, b) =>
  (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)
  || a.name.localeCompare(b.name)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
