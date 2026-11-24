// MapSymbol entity fields: sidc, position, label, modifiers, and the unit extras (D28): facing?,
// hvt?, weapons?, details? (see weapon.js). An extra is only present when set.
import { parseSidc } from './sidc.js';
import { parseLatLng } from './lat-lng.js';
import { isObject } from '../shared/values.js';
import { UNIT_EXTRAS } from './weapon.js';

export const LABEL_MAX = 30;
export const MODIFIER_TEXT_MAX = 50;


const text = (field, value) => {
  if (typeof value !== 'string') return { problems: [{ field, reason: 'must be a string' }] };
  const trimmed = value.trim();
  return trimmed.length > MODIFIER_TEXT_MAX
    ? { problems: [{ field, reason: `must be at most ${MODIFIER_TEXT_MAX} characters` }] }
    : { value: trimmed };
};

/** Allowed modifiers, in canonical order. Each returns { value } or { problems }; '' means "not set". */
const MODIFIER_RULES = Object.freeze({
  higherFormation: text,
  additionalInformation: text,
  staffComments: text,
  dtg: text,
  quantity: (field, value) => (typeof value === 'string' && /^\d{0,9}$/.test(value.trim())
    ? { value: value.trim() }
    : { problems: [{ field, reason: 'must be a string of up to 9 digits' }] }),
  direction: (field, value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360
    ? { value }
    : { problems: [{ field, reason: 'must be a number of degrees from 0 to less than 360' }] }),
});

/** The modifier names a symbol may carry (allow-list). */
export const MODIFIER_NAMES = Object.freeze(Object.keys(MODIFIER_RULES));

function parseModifiers(raw, field = 'modifiers') {
  if (!isObject(raw)) return { problems: [{ field, reason: 'must be an object' }] };
  const problems = Object.keys(raw)
    .filter((key) => !(key in MODIFIER_RULES))
    .map((key) => ({ field: `${field}.${key}`, reason: 'unknown modifier' }));
  const value = {};
  for (const [key, rule] of Object.entries(MODIFIER_RULES)) {
    if (!(key in raw)) continue;
    const parsed = rule(`${field}.${key}`, raw[key]);
    if (parsed.problems) problems.push(...parsed.problems);
    else if (parsed.value !== '') value[key] = parsed.value;
  }
  return problems.length ? { problems } : { value };
}

function parseLabel(raw, field = 'label') {
  if (typeof raw !== 'string') return { problems: [{ field, reason: 'must be a string' }] };
  const label = raw.trim();
  return label.length > LABEL_MAX
    ? { problems: [{ field, reason: `must be at most ${LABEL_MAX} characters` }] }
    : { value: label };
}

const PARSERS = Object.freeze({ sidc: parseSidc, position: parseLatLng, label: parseLabel, modifiers: parseModifiers, ...UNIT_EXTRAS });

/**
 * Parse whichever symbol fields are present, in the order sidc, position, label, modifiers,
 * facing, hvt, weapons, details. Empty extras (null, false, [], {}) parse to themselves: "remove".
 * @returns {{ problems: {field:string, reason:string}[], value: Object }} value holds normalised fields
 */
export function parseSymbolFields(fields) {
  const problems = [];
  const value = {};
  for (const [key, parse] of Object.entries(PARSERS)) {
    if (!(key in fields)) continue;
    const parsed = parse(fields[key]);
    if (parsed.problems?.length) problems.push(...parsed.problems);
    else value[key] = parsed.value;
  }
  return { problems, value };
}

/** Structural equality for symbol field values: strings, numbers and plain objects (key order ignored). */
export function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && jsonEqual(a[k], b[k]));
}
