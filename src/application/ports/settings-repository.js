// Driven port: SettingsRepository. One settings document beside the COAs, with optimistic concurrency.
/**
 * @typedef {{ revision: number, frame: Object|null, marking: { text: string, color: string } }} Settings
 * @typedef {Object} SettingsRepository
 * @property {() => Promise<import('../../shared/result.js').Result<Settings|null>>} get
 *   ok(null) when nothing has been saved yet.
 * @property {(settings: Settings, opts: { expectedRevision: number }) => Promise<import('../../shared/result.js').Result<void>>} save
 *   The stored revision (0 when nothing is stored) must equal expectedRevision, otherwise
 *   CONFLICT { coaId: "settings", expectedRevision, actualRevision }.
 */
export {};
