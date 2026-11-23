// COAs and the settings document, kept through the one storage port (DocumentRepository, D31).
// Commands use these typed views; the errors keep the COA-shaped details the UI and the message
// catalogue have always had ({ coaId, expectedRevision, actualRevision }).
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { deepFreeze } from '../../shared/freeze.js';

export const COAS = 'coas';
export const SETTINGS = 'settings';
const SETTINGS_ID = 'settings';

/** @typedef {{ id: string, name: string, symbolCount: number, revision: number, updatedAt: string }} CoaSummary */
const toSummary = ({ id, name, symbols, revision, updatedAt }) => ({ id, name, symbolCount: symbols.length, revision, updatedAt });
/** Most recently updated first, then name, then id. */
const bySummaryOrder = (a, b) =>
  (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)
  || a.name.localeCompare(b.name)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A document error re-worded for a COA: details name the coaId instead of collection and id. */
function asCoaError(result, coaId) {
  if (result.ok) return result;
  const { code, message, details = {} } = result.error;
  const { collection, id, ...rest } = details;
  const text = code === ErrorCode.NOT_FOUND ? `COA ${coaId} not found`
    : code === ErrorCode.CONFLICT ? `COA ${coaId} was changed elsewhere` : message;
  return err(code, text, { coaId, ...rest });
}

/**
 * @param {import('../ports/document-repository.js').DocumentRepository} documents
 * @returns {{ list(): Promise<Result<CoaSummary[]>>, get(coaId): Promise<Result>, save(coa, { expectedRevision }): Promise<Result>, remove(coaId, { expectedRevision }): Promise<Result> }}
 */
export function coaStore(documents) {
  return {
    async list() {
      const listed = await documents.list(COAS);
      return listed.ok ? ok(listed.value.map(toSummary).sort(bySummaryOrder)) : listed;
    },
    async get(coaId) { return asCoaError(await documents.get(COAS, coaId), coaId); },
    async save(coa, { expectedRevision }) { return asCoaError(await documents.save(COAS, coa, { expectedRevision }), coa.id); },
    async remove(coaId, { expectedRevision }) { return asCoaError(await documents.remove(COAS, coaId, { expectedRevision }), coaId); },
  };
}

/**
 * The one settings document ({ revision, frame, marking }), stored as settings/settings.
 * get() → ok(null) before the first save. A stale save → CONFLICT { coaId: "settings", … }.
 */
export function settingsStore(documents) {
  const conflict = (expectedRevision, actualRevision) =>
    err(ErrorCode.CONFLICT, 'The settings were changed elsewhere', { coaId: SETTINGS_ID, expectedRevision, actualRevision });
  return {
    async get() {
      const loaded = await documents.get(SETTINGS, SETTINGS_ID);
      if (!loaded.ok) return loaded.error.code === ErrorCode.NOT_FOUND ? ok(null) : loaded;
      const { id, ...settings } = loaded.value;
      return ok(deepFreeze(settings));
    },
    async save(settings, { expectedRevision }) {
      const saved = await documents.save(SETTINGS, { id: SETTINGS_ID, ...settings }, { expectedRevision });
      if (saved.ok) return saved;
      if (saved.error.code === ErrorCode.CONFLICT) return conflict(expectedRevision, saved.error.details.actualRevision ?? 0);
      if (saved.error.code === ErrorCode.NOT_FOUND) return conflict(expectedRevision, 0);
      return saved;
    },
  };
}
