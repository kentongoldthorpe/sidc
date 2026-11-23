import { defineMessage } from '../message-definition.js';
import { DEFAULT_SETTINGS } from '../../domain/settings.js';
import { ok } from '../../shared/result.js';

/** settings.get {} → ok(Settings), the defaults (revision 0) until something is saved. */
export const getSettings = defineMessage({
  kind: 'query', type: 'settings.get', v: 1,
  async handle({ ports: { settingsRepository } }) {
    const loaded = await settingsRepository.get();
    if (!loaded.ok) return loaded;
    return ok(loaded.value ?? DEFAULT_SETTINGS);
  },
});
