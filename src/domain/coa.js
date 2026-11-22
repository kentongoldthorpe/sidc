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

const isString = (v) => typeof v === 'string';

function checkText(field, value, { max, required }) {
  if (!isString(value)) return [{ field, reason: 'must be a string' }];
  const text = value.trim();
  if (required && text === '') return [{ field, reason: 'must not be blank' }];
  if (text.length > max) return [{ field, reason: `must be at most ${max} characters` }];
  return [];
}

const invalid = (problems) => err(ErrorCode.VALIDATION_FAILED, 'The COA is not valid', { problems });

/**
 * @param {{ id: string, name: unknown, description?: unknown }} input
 * @param {{ now: string }} context
 */
export function createCoa({ id, name, description = '' }, { now }) {
  const problems = [
    ...checkText('name', name, { max: NAME_MAX, required: true }),
    ...checkText('description', description, { max: DESCRIPTION_MAX, required: false }),
  ];
  if (problems.length) return invalid(problems);

  const coa = deepFreeze({
    id, name: name.trim(), description: description.trim(),
    createdAt: now, updatedAt: now, revision: 1, symbols: [],
  });
  return ok({ coa, events: [{ type: 'coa.created', v: 1, payload: { coa } }] });
}
