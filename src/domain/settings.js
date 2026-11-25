// Briefing settings: the shared export frame, the classification marking shown on every slide, and
// the area of operations (E6-6; optional: absent until set, null clears it).
// Pure functions like the COA aggregate: (settings, input) → Result<{ settings, events }>.
import { parseFrame } from './frame.js';
import { parseAo } from './area-of-operations.js';
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

/** Problems with a settings change { frame?, marking?, ao? } (frame and ao may be null to clear them). */
export function checkSettingsChange({ frame, marking, ao }) {
  return [
    ...(frame === undefined || frame === null ? [] : parseFrame(frame).problems ?? []),
    ...(marking === undefined ? [] : parseMarking(marking).problems ?? []),
    ...(ao === undefined || ao === null ? [] : parseAo(ao).problems),
  ];
}

/** Apply a change; unchanged values are ignored and give no events. */
export function updateSettings(settings, { frame, marking, ao }) {
  const problems = checkSettingsChange({ frame, marking, ao });
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
  if (ao !== undefined) {
    const value = ao === null ? null : parseAo(ao).value;
    if (!jsonEqual(value, settings.ao ?? null)) next.ao = value;
  }
  const changed = Object.keys(next);
  if (changed.length === 0) return ok({ settings, events: [] });
  const merged = { ...settings, ...next, revision: settings.revision + 1 };
  if (merged.ao === null) delete merged.ao; // no area of operations: no field
  const updated = deepFreeze(merged);
  return ok({ settings: updated, events: [{ type: 'settings.updated', v: 1, payload: { settings: updated, changed } }] });
}
