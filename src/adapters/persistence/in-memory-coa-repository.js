// CoaRepository adapter kept in memory. Used by tests and as a fallback when storage is blocked.
import { cloneJson } from '../../shared/freeze.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const bySummaryOrder = (a, b) =>
  (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)
  || a.name.localeCompare(b.name)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const notFound = (coaId) => err(ErrorCode.NOT_FOUND, `COA ${coaId} not found`, { coaId });

/** Checks shared by save() and remove(). @returns {Result|null} a failure, or null to proceed */
function checkRevision(stored, coaId, expectedRevision) {
  if (!stored) return expectedRevision === 0 ? null : notFound(coaId);
  if (stored.revision !== expectedRevision) {
    return err(ErrorCode.CONFLICT, `COA ${coaId} was changed elsewhere`, {
      coaId, expectedRevision, actualRevision: stored.revision,
    });
  }
  return null;
}

/** @implements {import('../../application/ports/coa-repository.js').CoaRepository} */
export class InMemoryCoaRepository {
  /** @type {Map<string, object>} */
  #coas = new Map();

  async list() {
    const summaries = [...this.#coas.values()].map(({ id, name, symbols, revision, updatedAt }) =>
      ({ id, name, symbolCount: symbols.length, revision, updatedAt }));
    return ok(cloneJson(summaries.sort(bySummaryOrder)));
  }

  async get(coaId) {
    const stored = this.#coas.get(coaId);
    return stored ? ok(stored) : notFound(coaId);
  }

  async save(coa, { expectedRevision }) {
    const failure = checkRevision(this.#coas.get(coa.id), coa.id, expectedRevision);
    if (failure) return failure;
    this.#coas.set(coa.id, cloneJson(coa));
    return ok();
  }

  async remove(coaId, { expectedRevision }) {
    const stored = this.#coas.get(coaId);
    if (!stored) return notFound(coaId);
    const failure = checkRevision(stored, coaId, expectedRevision);
    if (failure) return failure;
    this.#coas.delete(coaId);
    return ok();
  }
}
