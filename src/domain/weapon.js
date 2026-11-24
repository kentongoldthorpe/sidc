// Weapon: a weapon or sensor carried by a unit (D28): { name, role, maxRange (m), minRange? (m),
// arc (degrees; 360 = all round) }. A value, not a reference: it is copied into each unit, so a COA
// or template keeps its ranges wherever it goes. The arc points along the unit's facing.
// Also the rules for a unit's other extras: hvt, facing and details.
import { isObject } from '../shared/values.js';

export const WEAPON_ROLES = Object.freeze(['direct', 'indirect', 'airDefence', 'sensor', 'other']);
export const WEAPON_NAME_MAX = 60;
export const WEAPON_RANGE_MAX = 5_000_000;
export const MAX_UNIT_WEAPONS = 20;
const FIELDS = Object.freeze(['name', 'role', 'maxRange', 'minRange', 'arc']);

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Check whichever weapon fields are present (minRange: null removes it, on updates).
 * @returns {{ problems: object[], value: object }}
 */
export function parseWeaponFields(fields, at = '') {
  const f = (name) => (at ? `${at}.${name}` : name);
  const problems = [];
  const value = {};
  if ('name' in fields) {
    const name = typeof fields.name === 'string' ? fields.name.trim() : '';
    if (name === '') problems.push({ field: f('name'), reason: 'must not be blank' });
    else if (name.length > WEAPON_NAME_MAX) problems.push({ field: f('name'), reason: `must be at most ${WEAPON_NAME_MAX} characters` });
    else value.name = name;
  }
  if ('role' in fields) {
    if (WEAPON_ROLES.includes(fields.role)) value.role = fields.role;
    else problems.push({ field: f('role'), reason: `must be one of ${WEAPON_ROLES.join(', ')}` });
  }
  if ('maxRange' in fields) {
    if (isNumber(fields.maxRange) && fields.maxRange > 0 && fields.maxRange <= WEAPON_RANGE_MAX) value.maxRange = fields.maxRange;
    else problems.push({ field: f('maxRange'), reason: `must be a number of metres, more than 0 and at most ${WEAPON_RANGE_MAX}` });
  }
  if ('minRange' in fields) {
    if (fields.minRange === null) value.minRange = null;
    else if (isNumber(fields.minRange) && fields.minRange >= 0) value.minRange = fields.minRange;
    else problems.push({ field: f('minRange'), reason: 'must be a number of metres, 0 or more (or null for none)' });
  }
  if ('arc' in fields) {
    if (isNumber(fields.arc) && fields.arc > 0 && fields.arc <= 360) value.arc = fields.arc;
    else problems.push({ field: f('arc'), reason: 'must be a number of degrees, more than 0 and at most 360 (360 = all round)' });
  }
  for (const key of Object.keys(fields)) if (!FIELDS.includes(key)) problems.push({ field: f(key), reason: 'unknown field' });
  return { problems, value };
}

/** A minimum range must be below the maximum. */
export function checkWeaponWhole(weapon, at = '') {
  return weapon.minRange !== undefined && weapon.minRange !== null && weapon.minRange >= weapon.maxRange
    ? [{ field: at ? `${at}.minRange` : 'minRange', reason: 'must be less than the maximum range' }] : [];
}

/** The canonical weapon value: { name, role, maxRange, minRange? (only when > 0), arc }. */
export const shapeWeapon = ({ name, role, maxRange, minRange, arc }) => ({ name, role, maxRange, ...(minRange ? { minRange } : {}), arc });

/** One whole weapon (name, role and maxRange required; arc defaults to 360). → { problems, value? } */
export function parseWeapon(raw, at = 'weapon') {
  if (!isObject(raw)) return { problems: [{ field: at, reason: 'must be an object { name, role, maxRange, minRange?, arc? }' }] };
  const { problems, value } = parseWeaponFields(raw, at);
  for (const required of ['name', 'role', 'maxRange']) if (!(required in raw)) problems.push({ field: `${at}.${required}`, reason: 'is required' });
  if (problems.length) return { problems };
  const weapon = shapeWeapon({ arc: 360, ...value });
  const whole = checkWeaponWhole(weapon, at);
  return whole.length ? { problems: whole } : { problems: [], value: weapon };
}

/** A list of weapons (at most MAX_UNIT_WEAPONS). [] means "none". */
export function parseWeapons(raw, at = 'weapons') {
  if (!Array.isArray(raw)) return { problems: [{ field: at, reason: 'must be a list of weapons' }] };
  if (raw.length > MAX_UNIT_WEAPONS) return { problems: [{ field: at, reason: `must have at most ${MAX_UNIT_WEAPONS} weapons` }] };
  const problems = [];
  const value = raw.map((w, i) => { const p = parseWeapon(w, `${at}[${i}]`); problems.push(...p.problems); return p.value; });
  return problems.length ? { problems } : { problems: [], value };
}

// ---- the other unit extras ----

export const DETAILS_LIMITS = Object.freeze({ strength: 50, reference: 200, notes: 1000, equipmentName: 60, equipment: 50 });
const DETAIL_KEYS = Object.freeze(['strength', 'equipment', 'reference', 'notes']);

/** Reference details: { strength?, equipment?: [{ name, count }], reference?, notes? }. {} means "none". */
export function parseDetails(raw, at = 'details') {
  if (!isObject(raw)) return { problems: [{ field: at, reason: 'must be an object { strength?, equipment?, reference?, notes? }' }] };
  const problems = Object.keys(raw).filter((k) => !DETAIL_KEYS.includes(k)).map((k) => ({ field: `${at}.${k}`, reason: 'unknown field' }));
  const value = {};
  for (const key of ['strength', 'reference', 'notes']) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (typeof v !== 'string') problems.push({ field: `${at}.${key}`, reason: 'must be text' });
    else if (v.trim().length > DETAILS_LIMITS[key]) problems.push({ field: `${at}.${key}`, reason: `must be at most ${DETAILS_LIMITS[key]} characters` });
    else if (v.trim() !== '') value[key] = v.trim();
  }
  if ('equipment' in raw) {
    const list = raw.equipment;
    if (!Array.isArray(list) || list.length > DETAILS_LIMITS.equipment) problems.push({ field: `${at}.equipment`, reason: `must be a list of at most ${DETAILS_LIMITS.equipment} items { name, count }` });
    else {
      const items = list.map((item, i) => {
        const where = `${at}.equipment[${i}]`;
        if (!isObject(item)) { problems.push({ field: where, reason: 'must be an object { name, count }' }); return null; }
        const extra = Object.keys(item).filter((k) => k !== 'name' && k !== 'count');
        problems.push(...extra.map((k) => ({ field: `${where}.${k}`, reason: 'unknown field' })));
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (name === '' || name.length > DETAILS_LIMITS.equipmentName) problems.push({ field: `${where}.name`, reason: `must be 1 to ${DETAILS_LIMITS.equipmentName} characters` });
        if (!Number.isInteger(item.count) || item.count < 0 || item.count > 100000) problems.push({ field: `${where}.count`, reason: 'must be a whole number from 0 to 100000' });
        return { name, count: item.count };
      });
      if (items.length) value.equipment = items;
    }
  }
  return problems.length ? { problems } : { problems: [], value };
}

/** Facing: the direction the unit faces (its weapons' arcs point this way), degrees true, 0 to <360. */
export function parseFacing(raw, at = 'facing') {
  if (raw === null) return { problems: [], value: null };
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw < 360
    ? { problems: [], value: raw } : { problems: [{ field: at, reason: 'must be a number of degrees from 0 to less than 360 (or null for none)' }] };
}

export function parseHvt(raw, at = 'hvt') {
  return typeof raw === 'boolean' ? { problems: [], value: raw } : { problems: [{ field: at, reason: 'must be true or false' }] };
}

/** The extras a unit may carry, in canonical order, with their parsers. Empty values mean "not set". */
export const UNIT_EXTRAS = Object.freeze({ facing: parseFacing, hvt: parseHvt, weapons: parseWeapons, details: parseDetails });
export const isEmptyExtra = (v) => v === null || v === false || (Array.isArray(v) && v.length === 0) || (isObject(v) && Object.keys(v).length === 0);

/** A unit with `extras` applied: set values are kept, empty ones remove the field. */
export function withExtras(unit, extras) {
  const next = { ...unit };
  for (const key of Object.keys(UNIT_EXTRAS)) {
    if (!(key in extras)) continue;
    if (isEmptyExtra(extras[key])) delete next[key]; else next[key] = extras[key];
  }
  return next;
}

// ---- a unit's weapon ranges on the map ----

/** The side a unit is on, from its SIDC's standard identity (2525D/E digit 4, or 2525C letter 2). */
export function sideOfSidc(sidc) {
  const s = String(sidc ?? '');
  if (/^\d{20}(\d{10})?$/.test(s)) return { 2: 'friendly', 3: 'friendly', 5: 'hostile', 6: 'hostile', 4: 'neutral' }[s[3]] ?? 'unknown';
  return { F: 'friendly', A: 'friendly', D: 'friendly', M: 'friendly', H: 'hostile', S: 'hostile', J: 'hostile', K: 'hostile', N: 'neutral', L: 'neutral' }[s[1]?.toUpperCase()] ?? 'unknown';
}

/**
 * A map unit's weapons as range-ring and sector graphics (not stored: drawn from the unit, D28).
 * A sector points along the unit's facing (north when it has none). Ids are "<unit id>:weapon:<n>".
 */
export function coverageGraphics(unit) {
  const side = sideOfSidc(unit.sidc);
  return (unit.weapons ?? []).map((w, i) => (w.arc >= 360 && !w.minRange
    ? { id: `${unit.id}:weapon:${i}`, kind: 'rangeRing', side, label: w.name, center: unit.position, radius: w.maxRange, role: w.role }
    : { id: `${unit.id}:weapon:${i}`, kind: 'sector', side, label: w.name, center: unit.position, radius: w.maxRange, ...(w.minRange ? { minRadius: w.minRange } : {}), bearing: unit.facing ?? 0, arc: w.arc, role: w.role }));
}
