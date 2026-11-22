// COA aggregate. Pure functions: (state, input, { now }) → Result<{ coa, events }>.
// Ids and time are passed in; nothing here does I/O. Events are { type, v, payload },
// ready for the bus's ctx.emit().
import { deepFreeze } from '../shared/freeze.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { parseSymbolFields, jsonEqual } from './map-symbol.js';

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

  const updated = touch(coa, next, now);
  return ok({ coa: updated, events: [{ type: 'coa.updated', v: 1, payload: { coa: updated, changed } }] });
}

const COPY_SUFFIX = ' (copy)';

/** "<name> (copy)", shortening the name so the result still fits NAME_MAX. */
const defaultCopyName = (name) => `${name.slice(0, NAME_MAX - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;

/**
 * A new COA with the source's description and symbols (in order, with fresh ids).
 * @param {Coa} source
 * @param {{ id: string, name?: unknown, symbolIds: string[] }} input  one fresh id per source symbol
 * @param {{ now: string }} context
 */
export function duplicateCoa(source, { id, name, symbolIds }, { now }) {
  const copyName = name === undefined ? defaultCopyName(source.name) : name;
  const problems = checkCoaFields({ name: copyName });
  if (problems.length) return invalid(problems);

  const coa = deepFreeze({
    id, name: copyName.trim(), description: source.description,
    createdAt: now, updatedAt: now, revision: 1,
    symbols: source.symbols.map((symbol, i) => ({ ...symbol, id: symbolIds[i] })),
  });
  return ok({ coa, events: [{ type: 'coa.duplicated', v: 1, payload: { sourceCoaId: source.id, coa } }] });
}

/** The event recorded when a COA is deleted. */
export const coaDeleted = (coaId) => ({ type: 'coa.deleted', v: 1, payload: { coaId } });

/** The revision bump every change to a COA's content makes. */
const touch = (coa, changes, now) => deepFreeze({ ...coa, ...changes, revision: coa.revision + 1, updatedAt: now });

/**
 * Append a symbol. label defaults to '' and modifiers to {}.
 * @param {Coa} coa
 * @param {{ symbolId: string, sidc: unknown, position: unknown, label?: unknown, modifiers?: unknown }} input
 * @param {{ now: string }} context
 */
export function addSymbol(coa, { symbolId, label = '', modifiers = {}, ...rest }, { now }) {
  const { problems, value } = parseSymbolFields({ ...rest, label, modifiers });
  if (problems.length) return invalid(problems);

  const symbol = { id: symbolId, sidc: value.sidc, position: value.position, label: value.label, modifiers: value.modifiers };
  const updated = touch(coa, { symbols: [...coa.symbols, symbol] }, now);
  return ok({
    coa: updated,
    events: [{ type: 'symbol.added', v: 1, payload: { coaId: coa.id, revision: updated.revision, symbol: updated.symbols.at(-1) } }],
  });
}

/** Fields symbol.update may change, in the order changes are reported. */
const EDITABLE_SYMBOL_FIELDS = Object.freeze(['sidc', 'label', 'modifiers']);

/** @returns {{ index: number } | { error: import('../shared/result.js').Result<never> }} */
function findSymbol(coa, symbolId) {
  const index = coa.symbols.findIndex((s) => s.id === symbolId);
  return index === -1
    ? { error: err(ErrorCode.NOT_FOUND, `Symbol ${symbolId} not found in COA ${coa.id}`, { coaId: coa.id, symbolId }) }
    : { index };
}

const replaceAt = (list, index, item) => list.map((existing, i) => (i === index ? item : existing));

/**
 * Change sidc, label and/or modifiers of one symbol (modifiers are replaced as a whole).
 * Unchanged values (after normalising) are ignored; if nothing changes, no events.
 */
export function updateSymbol(coa, { symbolId, ...changes }, { now }) {
  const found = findSymbol(coa, symbolId);
  if (found.error) return found.error;
  const { problems, value } = parseSymbolFields(changes);
  if (problems.length) return invalid(problems);

  const current = coa.symbols[found.index];
  const changed = EDITABLE_SYMBOL_FIELDS.filter((f) => f in value && !jsonEqual(value[f], current[f]));
  if (changed.length === 0) return ok({ coa, events: [] });

  const symbol = { ...current, ...Object.fromEntries(changed.map((f) => [f, value[f]])) };
  const updated = touch(coa, { symbols: replaceAt(coa.symbols, found.index, symbol) }, now);
  return ok({
    coa: updated,
    events: [{ type: 'symbol.updated', v: 1, payload: { coaId: coa.id, revision: updated.revision, symbol: updated.symbols[found.index], changed } }],
  });
}

/** Move one symbol. No events when the (normalised) position is unchanged. */
export function moveSymbol(coa, { symbolId, position }, { now }) {
  const found = findSymbol(coa, symbolId);
  if (found.error) return found.error;
  const { problems, value } = parseSymbolFields({ position });
  if (problems.length) return invalid(problems);

  const current = coa.symbols[found.index];
  if (jsonEqual(value.position, current.position)) return ok({ coa, events: [] });

  const updated = touch(coa, { symbols: replaceAt(coa.symbols, found.index, { ...current, position: value.position }) }, now);
  return ok({
    coa: updated,
    events: [{ type: 'symbol.moved', v: 1, payload: {
      coaId: coa.id, revision: updated.revision, symbolId, from: current.position, to: value.position,
    } }],
  });
}

/** Remove one symbol; the others keep their order. */
export function removeSymbol(coa, { symbolId }, { now }) {
  const found = findSymbol(coa, symbolId);
  if (found.error) return found.error;
  const updated = touch(coa, { symbols: coa.symbols.filter((_, i) => i !== found.index) }, now);
  return ok({
    coa: updated,
    events: [{ type: 'symbol.removed', v: 1, payload: { coaId: coa.id, revision: updated.revision, symbolId } }],
  });
}
