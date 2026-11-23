// Briefing settings: the shared export frame and the classification marking shown on every slide.
// Pure functions like the COA aggregate: (settings, input) → Result<{ settings, events }>.
import { parseFrame } from './frame.js';
import { jsonEqual } from './map-symbol.js';
import { deepFreeze } from '../shared/freeze.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';

export const MARKING_MAX = 80;
/** Unclassified by default, and always explicit (never a blank banner). */
export const DEFAULT_MARKING = Object.freeze({ text: 'UNCLASSIFIED', color: '#007a33' });
export const DEFAULT_SETTINGS = deepFreeze({ revision: 0, frame: null, marking: { ...DEFAULT_MARKING } });

/** @returns {{ value: object } | { problems: {field:string, reason:string}[] }} */
export function parseMarking(raw, field = 'marking') {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { problems: [{ field, reason: 'must be an object { text, color }' }] };
  const problems = [];
  const text = typeof raw.text === 'string' ? raw.text.trim() : null;
  if (text === null || text === '') problems.push({ field: `${field}.text`, reason: 'must not be blank (slides are always marked)' });
  else if (text.length > MARKING_MAX) problems.push({ field: `${field}.text`, reason: `must be at most ${MARKING_MAX} characters` });
  if (typeof raw.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw.color)) problems.push({ field: `${field}.color`, reason: 'must be a colour like #007a33' });
  for (const key of Object.keys(raw)) if (key !== 'text' && key !== 'color') problems.push({ field: `${field}.${key}`, reason: 'unknown field' });
  return problems.length ? { problems } : { value: { text, color: raw.color.toLowerCase() } };
}

/** Problems with a settings change { frame?, marking? } (frame may be null to clear it). */
export function checkSettingsChange({ frame, marking }) {
  return [
    ...(frame === undefined || frame === null ? [] : parseFrame(frame).problems ?? []),
    ...(marking === undefined ? [] : parseMarking(marking).problems ?? []),
  ];
}

/** Apply a change; unchanged values are ignored and give no events. */
export function updateSettings(settings, { frame, marking }) {
  const problems = checkSettingsChange({ frame, marking });
  if (problems.length) return err(ErrorCode.VALIDATION_FAILED, 'The settings are not valid', { problems });
  const next = {};
  if (frame !== undefined) {
    const value = frame === null ? null : parseFrame(frame).value;
    if (!jsonEqual(value, settings.frame)) next.frame = value;
  }
  if (marking !== undefined) {
    const value = parseMarking(marking).value;
    if (!jsonEqual(value, settings.marking)) next.marking = value;
  }
  const changed = Object.keys(next);
  if (changed.length === 0) return ok({ settings, events: [] });
  const updated = deepFreeze({ ...settings, ...next, revision: settings.revision + 1 });
  return ok({ settings: updated, events: [{ type: 'settings.updated', v: 1, payload: { settings: updated, changed } }] });
}
