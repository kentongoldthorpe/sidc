// System: a weapon or sensor in the user's systems list (decision D22), reused by threat models.
//   { id, revision, name, role, maxRange (m), minRange? (m), arc (degrees; 360 = all round) }
// Nothing is built in: the user enters the systems and their numbers.
import { deepFreeze } from '../shared/freeze.js';
import { isObject } from '../shared/values.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { jsonEqual } from './map-symbol.js';
import { WEAPON_ROLES, WEAPON_NAME_MAX, WEAPON_RANGE_MAX, parseWeaponFields, checkWeaponWhole } from './weapon.js';

export const SYSTEM_ROLES = WEAPON_ROLES;
export const SYSTEM_NAME_MAX = WEAPON_NAME_MAX;
export const SYSTEM_RANGE_MAX = WEAPON_RANGE_MAX;
const FIELDS = Object.freeze(['name', 'role', 'maxRange', 'minRange', 'arc']);

const invalid = (problems) => err(ErrorCode.VALIDATION_FAILED, 'The system is not valid', { problems });

/** A system's fields are a weapon's (see weapon.js). */
export const parseSystemFields = (fields) => parseWeaponFields(fields);
const checkWhole = (system) => checkWeaponWhole(system);

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
