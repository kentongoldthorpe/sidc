// COA aggregate. Pure functions: (state, input, { now }) → Result<{ coa, events }>.
// Ids and time are passed in; nothing here does I/O. Events are { type, v, payload },
// ready for the bus's ctx.emit().
import { deepFreeze } from '../shared/freeze.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;

/**
 * @typedef {{ lat: number, lng: number }} LatLng
 * @typedef {{ id: string, sidc: string, position: LatLng, label: string, modifiers: Object }} MapSymbol
 * @typedef {{ id: string, name: string, description: string, createdAt: string, updatedAt: string,
 *             revision: number, symbols: MapSymbol[] }} Coa
 */

/** Editable text fields, in the order changes are reported. */
const TEXT_FIELDS = Object.freeze({
  name: { max: NAME_MAX, required: true },
  description: { max: DESCRIPTION_MAX, required: false },
});

function checkText(field, value, { max, required }) {
  if (typeof value !== 'string') return [{ field, reason: 'must be a string' }];
  const text = value.trim();
  if (required && text === '') return [{ field, reason: 'must not be blank' }];
  if (text.length > max) return [{ field, reason: `must be at most ${max} characters` }];
  return [];
}

/**
 * Problems with whichever COA text fields are present in `fields`.
 * Exported so handlers can report every payload problem at once, before any lookup.
 * @returns {{field:string, reason:string}[]}
 */
export const checkCoaFields = (fields) =>
  Object.entries(TEXT_FIELDS).filter(([f]) => f in fields).flatMap(([f, rule]) => checkText(f, fields[f], rule));

const invalid = (problems) => err(ErrorCode.VALIDATION_FAILED, 'The COA is not valid', { problems });

/**
 * @param {{ id: string, name: unknown, description?: unknown }} input
 * @param {{ now: string }} context
 */
export function createCoa({ id, name, description = '' }, { now }) {
  const problems = checkCoaFields({ name, description });
  if (problems.length) return invalid(problems);

  const coa = deepFreeze({
    id, name: name.trim(), description: description.trim(),
    createdAt: now, updatedAt: now, revision: 1, symbols: [],
  });
  return ok({ coa, events: [{ type: 'coa.created', v: 1, payload: { coa } }] });
}

/**
 * Change name and/or description. Fields whose trimmed value is unchanged are ignored;
 * if nothing changes the same COA is returned with no events.
 * @param {Coa} coa @param {{ name?: unknown, description?: unknown }} changes @param {{ now: string }} context
 */
export function updateCoa(coa, changes, { now }) {
  const problems = checkCoaFields(changes);
  if (problems.length) return invalid(problems);

  const next = {};
  for (const field of Object.keys(TEXT_FIELDS)) {
    if (field in changes && changes[field].trim() !== coa[field]) next[field] = changes[field].trim();
  }
  const changed = Object.keys(next);
  if (changed.length === 0) return ok({ coa, events: [] });

  const updated = deepFreeze({ ...coa, ...next, revision: coa.revision + 1, updatedAt: now });
  return ok({ coa: updated, events: [{ type: 'coa.updated', v: 1, payload: { coa: updated, changed } }] });
}
