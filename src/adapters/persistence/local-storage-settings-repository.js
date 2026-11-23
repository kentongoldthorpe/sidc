// SettingsRepository over the Web Storage API: one JSON document under "<prefix>:settings".
import { cloneJson } from '../../shared/freeze.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const conflict = (expectedRevision, actualRevision) =>
  err(ErrorCode.CONFLICT, 'The settings were changed elsewhere', { coaId: 'settings', expectedRevision, actualRevision });

/** @implements {import('../../application/ports/settings-repository.js').SettingsRepository} */
export class LocalStorageSettingsRepository {
  #storage;
  #key;

  constructor({ storage, prefix = 'coa-builder' } = {}) {
    if (storage === null || typeof storage !== 'object') throw new TypeError('LocalStorageSettingsRepository: a Storage object is required');
    this.#storage = storage;
    this.#key = `${prefix}:settings`;
  }

  #read() {
    const raw = this.#storage.getItem(this.#key);
    if (raw === null) return null;
    try { return cloneJson(JSON.parse(raw)); } catch { return null; } // unreadable: treated as not saved
  }

  async get() {
    try { return ok(this.#read()); } catch (e) { return err(ErrorCode.STORAGE_UNAVAILABLE, 'Browser storage is not available', { cause: String(e?.message ?? e) }); }
  }

  async save(settings, { expectedRevision }) {
    try {
      const actualRevision = this.#read()?.revision ?? 0;
      if (actualRevision !== expectedRevision) return conflict(expectedRevision, actualRevision);
      this.#storage.setItem(this.#key, JSON.stringify(settings));
      return ok();
    } catch (e) {
      const quota = e?.name === 'QuotaExceededError' || e?.code === 22;
      return err(quota ? ErrorCode.STORAGE_QUOTA_EXCEEDED : ErrorCode.STORAGE_UNAVAILABLE, quota ? 'Browser storage is full' : 'Browser storage is not available', { cause: String(e?.message ?? e) });
    }
  }
}
