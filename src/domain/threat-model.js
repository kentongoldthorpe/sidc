// Threat model (Epic 3, IPB step 3): a threat's doctrinal template, drawn to scale without terrain.
//
//   ThreatModel { id, revision, name, description, createdAt, updatedAt, formation: Template, coas: [] }
//   Template    { units: TemplateUnit[], graphics: TemplateGraphic[] }
//   TemplateUnit    { id, sidc, label, x, y, facing, systems: systemId[], hvt, end?: { x, y } }
//   TemplateGraphic { id, kind, side, label, color?, points: {x,y}[] | center: {x,y}, radius }
//
// Template space is metres: (0, 0) is the reference point and +y is the direction of attack, so a
// template keeps real distances (frontage, depth, weapon ranges) until it is placed on the map.
// `end` is where a unit finishes in a threat COA's play (D26); the formation itself ignores it.
import { deepFreeze } from '../shared/freeze.js';
import { isObject } from '../shared/values.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { parseSidc } from './sidc.js';
import { jsonEqual, LABEL_MAX } from './map-symbol.js';
import { GRAPHIC_KINDS, SIDES, GRAPHIC_LABEL_MAX, MAX_POINTS, MAX_RADIUS, shapeOf } from './graphic.js';
import { NAME_MAX } from './coa.js';
import { parseWeapons, parseDetails, shapeWeapon, MAX_UNIT_WEAPONS } from './weapon.js';

export const MODEL_DESCRIPTION_MAX = 4000;
export const TEMPLATE_EXTENT = 200_000; // metres from the reference point
export const MAX_TEMPLATE_UNITS = 500;
export const MAX_TEMPLATE_GRAPHICS = 500;
export const MAX_UNIT_SYSTEMS = MAX_UNIT_WEAPONS;

export const TEMPLATE_UNIT_KEYS = Object.freeze(['id', 'sidc', 'label', 'x', 'y', 'facing', 'weapons', 'systems', 'hvt', 'details', 'end']);
const GRAPHIC_KEYS = Object.freeze(['id', 'kind', 'side', 'label', 'color', 'points', 'center', 'radius']);
const MIN_POINTS = Object.freeze({ line: 2, area: 3 });
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const invalid = (problems) => err(ErrorCode.VALIDATION_FAILED, 'The threat model is not valid', { problems });

function checkText(field, value, max, required) {
  if (typeof value !== 'string') return [{ field, reason: 'must be a string' }];
  if (required && value.trim() === '') return [{ field, reason: 'must not be blank' }];
  if (value.trim().length > max) return [{ field, reason: `must be at most ${max} characters` }];
  return [];
}
/** Problems with whichever of name / description are present. */
export const checkModelFields = (fields) => [
  ...('name' in fields ? checkText('name', fields.name, NAME_MAX, true) : []),
  ...('description' in fields ? checkText('description', fields.description, MODEL_DESCRIPTION_MAX, false) : []),
];

/** A template point { x, y } in metres. @returns {{ problems } | { value }} */
function parsePoint(raw, field) {
  if (!isObject(raw)) return { problems: [{ field, reason: 'must be an object { x, y } in metres' }] };
  const problems = [];
  for (const axis of ['x', 'y']) {
    if (!isNumber(raw[axis]) || Math.abs(raw[axis]) > TEMPLATE_EXTENT) problems.push({ field: `${field}.${axis}`, reason: `must be a number of metres within ${TEMPLATE_EXTENT} of the reference point` });
  }
  for (const key of Object.keys(raw)) if (key !== 'x' && key !== 'y') problems.push({ field: `${field}.${key}`, reason: 'unknown field' });
  return problems.length ? { problems } : { value: { x: raw.x, y: raw.y } };
}

/**
 * Check a template. Items without an id get one from `newId`.
 * @param {unknown} raw
 * @param {{ newId: (prefix: string) => string, knownSidc?: (sidc: string) => boolean, systemsById?: Map<string, object>|null, field?: string }} context
 *   A unit carries its own `weapons` (D28). `systems` (ids in the systems list, how templates were
 *   kept before M10-3) is still read: each system found in `systemsById` is copied in as a weapon,
 *   and the ids are not kept. Without `systemsById` they are dropped. checkSystems: refuse unknown ids
 *   (a command), rather than drop them (reading storage, where a system may have been deleted).
 * @returns {{ problems: object[], value?: { units: object[], graphics: object[] } }}
 */
export function parseTemplate(raw, { newId, knownSidc = () => true, systemsById = null, checkSystems = false, field = 'template' }) {
  if (!isObject(raw)) return { problems: [{ field, reason: 'must be an object { units, graphics }' }] };
  const problems = [];
  for (const key of Object.keys(raw)) if (key !== 'units' && key !== 'graphics') problems.push({ field: `${field}.${key}`, reason: 'unknown field' });
  const list = (key, max) => {
    if (!Array.isArray(raw[key]) || raw[key].length > max) { problems.push({ field: `${field}.${key}`, reason: `must be a list of at most ${max}` }); return []; }
    return raw[key];
  };
  const ids = new Set();
  const takeId = (at, id, prefix) => {
    if (id === undefined) return newId(prefix);
    if (typeof id !== 'string' || id.trim() === '' || id.length > 128) { problems.push({ field: `${at}.id`, reason: 'must be a non-blank id' }); return null; }
    if (ids.has(id)) { problems.push({ field: `${at}.id`, reason: 'is used twice' }); return null; }
    ids.add(id);
    return id;
  };

  const units = list('units', MAX_TEMPLATE_UNITS).map((u, i) => {
    const at = `${field}.units[${i}]`;
    if (!isObject(u)) { problems.push({ field: at, reason: 'must be an object' }); return null; }
    const before = problems.length;
    for (const key of Object.keys(u)) if (!TEMPLATE_UNIT_KEYS.includes(key)) problems.push({ field: `${at}.${key}`, reason: 'unknown field' });
    const id = takeId(at, u.id, 'tu');
    const sidc = parseSidc(u.sidc, `${at}.sidc`);
    if (sidc.problems) problems.push(...sidc.problems);
    else if (!knownSidc(sidc.value)) problems.push({ field: `${at}.sidc`, reason: 'is not a recognised symbol' });
    problems.push(...checkText(`${at}.label`, u.label ?? '', LABEL_MAX, false));
    const position = parsePoint({ x: u.x, y: u.y }, at);
    if (position.problems) problems.push(...position.problems);
    const facing = u.facing ?? 0;
    if (!isNumber(facing) || facing < 0 || facing >= 360) problems.push({ field: `${at}.facing`, reason: 'must be degrees from 0 to less than 360 (0 = the direction of attack)' });
    const weapons = parseWeapons(u.weapons ?? [], `${at}.weapons`);
    problems.push(...weapons.problems);
    const systems = u.systems ?? [];
    if (!Array.isArray(systems) || systems.some((id) => typeof id !== 'string')) problems.push({ field: `${at}.systems`, reason: 'must be a list of system ids' });
    else if (checkSystems) systems.forEach((id, j) => { if (!systemsById?.has(id)) problems.push({ field: `${at}.systems[${j}]`, reason: 'is not a system in the systems list' }); });
    const fromSystems = Array.isArray(systems) && systemsById ? systems.map((id) => systemsById.get(id)).filter(Boolean).map(shapeWeapon) : [];
    const details = parseDetails(u.details ?? {}, `${at}.details`);
    problems.push(...details.problems);
    if ('hvt' in u && typeof u.hvt !== 'boolean') problems.push({ field: `${at}.hvt`, reason: 'must be true or false' });
    const end = u.end === undefined ? null : parsePoint(u.end, `${at}.end`);
    if (end?.problems) problems.push(...end.problems);
    if (problems.length > before) return null;
    return {
      id, sidc: sidc.value, label: (u.label ?? '').trim(), x: u.x, y: u.y, facing, weapons: [...weapons.value, ...fromSystems].slice(0, MAX_UNIT_WEAPONS), hvt: u.hvt ?? false,
      ...(Object.keys(details.value).length ? { details: details.value } : {}),
      ...(end ? { end: end.value } : {}),
    };
  });

  const graphics = list('graphics', MAX_TEMPLATE_GRAPHICS).map((g, i) => {
    const at = `${field}.graphics[${i}]`;
    if (!isObject(g)) { problems.push({ field: at, reason: 'must be an object' }); return null; }
    const before = problems.length;
    if (shapeOf(g.kind) === 'sector') { problems.push({ field: `${at}.kind`, reason: 'fields of fire in a template come from the units\' weapons (give the unit a weapon with an arc)' }); return null; }
    for (const key of Object.keys(g)) if (!GRAPHIC_KEYS.includes(key)) problems.push({ field: `${at}.${key}`, reason: 'unknown field' });
    const id = takeId(at, g.id, 'tg');
    const shape = shapeOf(g.kind);
    if (!shape) { problems.push({ field: `${at}.kind`, reason: `must be one of ${Object.keys(GRAPHIC_KINDS).join(', ')}` }); return null; }
    const side = g.side ?? 'hostile'; // a threat model's graphics are the threat's
    if (!SIDES.includes(side)) problems.push({ field: `${at}.side`, reason: `must be one of ${SIDES.join(', ')}` });
    if ('color' in g && !(typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color))) problems.push({ field: `${at}.color`, reason: 'must be a colour like #1f4fbf' });
    problems.push(...checkText(`${at}.label`, g.label ?? '', GRAPHIC_LABEL_MAX, false));
    let geometry = null;
    if (shape === 'circle') {
      for (const key of ['points']) if (key in g) problems.push({ field: `${at}.${key}`, reason: 'is not used by a range ring' });
      const center = 'center' in g ? parsePoint(g.center, `${at}.center`) : { problems: [{ field: `${at}.center`, reason: 'is required' }] };
      if (center.problems) problems.push(...center.problems);
      if (!(isNumber(g.radius) && g.radius > 0 && g.radius <= MAX_RADIUS)) problems.push({ field: `${at}.radius`, reason: `must be a number of metres, more than 0 and at most ${MAX_RADIUS}` });
      geometry = center.value ? { center: center.value, radius: g.radius } : null;
    } else {
      for (const key of ['center', 'radius']) if (key in g) problems.push({ field: `${at}.${key}`, reason: `is not used by a${shape === 'area' ? 'n area' : ' line'}` });
      if (!Array.isArray(g.points) || g.points.length < MIN_POINTS[shape] || g.points.length > MAX_POINTS) {
        problems.push({ field: `${at}.points`, reason: `must have ${MIN_POINTS[shape]} to ${MAX_POINTS} points` });
      } else {
        const points = g.points.map((p, j) => parsePoint(p, `${at}.points[${j}]`));
        points.forEach((p) => { if (p.problems) problems.push(...p.problems); });
        geometry = { points: points.map((p) => p.value) };
      }
    }
    if (problems.length > before) return null;
    return { id, kind: g.kind, side, label: (g.label ?? '').trim(), ...(g.color ? { color: g.color.toLowerCase() } : {}), ...geometry };
  });

  return problems.length ? { problems } : { problems: [], value: { units, graphics } };
}

const touch = (model, changes, now) => deepFreeze({ ...model, ...changes, revision: model.revision + 1, updatedAt: now });

export function createThreatModel({ id, name, description = '' }, { now }) {
  const problems = checkModelFields({ name, description });
  if (problems.length) return invalid(problems);
  const model = deepFreeze({
    id, revision: 1, name: name.trim(), description: description.trim(), createdAt: now, updatedAt: now,
    formation: { units: [], graphics: [] }, coas: [],
  });
  return ok({ model, events: [{ type: 'threat-model.created', v: 1, payload: { model } }] });
}

/** Rename / re-describe; unchanged values are ignored (no events). */
export function updateThreatModel(model, changes, { now }) {
  const problems = checkModelFields(changes);
  if (problems.length) return invalid(problems);
  const next = {};
  for (const field of ['name', 'description']) if (field in changes && changes[field].trim() !== model[field]) next[field] = changes[field].trim();
  const changed = Object.keys(next);
  if (changed.length === 0) return ok({ model, events: [] });
  const updated = touch(model, next, now);
  return ok({ model: updated, events: [{ type: 'threat-model.updated', v: 1, payload: { model: updated, changed } }] });
}

/**
 * Replace the formation (target "formation") or a threat COA's play (target: its id).
 * @param {{ target: string, template: unknown }} input
 * @param {{ now: string, newId: Function, knownSidc: Function, systemsById?: Map<string, object> }} context
 */
export function setTemplate(model, { target, template }, { now, newId, knownSidc, systemsById = null }) {
  const index = target === 'formation' ? -1 : model.coas.findIndex((c) => c.id === target);
  if (target !== 'formation' && index === -1) return coaNotFound(model, target);
  const parsed = parseTemplate(template, { newId, knownSidc, systemsById, checkSystems: true });
  if (parsed.problems.length) return invalid(parsed.problems);
  const current = index === -1 ? model.formation : model.coas[index].template;
  if (jsonEqual(parsed.value, current)) return ok({ model, events: [] });
  const updated = index === -1
    ? touch(model, { formation: parsed.value }, now)
    : touch(model, { coas: model.coas.map((c, i) => (i === index ? { ...c, template: parsed.value } : c)) }, now);
  return ok({ model: updated, events: [{ type: 'threat-model.updated', v: 1, payload: { model: updated, changed: [index === -1 ? 'formation' : 'coas'] } }] });
}

/** A list entry: what the list shows, without the templates. */
export const modelSummary = ({ id, name, revision, updatedAt, formation, coas }) =>
  ({ id, name, revision, updatedAt, unitCount: formation.units.length, coaCount: coas.length });

/**
 * A stored document as a threat model, or null when it is not a valid one. Units kept before M10-3
 * name systems by id; with `systemsById` those become copies of the systems as weapons (D28).
 */
export function readThreatModel(doc, systemsById = null) {
  if (!isObject(doc) || typeof doc.id !== 'string' || !Number.isInteger(doc.revision) || doc.revision < 1) return null;
  if (checkModelFields({ name: doc.name, description: doc.description ?? '' }).length) return null;
  const formation = parseTemplate(doc.formation, { newId: () => null, systemsById });
  if (formation.problems.length || !Array.isArray(doc.coas)) return null;
  const coas = doc.coas.map((c) => readCoa(c, systemsById));
  if (coas.some((c) => c === null)) return null;
  return deepFreeze({
    id: doc.id, revision: doc.revision, name: doc.name, description: doc.description ?? '',
    createdAt: doc.createdAt, updatedAt: doc.updatedAt, formation: formation.value, coas,
  });
}

// ---- threat COAs (T-3, IPB step 4) ----

export const COA_RANKS = Object.freeze(['mostLikely', 'mostDangerous', 'other']);
export const STATEMENT_PARTS = Object.freeze(['who', 'what', 'when', 'where', 'why', 'how']);
export const STATEMENT_MAX = 1000;
const RANK_NAMES = Object.freeze({ mostLikely: 'most likely', mostDangerous: 'most dangerous' });
const EMPTY_STATEMENT = Object.freeze(Object.fromEntries(STATEMENT_PARTS.map((p) => [p, ''])));

const coaNotFound = (model, coaId) => err(ErrorCode.NOT_FOUND, `Threat COA ${coaId} not found in ${model.name}`, { modelId: model.id, coaId });

/** Problems with whichever COA fields are present; `others` are the model's other COAs (for rank). */
function checkCoaFields(fields, others) {
  const problems = [];
  if ('name' in fields) problems.push(...checkText('name', fields.name, NAME_MAX, true));
  if ('rank' in fields) {
    if (!COA_RANKS.includes(fields.rank)) problems.push({ field: 'rank', reason: `must be one of ${COA_RANKS.join(', ')}` });
    else if (fields.rank !== 'other') {
      const holder = others.find((c) => c.rank === fields.rank);
      if (holder) problems.push({ field: 'rank', reason: `${holder.name} is already the ${RANK_NAMES[fields.rank]} COA (only one can be)` });
    }
  }
  if ('statement' in fields) {
    if (!isObject(fields.statement)) problems.push({ field: 'statement', reason: `must be an object { ${STATEMENT_PARTS.join(', ')} }` });
    else {
      for (const [part, text] of Object.entries(fields.statement)) {
        if (!STATEMENT_PARTS.includes(part)) problems.push({ field: `statement.${part}`, reason: 'unknown field' });
        else problems.push(...checkText(`statement.${part}`, text, STATEMENT_MAX, false));
      }
    }
  }
  if ('endState' in fields) problems.push(...checkText('endState', fields.endState, STATEMENT_MAX, false));
  return problems;
}

const trimmedStatement = (statement) => Object.fromEntries(Object.entries(statement).map(([k, v]) => [k, v.trim()]));
const coasChanged = (model, coas, now) => {
  const updated = touch(model, { coas }, now);
  return ok({ model: updated, events: [{ type: 'threat-model.updated', v: 1, payload: { model: updated, changed: ['coas'] } }] });
};

/** Add a threat COA; its play starts as a copy of the formation (same unit ids, so end positions line up). */
export function addThreatCoa(model, { id, name, rank = 'other' }, { now }) {
  const problems = checkCoaFields({ name, rank }, model.coas);
  if (problems.length) return invalid(problems);
  const coa = { id, name: name.trim(), rank, statement: { ...EMPTY_STATEMENT }, endState: '', template: model.formation };
  return coasChanged(model, [...model.coas, coa], now);
}

/** Rename, re-rank, or write the statement (parts given are replaced) and end state. */
export function updateThreatCoa(model, { coaId, ...changes }, { now }) {
  const index = model.coas.findIndex((c) => c.id === coaId);
  if (index === -1) return coaNotFound(model, coaId);
  const current = model.coas[index];
  const problems = checkCoaFields(changes, model.coas.filter((_, i) => i !== index));
  if (problems.length) return invalid(problems);
  const next = {
    ...current,
    ...('name' in changes ? { name: changes.name.trim() } : {}),
    ...('rank' in changes ? { rank: changes.rank } : {}),
    ...('statement' in changes ? { statement: { ...current.statement, ...trimmedStatement(changes.statement) } } : {}),
    ...('endState' in changes ? { endState: changes.endState.trim() } : {}),
  };
  if (jsonEqual(next, current)) return ok({ model, events: [] });
  return coasChanged(model, model.coas.map((c, i) => (i === index ? next : c)), now);
}

export function removeThreatCoa(model, { coaId }, { now }) {
  if (!model.coas.some((c) => c.id === coaId)) return coaNotFound(model, coaId);
  return coasChanged(model, model.coas.filter((c) => c.id !== coaId), now);
}

/** A stored COA, checked like a new one, or null. */
function readCoa(raw, systemsById) {
  if (!isObject(raw) || typeof raw.id !== 'string' || !isObject(raw.statement)) return null;
  if (checkCoaFields({ name: raw.name, rank: raw.rank, statement: raw.statement, endState: raw.endState ?? '' }, []).length) return null;
  const template = parseTemplate(raw.template, { newId: () => null, systemsById });
  if (template.problems.length) return null;
  return { id: raw.id, name: raw.name, rank: raw.rank, statement: { ...EMPTY_STATEMENT, ...raw.statement }, endState: raw.endState ?? '', template: template.value };
}
