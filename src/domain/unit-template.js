// Unit template (D29, M10-3b): a ready-made unit, like an ArcGIS feature template: a name and the
// unit it makes (symbol, label, facing, HVT tag, weapons, details). Adding a unit from a template
// COPIES these values; changing the template later does not change units already made.
//   { id, revision, name, sidc, label, facing?, hvt?, weapons?, details? }
import { deepFreeze } from '../shared/freeze.js';
import { isObject } from '../shared/values.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { parseSymbolFields, jsonEqual } from './map-symbol.js';
import { UNIT_EXTRAS, isEmptyExtra, withExtras } from './weapon.js';

export const TEMPLATE_NAME_MAX = 60;
export const UNIT_TEMPLATE_FORMAT = 'coa-builder/unit-templates';
export const UNIT_TEMPLATE_FORMAT_VERSION = 1;
export const MAX_IMPORT_TEMPLATES = 500;
/** The fields a template has besides id and revision, in canonical order. */
export const TEMPLATE_FIELDS = Object.freeze(['name', 'sidc', 'label', ...Object.keys(UNIT_EXTRAS)]);

const invalid = (problems) => err(ErrorCode.VALIDATION_FAILED, 'The unit template is not valid', { problems });

function checkName(name) {
  if (typeof name !== 'string' || name.trim() === '') return [{ field: 'name', reason: 'must not be blank' }];
  if (name.trim().length > TEMPLATE_NAME_MAX) return [{ field: 'name', reason: `must be at most ${TEMPLATE_NAME_MAX} characters` }];
  return [];
}

/**
 * Check whichever template fields are present. `at` prefixes problem fields (e.g. "templates[2]").
 * @returns {{ problems: object[], value: object }}
 */
export function parseTemplateFields(fields, { knownSidc = () => true, at = '' } = {}) {
  const where = (f) => (at ? `${at}.${f}` : f);
  const problems = Object.keys(fields).filter((k) => !TEMPLATE_FIELDS.includes(k)).map((k) => ({ field: where(k), reason: 'unknown field' }));
  const value = {};
  if ('name' in fields) { const p = checkName(fields.name); if (p.length) problems.push(...p.map((x) => ({ ...x, field: where(x.field) }))); else value.name = fields.name.trim(); }
  const { name, ...rest } = fields;
  const parsed = parseSymbolFields(Object.fromEntries(Object.entries(rest).filter(([k]) => TEMPLATE_FIELDS.includes(k))));
  problems.push(...parsed.problems.map((p) => ({ ...p, field: where(p.field) })));
  Object.assign(value, parsed.value);
  if (value.sidc && !knownSidc(value.sidc)) problems.push({ field: where('sidc'), reason: 'is not a symbol the app can draw' });
  return { problems, value };
}

const shape = (t) => deepFreeze(withExtras({ id: t.id, revision: t.revision, name: t.name, sidc: t.sidc, label: t.label ?? '' }, t));

/** A new template (name and sidc required). → { template, events: [unit-template.created] } */
export function createUnitTemplate({ id, ...fields }, { knownSidc } = {}) {
  const { problems, value } = parseTemplateFields(fields, { knownSidc });
  for (const required of ['name', 'sidc']) if (!(required in fields)) problems.push({ field: required, reason: 'is required' });
  if (problems.length) return invalid(problems);
  const template = shape({ id, revision: 1, label: '', ...value });
  return ok({ template, events: [{ type: 'unit-template.created', v: 1, payload: { template } }] });
}

/** Change fields (an empty extra removes it); unchanged values give no events. */
export function updateUnitTemplate(template, changes, { knownSidc } = {}) {
  const { problems, value } = parseTemplateFields(changes, { knownSidc });
  if (problems.length) return invalid(problems);
  const stored = (f, v) => (f in UNIT_EXTRAS && isEmptyExtra(v) ? undefined : v);
  const changed = TEMPLATE_FIELDS.filter((f) => f in value && !jsonEqual(stored(f, value[f]) ?? null, template[f] ?? null));
  if (changed.length === 0) return ok({ template, events: [] });
  const plain = Object.fromEntries(changed.filter((f) => !(f in UNIT_EXTRAS)).map((f) => [f, value[f]]));
  const extras = Object.fromEntries(changed.filter((f) => f in UNIT_EXTRAS).map((f) => [f, value[f]]));
  const next = shape(withExtras({ ...template, ...plain, revision: template.revision + 1 }, extras));
  return ok({ template: next, events: [{ type: 'unit-template.updated', v: 1, payload: { template: next, changed } }] });
}

/** A stored document as a template, or null when it is not a valid one. */
export function readUnitTemplate(doc) {
  if (!isObject(doc) || typeof doc.id !== 'string' || !Number.isInteger(doc.revision) || doc.revision < 1) return null;
  const { id, revision, ...fields } = doc;
  const created = createUnitTemplate({ id, ...fields });
  return created.ok ? shape({ ...created.value.template, revision }) : null;
}

/** The unit a template makes: the fields symbol.add and template units take (no position). */
export function unitFromTemplate(template) {
  const { id, revision, name, ...unit } = template;
  return JSON.parse(JSON.stringify(unit));
}

/** A system (the list before unit templates) as a template carrying that one weapon. */
export const templateFromSystem = (system, sidc) => ({
  name: system.name, sidc, label: '',
  weapons: [{ name: system.name, role: system.role, maxRange: system.maxRange, ...(system.minRange ? { minRange: system.minRange } : {}), arc: system.arc }],
});
