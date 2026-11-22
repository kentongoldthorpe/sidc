// Driven port: CoaRepository. Persists whole COA aggregates with optimistic concurrency.
/**
 * @typedef {import('../../domain/coa.js').Coa} Coa
 * @typedef {{ id: string, name: string, symbolCount: number, revision: number, updatedAt: string }} CoaSummary
 * @typedef {import('../../shared/result.js').Result<any>} Result
 *
 * @typedef {Object} CoaRepository
 * @property {() => Promise<Result>} list
 *   ok(CoaSummary[]) sorted by updatedAt desc, then name, then id.
 * @property {(coaId: string) => Promise<Result>} get
 *   ok(Coa) | NOT_FOUND { coaId }.
 * @property {(coa: Coa, opts: { expectedRevision: number }) => Promise<Result>} save
 *   expectedRevision 0 creates (CONFLICT if the id exists); otherwise the stored revision must equal
 *   expectedRevision (CONFLICT { coaId, expectedRevision, actualRevision }, NOT_FOUND { coaId } if missing).
 * @property {(coaId: string, opts: { expectedRevision: number }) => Promise<Result>} remove
 *   ok() | NOT_FOUND | CONFLICT, as for save.
 * Adapters may also fail with STORAGE_UNAVAILABLE or STORAGE_QUOTA_EXCEEDED.
 * Returned objects are frozen copies; later changes by the caller never reach storage.
 */
export {};
