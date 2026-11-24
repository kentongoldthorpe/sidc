// COA aggregate. Pure functions: (state, input, { now }) → Result<{ coa, events }>.
// Ids and time are passed in; nothing here does I/O. Events are { type, v, payload },
// ready for the bus's ctx.emit().
import { deepFreeze } from '../shared/freeze.js';
import { isObject } from '../shared/values.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { parseSymbolFields, jsonEqual } from './map-symbol.js';
import { parseFrame } from './frame.js';
import { UNIT_EXTRAS, isEmptyExtra, withExtras } from './weapon.js';
import { parseGraphicFields, parseNewGraphic, shapeOf, EDITABLE_GRAPHIC_FIELDS, checkSectorWhole } from './graphic.js';

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
    symbols: source.symbols.map((symbol, i) => ({ ...unlinked(symbol), id: symbolIds[i] })), // a copy is not linked to a play
    graphics: source.graphics.map((graphic, i) => ({ ...unlinked(graphic), id: graphicIds[i] })),
  });
  return ok({ coa, events: [{ type: 'coa.duplicated', v: 1, payload: { sourceCoaId: source.id, coa } }] });
}

/** The event recorded when a COA is deleted. */
export const coaDeleted = (coaId) => ({ type: 'coa.deleted', v: 1, payload: { coaId } });

// ---- links to a threat play (M10-4a, D30) ----
// A COA placed from a threat play stays linked to it: each placed unit and drawing carries
// `link: { key }` ("unit:<id>", "graphic:<id>" or "move:<unit id>"), and coa.source holds the
// georeference. Rules: moving a linked unit keeps the link and marks it `moved` (fitted to the
// ground; a template update keeps its position); any other edit makes the item the user's own (the
// link goes); deleting a linked item records its key in source.excluded so updates do not bring it back.
export const LINK_KEY_MAX = 200;
/** A link as stored, or problems. @returns {{ problems: object[], value?: object }} */
export function parseLink(raw, at = 'link') {
  if (!isObject(raw) || typeof raw.key !== 'string' || raw.key === '' || raw.key.length > LINK_KEY_MAX) return { problems: [{ field: `${at}.key`, reason: 'must be a non-blank text key' }] };
  const extra = Object.keys(raw).filter((k) => k !== 'key' && k !== 'moved');
  if (extra.length || ('moved' in raw && raw.moved !== true)) return { problems: [{ field: at, reason: 'must be { key, moved?: true }' }] };
  return { problems: [], value: { key: raw.key, ...(raw.moved ? { moved: true } : {}) } };
}
const unlinked = ({ link, ...item }) => item;
const SOURCE_KEYS = Object.freeze(['threatModelId', 'play', 'anchor', 'bearing', 'positions', 'modelRevision', 'excluded']);
const POSITION_OPTIONS = Object.freeze(['start', 'end', 'endWithMoves']);
/** A placed COA's source { threatModelId, play, anchor, bearing, positions, modelRevision?, excluded? }, copied, or null if not valid. */
export function readSource(s) {
  const valid = isObject(s) && typeof s.threatModelId === 'string' && typeof s.play === 'string' && isObject(s.anchor)
    && Number.isFinite(s.anchor.lat) && Number.isFinite(s.anchor.lng) && Number.isFinite(s.bearing) && POSITION_OPTIONS.includes(s.positions)
    && (s.modelRevision === undefined || Number.isInteger(s.modelRevision))
    && (s.excluded === undefined || (Array.isArray(s.excluded) && s.excluded.every((k) => typeof k === 'string')))
    && Object.keys(s).every((k) => SOURCE_KEYS.includes(k));
  if (!valid) return null;
  return {
    threatModelId: s.threatModelId, play: s.play, anchor: { lat: s.anchor.lat, lng: s.anchor.lng }, bearing: s.bearing, positions: s.positions,
    ...(s.modelRevision === undefined ? {} : { modelRevision: s.modelRevision }), ...(s.excluded ? { excluded: [...s.excluded] } : {}),
  };
}
/** The COA with these link keys added to source.excluded (no change when it has no source). */
function excluding(coa, items) {
  const keys = items.filter((x) => x.link).map((x) => x.link.key);
  if (!coa.source || keys.length === 0) return {};
  return { source: { ...coa.source, excluded: [...new Set([...(coa.source.excluded ?? []), ...keys])] } };
}

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

  const symbol = withExtras({ id: symbolId, sidc: value.sidc, position: value.position, label: value.label, modifiers: value.modifiers }, value);
  const updated = touch(coa, { symbols: [...coa.symbols, symbol] }, now);
  return ok({
    coa: updated,
    events: [{ type: 'symbol.added', v: 1, payload: { coaId: coa.id, revision: updated.revision, symbol: updated.symbols.at(-1) } }],
  });
}

/** Fields symbol.update may change, in the order changes are reported. */
const EDITABLE_SYMBOL_FIELDS = Object.freeze(['sidc', 'label', 'modifiers', ...Object.keys(UNIT_EXTRAS)]);
/** An extra's stored value: absent when empty. */
const storedValue = (field, v) => (field in UNIT_EXTRAS && isEmptyExtra(v) ? undefined : v);

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
  const changed = EDITABLE_SYMBOL_FIELDS.filter((f) => f in value && !jsonEqual(storedValue(f, value[f]) ?? null, current[f] ?? null));
  if (changed.length === 0) return ok({ coa, events: [] });

  const plain = changed.filter((f) => !(f in UNIT_EXTRAS));
  const symbol = withExtras({ ...unlinked(current), ...Object.fromEntries(plain.map((f) => [f, value[f]])) }, Object.fromEntries(changed.filter((f) => f in UNIT_EXTRAS).map((f) => [f, value[f]])));
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

  const moved = current.link ? { link: { ...current.link, moved: true } } : {}; // fitted to the ground: kept by template updates
  const updated = touch(coa, { symbols: replaceAt(coa.symbols, found.index, { ...current, position: value.position, ...moved }) }, now);
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
  const updated = touch(coa, { symbols: coa.symbols.filter((_, i) => i !== found.index), ...excluding(coa, [coa.symbols[found.index]]) }, now);
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
    copies.push({ ...unlinked(source), id: symbolIds[i], position: value.position });
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
  const updated = touch(coa, { symbols: coa.symbols.filter((s) => !gone.has(s.id)), ...excluding(coa, coa.symbols.filter((s) => gone.has(s.id))) }, now);
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
  const { problems, value } = parseGraphicFields(changes, shape, { forUpdate: true });
  if ('kind' in value && shapeOf(value.kind) !== shape) problems.push({ field: 'kind', reason: `cannot change the shape: ${current.kind} must stay a ${{ circle: 'range ring', sector: 'sector of fire' }[shape] ?? shape}` });
  if (problems.length) return invalid(problems);

  const changed = EDITABLE_GRAPHIC_FIELDS.filter((f) => f in value && !jsonEqual(value[f], current[f] ?? null));
  if (changed.length === 0) return ok({ coa, events: [] });

  const next = { ...unlinked(current), ...Object.fromEntries(changed.map((f) => [f, value[f]])) };
  if (next.color === null) delete next.color;
  if (next.minRadius === null || next.minRadius === 0) delete next.minRadius;
  const whole = shape === 'sector' ? checkSectorWhole(next) : [];
  if (whole.length) return invalid(whole);
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
  const updated = touch(coa, { graphics: coa.graphics.filter((_, i) => i !== found.index), ...excluding(coa, [coa.graphics[found.index]]) }, now);
  return ok({
    coa: updated,
    events: [{ type: 'graphic.removed', v: 1, payload: { coaId: coa.id, revision: updated.revision, graphicId } }],
  });
}

/** The graphic with this id (for replies), or undefined. */
export const graphicById = (coa, graphicId) => coa.graphics.find((g) => g.id === graphicId);

// ---- restore (undo / redo / undo of delete) ----

const CONTENT_KEYS = Object.freeze(['name', 'description', 'frame', 'symbols', 'graphics']);
export const SYMBOL_KEYS = Object.freeze(['id', 'sidc', 'position', 'label', 'modifiers', ...Object.keys(UNIT_EXTRAS), 'link']);
export const GRAPHIC_KEYS = Object.freeze(['id', 'kind', 'side', 'label', 'color', 'points', 'center', 'radius', 'minRadius', 'bearing', 'arc', 'link']);

/**
 * Check and normalise a COA's content (name, description, frame?, symbols, graphics with ids), as
 * put back by coa.restore. Problems are reported under `content.`.
 * @returns {{ problems: {field: string, reason: string}[], value?: Object }}
 */
export function parseCoaContent(content) {
  const at = 'content';
  if (!isObject(content)) return { problems: [{ field: at, reason: 'must be an object { name, description, frame?, symbols, graphics }' }] };
  const problems = Object.keys(content).filter((k) => !CONTENT_KEYS.includes(k)).map((k) => ({ field: `${at}.${k}`, reason: 'unknown field' }));
  const fields = { name: content.name, description: content.description ?? '', ...(content.frame === undefined ? {} : { frame: content.frame }) };
  problems.push(...checkCoaFields(fields).map((p) => ({ ...p, field: `${at}.${p.field}` })));
  const ids = new Set();
  const checkId = (where, id) => {
    if (typeof id !== 'string' || id.trim() === '' || id.length > 128) problems.push({ field: `${where}.id`, reason: 'must be a non-blank id' });
    else if (ids.has(id)) problems.push({ field: `${where}.id`, reason: 'is used twice' });
    else ids.add(id);
  };
  const list = (key) => {
    if (!Array.isArray(content[key])) { problems.push({ field: `${at}.${key}`, reason: 'must be a list' }); return []; }
    return content[key];
  };
  const symbols = list('symbols').map((raw, i) => {
    const where = `${at}.symbols[${i}]`;
    if (!isObject(raw)) { problems.push({ field: where, reason: 'must be an object' }); return null; }
    problems.push(...Object.keys(raw).filter((k) => !SYMBOL_KEYS.includes(k)).map((k) => ({ field: `${where}.${k}`, reason: 'unknown field' })));
    checkId(where, raw.id);
    const { id, link, ...fields } = raw;
    const parsed = parseSymbolFields({ label: '', modifiers: {}, ...fields });
    problems.push(...parsed.problems.map((p) => ({ ...p, field: `${where}.${p.field}` })));
    const linked = link === undefined ? null : parseLink(link, `${where}.link`);
    if (linked) problems.push(...linked.problems);
    return parsed.problems.length || linked?.problems.length ? null
      : { ...withExtras({ id, sidc: parsed.value.sidc, position: parsed.value.position, label: parsed.value.label, modifiers: parsed.value.modifiers }, parsed.value), ...(linked ? { link: linked.value } : {}) };
  });
  const graphics = list('graphics').map((raw, i) => {
    const where = `${at}.graphics[${i}]`;
    if (!isObject(raw)) { problems.push({ field: where, reason: 'must be an object' }); return null; }
    problems.push(...Object.keys(raw).filter((k) => !GRAPHIC_KEYS.includes(k)).map((k) => ({ field: `${where}.${k}`, reason: 'unknown field' })));
    checkId(where, raw.id);
    const { id, link, ...fields } = raw;
    const parsed = parseNewGraphic(fields);
    problems.push(...parsed.problems.map((p) => ({ ...p, field: `${where}.${p.field}` })));
    const linked = link === undefined ? null : parseLink(link, `${where}.link`);
    if (linked) problems.push(...linked.problems);
    return parsed.problems.length || linked?.problems.length ? null : { id, ...parsed.value, ...(linked ? { link: linked.value } : {}) };
  });
  if (problems.length) return { problems };
  return {
    problems: [],
    value: {
      name: content.name.trim(), description: (content.description ?? '').trim(),
      ...(content.frame === undefined || content.frame === null ? {} : { frame: parseFrame(content.frame).value }),
      symbols, graphics,
    },
  };
}

const contentOf = ({ name, description, frame, symbols, graphics }) => ({ name, description, ...(frame ? { frame } : {}), symbols, graphics });

/**
 * Put back a COA's content as a new revision (ids kept), or recreate a deleted COA (existing = null).
 * Content that is already the same is a no-op.
 * @param {Coa|null} existing @param {{ id: string, content: unknown }} input @param {{ now: string }} context
 */
export function restoreCoa(existing, { id, content }, { now }) {
  const { problems, value } = parseCoaContent(content);
  if (problems.length) return invalid(problems);
  if (existing && jsonEqual(contentOf(existing), value)) return ok({ coa: existing, events: [] });
  const coa = deepFreeze(existing
    ? { id, createdAt: existing.createdAt, updatedAt: now, revision: existing.revision + 1, ...value, ...(existing.source ? { source: existing.source } : {}) }
    : { id, createdAt: now, updatedAt: now, revision: 1, ...value });
  return ok({ coa, events: [{ type: 'coa.restored', v: 1, payload: { coa } }] });
}

/**
 * A new COA made by placing a threat template on the map (Epic 3, T-5): units and graphics already
 * checked and given ids, and `source` linking back to the threat model and play. Publishes coa.placed.
 */
export function createPlacedCoa({ id, name, description, symbols, graphics, source }, { now }) {
  const built = importCoa({ id, name: name.slice(0, NAME_MAX).trim(), description: description.slice(0, DESCRIPTION_MAX).trim(), symbols, graphics }, { now });
  if (!built.ok) return built;
  const coa = deepFreeze({ ...built.value.coa, source });
  return ok({ coa, events: [{ type: 'coa.placed', v: 1, payload: { coa } }] });
}

/**
 * A linked COA after a template update or a new georeference (M10-4a): new symbols, graphics and
 * source in one revision. Publishes coa.synced { coa, added, removed }.
 */
export function syncPlacedCoa(coa, { symbols, graphics, source, added = 0, removed = 0 }, { now }) {
  const updated = touch(coa, { symbols, graphics, source }, now);
  return ok({ coa: updated, events: [{ type: 'coa.synced', v: 1, payload: { coa: updated, added, removed } }] });
}

/** A linked unit put back at its template position (`position`): no longer marked moved. Publishes symbol.moved. */
export function snapSymbol(coa, { symbolId, position }, { now }) {
  const found = findSymbol(coa, symbolId);
  if (found.error) return found.error;
  const current = coa.symbols[found.index];
  const { moved, ...link } = current.link;
  const updated = touch(coa, { symbols: replaceAt(coa.symbols, found.index, { ...current, position, link }) }, now);
  return ok({ coa: updated, events: [{ type: 'symbol.moved', v: 1, payload: { coaId: coa.id, revision: updated.revision, symbolId, from: current.position, to: position } }] });
}
