// SettingsRepository kept in memory (tests, and the "not saved" fallback).
import { cloneJson } from '../../shared/freeze.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

/** @implements {import('../../application/ports/settings-repository.js').SettingsRepository} */
export class InMemorySettingsRepository {
  #stored = null;

  async get() { return ok(this.#stored); }

  async save(settings, { expectedRevision }) {
    const actualRevision = this.#stored?.revision ?? 0;
    if (actualRevision !== expectedRevision) {
      return err(ErrorCode.CONFLICT, 'The settings were changed elsewhere', { coaId: 'settings', expectedRevision, actualRevision });
    }
    this.#stored = cloneJson(settings);
    return ok();
  }
}
