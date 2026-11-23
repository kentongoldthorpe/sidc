// COA aggregate. Pure functions: (state, input, { now }) → Result<{ coa, events }>.
// Ids and time are passed in; nothing here does I/O. Events are { type, v, payload },
// ready for the bus's ctx.emit().
import { deepFreeze } from '../shared/freeze.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { parseSymbolFields, jsonEqual } from './map-symbol.js';
import { parseFrame } from './frame.js';
import { parseGraphicFields, parseNewGraphic, shapeOf, EDITABLE_GRAPHIC_FIELDS } from './graphic.js';

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;

/**
 * @typedef {{ lat: number, lng: number }} LatLng
 * @typedef {{ id: string, sidc: string, position: LatLng, label: string, modifiers: Object }} MapSymbol
 * @typedef {{ id: string, kind: string, side: string, label: string, color?: string,
 *             points?: LatLng[], center?: LatLng, radius?: number }} Graphic   (see graphic.js)
 * @typedef {{ id: string, name: string, description: string, createdAt: string, updatedAt: string,
 *             revision: number, frame?: Object, symbols: MapSymbol[], graphics: Graphic[] }} Coa
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
export const checkCoaFields = (fields) => [
  ...Object.entries(TEXT_FIELDS).filter(([f]) => f in fields).flatMap(([f, rule]) => checkText(f, fields[f], rule)),
  ...('frame' in fields && fields.frame !== null ? parseFrame(fields.frame).problems ?? [] : []),
];

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
    createdAt: now, updatedAt: now, revision: 1, symbols: [], graphics: [],
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
  // The COA's own export frame (absent = use the shared frame); null removes it.
  let frameChanged = false;
  let frame = coa.frame;
  if ('frame' in changes) {
    const value = changes.frame === null ? undefined : parseFrame(changes.frame).value;
    if (!jsonEqual(value ?? null, coa.frame ?? null)) { frameChanged = true; frame = value; }
  }
  const changed = [...Object.keys(next), ...(frameChanged ? ['frame'] : [])];
  if (changed.length === 0) return ok({ coa, events: [] });

  const { frame: _old, ...rest } = coa;
  const updated = touch(frame === undefined ? rest : { ...rest, frame }, next, now);
  return ok({ coa: updated, events: [{ type: 'coa.updated', v: 1, payload: { coa: updated, changed } }] });
}

const COPY_SUFFIX = ' (copy)';

/** "<name> (copy)", shortening the name so the result still fits NAME_MAX. */
const defaultCopyName = (name) => `${name.slice(0, NAME_MAX - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;

/**
 * A new COA with the source's description and symbols (in order, with fresh ids).
 * @param {Coa} source
 * @param {{ id: string, name?: unknown, symbolIds: string[], graphicIds?: string[] }} input  one fresh id per source symbol/graphic
 * @param {{ now: string }} context
 */
export function duplicateCoa(source, { id, name, symbolIds, graphicIds = [] }, { now }) {
  const copyName = name === undefined ? defaultCopyName(source.name) : name;
  const problems = checkCoaFields({ name: copyName });
  if (problems.length) return invalid(problems);

  const coa = deepFreeze({
    id, name: copyName.trim(), description: source.description,
    createdAt: now, updatedAt: now, revision: 1,
    ...(source.frame ? { frame: source.frame } : {}),
    symbols: source.symbols.map((symbol, i) => ({ ...symbol, id: symbolIds[i] })),
    graphics: (source.graphics ?? []).map((graphic, i) => ({ ...graphic, id: graphicIds[i] })),
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

const MAX_OFFSET = 180;
const round9 = (n) => Math.round(n * 1e9) / 1e9; // keep sums like 10 + -0.01 exact (9.99)

/** Problems with a copy offset { lat, lng } in degrees. */
export function checkOffset(offset, field = 'offset') {
  if (offset === null || typeof offset !== 'object' || Array.isArray(offset)) return [{ field, reason: 'must be an object { lat, lng }' }];
  const problems = [];
  for (const key of ['lat', 'lng']) {
    const v = offset[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_OFFSET) problems.push({ field: `${field}.${key}`, reason: `must be a number from -${MAX_OFFSET} to ${MAX_OFFSET}` });
  }
  for (const key of Object.keys(offset)) if (key !== 'lat' && key !== 'lng') problems.push({ field: `${field}.${key}`, reason: 'unknown field' });
  return problems;
}

/**
 * Append copies of `sources` (symbols, possibly from another COA) with fresh ids, moved by `offset`.
 * One revision; one symbol.added event per copy.
 * @param {Coa} coa @param {{ sources: MapSymbol[], symbolIds: string[], offset?: {lat:number, lng:number} }} input
 */
export function copySymbols(coa, { sources, symbolIds, offset = { lat: 0, lng: 0 } }, { now }) {
  const copies = [];
  for (const [i, source] of sources.entries()) {
    const { problems, value } = parseSymbolFields({
      position: { lat: round9(source.position.lat + offset.lat), lng: round9(source.position.lng + offset.lng) },
    });
    if (problems.length) return invalid([{ field: 'offset.lat', reason: 'would move a copy beyond latitude -90..90' }]);
    copies.push({ ...source, id: symbolIds[i], position: value.position });
  }
  const updated = touch(coa, { symbols: [...coa.symbols, ...copies] }, now);
  const added = updated.symbols.slice(coa.symbols.length);
  return ok({
    coa: updated,
    events: added.map((symbol) => ({ type: 'symbol.added', v: 1, payload: { coaId: coa.id, revision: updated.revision, symbol } })),
  });
}

/** Remove several symbols at once (all or nothing). One symbol.removed event per symbol. */
export function removeSymbols(coa, { symbolIds }, { now }) {
  for (const symbolId of symbolIds) {
    const found = findSymbol(coa, symbolId);
    if (found.error) return found.error;
  }
  const gone = new Set(symbolIds);
  const updated = touch(coa, { symbols: coa.symbols.filter((s) => !gone.has(s.id)) }, now);
  return ok({
    coa: updated,
    events: symbolIds.map((symbolId) => ({ type: 'symbol.removed', v: 1, payload: { coaId: coa.id, revision: updated.revision, symbolId } })),
  });
}

/** The symbols with the given ids, in that order, or NOT_FOUND for the first missing one. */
export function pickSymbols(coa, symbolIds) {
  const picked = [];
  for (const symbolId of symbolIds) {
    const found = findSymbol(coa, symbolId);
    if (found.error) return found.error;
    picked.push(coa.symbols[found.index]);
  }
  return ok(picked);
}

/**
 * A new COA built in one step from imported data (symbols already parsed and given ids).
 * @param {{ id: string, name: unknown, description?: unknown, frame?: unknown, symbols: MapSymbol[] }} input
 */
export function importCoa({ id, name, description = '', frame, symbols, graphics = [] }, { now }) {
  const problems = checkCoaFields({ name, description, ...(frame === undefined ? {} : { frame }) });
  if (problems.length) return invalid(problems);
  const coa = deepFreeze({
    id, name: name.trim(), description: description.trim(), createdAt: now, updatedAt: now, revision: 1,
    ...(frame === undefined || frame === null ? {} : { frame: parseFrame(frame).value }),
    symbols: symbols.map((s) => ({ ...s })),
    graphics: graphics.map((g) => ({ ...g })),
  });
  return ok({ coa, events: [{ type: 'coa.imported', v: 1, payload: { coa } }] });
}

// ---- graphics (lines, areas, range rings) ----

/** @returns {{ index: number } | { error: import('../shared/result.js').Result<never> }} */
function findGraphic(coa, graphicId) {
  const index = coa.graphics.findIndex((g) => g.id === graphicId);
  return index === -1
    ? { error: err(ErrorCode.NOT_FOUND, `Graphic ${graphicId} not found in COA ${coa.id}`, { coaId: coa.id, graphicId }) }
    : { index };
}

/** Append a graphic (see graphic.js for the fields). */
export function addGraphic(coa, { graphicId, ...fields }, { now }) {
  const { problems, value } = parseNewGraphic(fields);
  if (problems.length) return invalid(problems);
  const updated = touch(coa, { graphics: [...coa.graphics, { id: graphicId, ...value }] }, now);
  return ok({
    coa: updated,
    events: [{ type: 'graphic.added', v: 1, payload: { coaId: coa.id, revision: updated.revision, graphic: updated.graphics.at(-1) } }],
  });
}

/**
 * Change any of kind (within its shape), side, color (null: back to the side colour), label and
 * geometry. Unchanged values are ignored; if nothing changes, no events.
 */
export function updateGraphic(coa, { graphicId, ...changes }, { now }) {
  const found = findGraphic(coa, graphicId);
  if (found.error) return found.error;
  const current = coa.graphics[found.index];
  const shape = shapeOf(current.kind);
  const { problems, value } = parseGraphicFields(changes, shape, { allowNullColor: true });
  if ('kind' in value && shapeOf(value.kind) !== shape) problems.push({ field: 'kind', reason: `cannot change the shape: ${current.kind} must stay a ${shape === 'circle' ? 'range ring' : shape}` });
  if (problems.length) return invalid(problems);

  const changed = EDITABLE_GRAPHIC_FIELDS.filter((f) => f in value && !jsonEqual(value[f], current[f] ?? null));
  if (changed.length === 0) return ok({ coa, events: [] });

  const next = { ...current, ...Object.fromEntries(changed.map((f) => [f, value[f]])) };
  if (next.color === null) delete next.color;
  const updated = touch(coa, { graphics: replaceAt(coa.graphics, found.index, next) }, now);
  return ok({
    coa: updated,
    events: [{ type: 'graphic.updated', v: 1, payload: { coaId: coa.id, revision: updated.revision, graphic: updated.graphics[found.index], changed } }],
  });
}

/** Remove one graphic; the others keep their order. */
export function removeGraphic(coa, { graphicId }, { now }) {
  const found = findGraphic(coa, graphicId);
  if (found.error) return found.error;
  const updated = touch(coa, { graphics: coa.graphics.filter((_, i) => i !== found.index) }, now);
  return ok({
    coa: updated,
    events: [{ type: 'graphic.removed', v: 1, payload: { coaId: coa.id, revision: updated.revision, graphicId } }],
  });
}

/** The graphic with this id (for replies), or undefined. */
export const graphicById = (coa, graphicId) => coa.graphics.find((g) => g.id === graphicId);
