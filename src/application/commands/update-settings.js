import { defineMessage, staleRevision, validationFailed } from '../message-definition.js';
import { DEFAULT_SETTINGS, checkSettingsChange, updateSettings as applyChange } from '../../domain/settings.js';
import { ok } from '../../shared/result.js';

/**
 * settings.update { expectedRevision, frame?, marking? } → ok(Settings)
 * emits settings.updated { settings, changed } unless nothing changed.
 */
export const updateSettings = defineMessage({
  kind: 'command', type: 'settings.update', v: 1,
  required: ['expectedRevision'], optional: ['frame', 'marking'],
  async handle({ payload: { expectedRevision, ...change }, ctx, ports: { settingsStore } }) {
    const problems = [
      ...(Number.isInteger(expectedRevision) && expectedRevision >= 0 ? [] : [{ field: 'expectedRevision', reason: 'must be an integer ≥ 0' }]),
      ...checkSettingsChange(change),
    ];
    if (problems.length) return validationFailed('Invalid settings.update payload', problems);

    const loaded = await settingsStore.get();
    if (!loaded.ok) return loaded;
    const current = loaded.value ?? DEFAULT_SETTINGS;
    if (current.revision !== expectedRevision) return staleRevision('settings', expectedRevision, current.revision);

    const updated = applyChange(current, change);
    if (!updated.ok) return updated;
    const { settings, events } = updated.value;
    if (events.length > 0) {
      const saved = await settingsStore.save(settings, { expectedRevision });
      if (!saved.ok) return saved;
      events.forEach((e) => ctx.emit(e));
    }
    return ok(settings);
  },
});
