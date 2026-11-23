// System: a weapon or sensor in the user's systems list (decision D22), reused by threat models.
//   { id, revision, name, role, maxRange (m), minRange? (m), arc (degrees; 360 = all round) }
// Nothing is built in: the user enters the systems and their numbers.
import { deepFreeze } from '../shared/freeze.js';
import { isObject } from '../shared/values.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { jsonEqual } from './map-symbol.js';

export const SYSTEM_ROLES = Object.freeze(['direct', 'indirect', 'airDefence', 'sensor', 'other']);
export const SYSTEM_NAME_MAX = 60;
export const SYSTEM_RANGE_MAX = 5_000_000;
const FIELDS = Object.freeze(['name', 'role', 'maxRange', 'minRange', 'arc']);

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const invalid = (problems) => err(ErrorCode.VALIDATION_FAILED, 'The system is not valid', { problems });

/**
 * Check whichever system fields are present (minRange: null removes it, on updates).
 * @returns {{ problems: object[], value: object }}
 */
export function parseSystemFields(fields) {
  const problems = [];
  const value = {};
  if ('name' in fields) {
    const name = typeof fields.name === 'string' ? fields.name.trim() : '';
    if (name === '') problems.push({ field: 'name', reason: 'must not be blank' });
    else if (name.length > SYSTEM_NAME_MAX) problems.push({ field: 'name', reason: `must be at most ${SYSTEM_NAME_MAX} characters` });
    else value.name = name;
  }
  if ('role' in fields) {
    if (SYSTEM_ROLES.includes(fields.role)) value.role = fields.role;
    else problems.push({ field: 'role', reason: `must be one of ${SYSTEM_ROLES.join(', ')}` });
  }
  if ('maxRange' in fields) {
    if (isNumber(fields.maxRange) && fields.maxRange > 0 && fields.maxRange <= SYSTEM_RANGE_MAX) value.maxRange = fields.maxRange;
    else problems.push({ field: 'maxRange', reason: `must be a number of metres, more than 0 and at most ${SYSTEM_RANGE_MAX}` });
  }
  if ('minRange' in fields) {
    if (fields.minRange === null) value.minRange = null;
    else if (isNumber(fields.minRange) && fields.minRange >= 0) value.minRange = fields.minRange;
    else problems.push({ field: 'minRange', reason: 'must be a number of metres, 0 or more (or null for none)' });
  }
  if ('arc' in fields) {
    if (isNumber(fields.arc) && fields.arc > 0 && fields.arc <= 360) value.arc = fields.arc;
    else problems.push({ field: 'arc', reason: 'must be a number of degrees, more than 0 and at most 360 (360 = all round)' });
  }
  for (const key of Object.keys(fields)) if (!FIELDS.includes(key)) problems.push({ field: key, reason: 'unknown field' });
  return { problems, value };
}

/** The whole system must hold together: a minimum range below the maximum. */
function checkWhole(system) {
  return system.minRange !== undefined && system.minRange !== null && system.minRange >= system.maxRange
    ? [{ field: 'minRange', reason: 'must be less than the maximum range' }] : [];
}

const shape = ({ id, revision, name, role, maxRange, minRange, arc }) =>
  deepFreeze({ id, revision, name, role, maxRange, ...(minRange ? { minRange } : {}), arc });

/** @param {{ id: string } & Object} input */
export function createSystem({ id, ...fields }) {
  const { problems, value } = parseSystemFields(fields);
  for (const required of ['name', 'role', 'maxRange']) if (!(required in fields)) problems.push({ field: required, reason: 'is required' });
  if (problems.length) return invalid(problems);
  const system = shape({ id, revision: 1, arc: 360, ...value });
  const whole = checkWhole(system);
  if (whole.length) return invalid(whole);
  return ok({ system, events: [{ type: 'system.created', v: 1, payload: { system } }] });
}

/** Change fields; unchanged values are ignored (no events). */
export function updateSystem(system, changes) {
  const { problems, value } = parseSystemFields(changes);
  if (problems.length) return invalid(problems);
  const changed = FIELDS.filter((f) => f in value && !jsonEqual(value[f] ?? null, system[f] ?? null));
  if (changed.length === 0) return ok({ system, events: [] });
  const next = shape({ ...system, ...Object.fromEntries(changed.map((f) => [f, value[f]])), revision: system.revision + 1 });
  const whole = checkWhole(next);
  if (whole.length) return invalid(whole);
  return ok({ system: next, events: [{ type: 'system.updated', v: 1, payload: { system: next, changed } }] });
}

/** A stored document as a system, or null when it is not a valid one (reading never trusts storage). */
export function readSystem(doc) {
  if (!isObject(doc) || typeof doc.id !== 'string' || !Number.isInteger(doc.revision) || doc.revision < 1) return null;
  const { id, revision, ...fields } = doc;
  const created = createSystem({ id, ...fields });
  return created.ok ? shape({ ...created.value.system, revision }) : null;
}
