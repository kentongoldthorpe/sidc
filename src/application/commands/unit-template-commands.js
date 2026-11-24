// Unit templates (D29, M10-3b): unit-template.create / update / delete / import /
// from-systems and the unit-template.list / unit-template.export queries. Stored in the open
// project's "unit-templates" collection.
import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import {
  createUnitTemplate, updateUnitTemplate, readUnitTemplate, parseTemplateFields, templateFromSystem, TEMPLATE_FIELDS,
  UNIT_TEMPLATE_FORMAT, UNIT_TEMPLATE_FORMAT_VERSION, MAX_IMPORT_TEMPLATES,
} from '../../domain/unit-template.js';
import { readSystem } from '../../domain/system.js';
import { isObject } from '../../shared/values.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const COLLECTION = 'unit-templates';
/** The symbol a system becomes when it is turned into a template: a hostile land unit, to be edited. */
export const SYSTEM_TEMPLATE_SIDC = '10061000000000000000';
const knownSidc = (symbolRenderer) => (sidc) => symbolRenderer.render(sidc, {}).valid;
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function asTemplateError(result, templateId) {
  const { code, message, details } = result.error;
  if (code === ErrorCode.NOT_FOUND) return err(code, `Unit template ${templateId} not found`, { templateId });
  if (code === ErrorCode.CONFLICT) return err(code, 'This unit template was changed elsewhere; reload and try again', { templateId, expectedRevision: details.expectedRevision, actualRevision: details.actualRevision });
  return err(code, message, details);
}

async function load(documents, templateId) {
  const got = await documents.get(COLLECTION, templateId);
  if (!got.ok) return asTemplateError(got, templateId);
  const template = readUnitTemplate(got.value);
  return template ? ok(template) : err(ErrorCode.STORAGE_UNAVAILABLE, `The stored unit template ${templateId} is not valid`, { templateId });
}

async function listTemplates(documents) {
  const listed = await documents.list(COLLECTION);
  return listed.ok ? ok(listed.value.map(readUnitTemplate).filter(Boolean).sort(byName)) : listed;
}

/** unit-template.create { name, sidc, label?, facing?, hvt?, weapons?, details? } → ok(UnitTemplate); emits unit-template.created. */
export const createTemplate = defineMessage({
  kind: 'command', type: 'unit-template.create', v: 1, optional: TEMPLATE_FIELDS,
  async handle({ payload, ctx, ports: { documentRepository, ids, symbolRenderer } }) {
    const created = createUnitTemplate({ id: ids.next('ut'), ...payload }, { knownSidc: knownSidc(symbolRenderer) });
    if (!created.ok) return created;
    const saved = await documentRepository.save(COLLECTION, created.value.template, { expectedRevision: 0 });
    if (!saved.ok) return asTemplateError(saved, created.value.template.id);
    created.value.events.forEach((e) => ctx.emit(e));
    return ok(created.value.template);
  },
});

/** unit-template.update { templateId, expectedRevision, ...fields } → ok(UnitTemplate); emits unit-template.updated { template, changed }. */
export const updateTemplate = defineMessage({
  kind: 'command', type: 'unit-template.update', v: 1,
  required: ['templateId', 'expectedRevision'], optional: TEMPLATE_FIELDS,
  async handle({ payload: { templateId, expectedRevision, ...changes }, ctx, ports: { documentRepository, symbolRenderer } }) {
    const problems = [...checkId('templateId', templateId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid unit-template.update payload', problems);
    const loaded = await load(documentRepository, templateId);
    if (!loaded.ok) return loaded;
    if (loaded.value.revision !== expectedRevision) {
      return err(ErrorCode.CONFLICT, 'This unit template was changed elsewhere; reload and try again', { templateId, expectedRevision, actualRevision: loaded.value.revision });
    }
    const updated = updateUnitTemplate(loaded.value, changes, { knownSidc: knownSidc(symbolRenderer) });
    if (!updated.ok) return updated;
    if (updated.value.events.length === 0) return ok(updated.value.template);
    const saved = await documentRepository.save(COLLECTION, updated.value.template, { expectedRevision });
    if (!saved.ok) return asTemplateError(saved, templateId);
    updated.value.events.forEach((e) => ctx.emit(e));
    return ok(updated.value.template);
  },
});

/** unit-template.delete { templateId, expectedRevision } → ok({ templateId }); emits unit-template.deleted. Units made from it are not changed. */
export const deleteTemplate = defineMessage({
  kind: 'command', type: 'unit-template.delete', v: 1, required: ['templateId', 'expectedRevision'],
  async handle({ payload: { templateId, expectedRevision }, ctx, ports: { documentRepository } }) {
    const problems = [...checkId('templateId', templateId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid unit-template.delete payload', problems);
    const removed = await documentRepository.remove(COLLECTION, templateId, { expectedRevision });
    if (!removed.ok) return asTemplateError(removed, templateId);
    ctx.emit({ type: 'unit-template.deleted', v: 1, payload: { templateId } });
    return ok({ templateId });
  },
});

/** unit-template.list {} → ok(UnitTemplate[]) by name; stored documents that are not valid templates are skipped. */
export const listTemplatesMessage = defineMessage({
  kind: 'query', type: 'unit-template.list', v: 1,
  handle: ({ ports: { documentRepository } }) => listTemplates(documentRepository),
});

/** unit-template.export {} → ok({ format, version, templates }): every template, without ids, for another project or person. */
export const exportTemplates = defineMessage({
  kind: 'query', type: 'unit-template.export', v: 1,
  async handle({ ports: { documentRepository } }) {
    const listed = await listTemplates(documentRepository);
    if (!listed.ok) return listed;
    return ok({ format: UNIT_TEMPLATE_FORMAT, version: UNIT_TEMPLATE_FORMAT_VERSION, templates: listed.value.map(({ id, revision, ...t }) => JSON.parse(JSON.stringify(t))) });
  },
});

/**
 * unit-template.import { document } → ok({ templates }): adds every template in a
 * coa-builder/unit-templates v1 document (docs/UNIT-TEMPLATES.md) with new ids. All or nothing.
 * Emits unit-template.created for each. IMPORT_INVALID { problems } | UNSUPPORTED_VERSION { found, supported }.
 */
export const importTemplates = defineMessage({
  kind: 'command', type: 'unit-template.import', v: 1, required: ['document'],
  async handle({ payload: { document: doc }, ctx, ports: { documentRepository, ids, symbolRenderer } }) {
    const bad = (problems) => err(ErrorCode.IMPORT_INVALID, 'The unit template file has problems', { problems });
    if (!isObject(doc) || doc.format !== UNIT_TEMPLATE_FORMAT) return bad([{ field: 'format', reason: `must be "${UNIT_TEMPLATE_FORMAT}"` }]);
    if (doc.version !== UNIT_TEMPLATE_FORMAT_VERSION) {
      if (Number.isInteger(doc.version) && doc.version > UNIT_TEMPLATE_FORMAT_VERSION) {
        return err(ErrorCode.UNSUPPORTED_VERSION, `Unit template file version ${doc.version} is newer than this app supports`, { found: doc.version, supported: [UNIT_TEMPLATE_FORMAT_VERSION] });
      }
      return bad([{ field: 'version', reason: `must be ${UNIT_TEMPLATE_FORMAT_VERSION}` }]);
    }
    const problems = Object.keys(doc).filter((k) => !['format', 'version', 'source', 'templates'].includes(k)).map((k) => ({ field: k, reason: 'unknown field' }));
    if ('source' in doc && (typeof doc.source !== 'string' || doc.source.length > 200)) problems.push({ field: 'source', reason: 'must be text of at most 200 characters' });
    if (!Array.isArray(doc.templates) || doc.templates.length === 0 || doc.templates.length > MAX_IMPORT_TEMPLATES) {
      return bad([...problems, { field: 'templates', reason: `must be a list of 1 to ${MAX_IMPORT_TEMPLATES} templates` }]);
    }
    const built = doc.templates.map((raw, i) => {
      const at = `templates[${i}]`;
      if (!isObject(raw)) { problems.push({ field: at, reason: 'must be an object' }); return null; }
      const checked = parseTemplateFields(raw, { knownSidc: knownSidc(symbolRenderer), at });
      for (const required of ['name', 'sidc']) if (!(required in raw)) checked.problems.push({ field: `${at}.${required}`, reason: 'is required' });
      problems.push(...checked.problems);
      return checked.problems.length ? null : raw;
    });
    if (problems.length) return bad(problems);
    const templates = built.map((raw) => createUnitTemplate({ id: ids.next('ut'), ...raw }).value.template);
    for (const t of templates) {
      const saved = await documentRepository.save(COLLECTION, t, { expectedRevision: 0 });
      if (!saved.ok) return asTemplateError(saved, t.id);
    }
    templates.forEach((template) => ctx.emit({ type: 'unit-template.created', v: 1, payload: { template } }));
    return ok({ templates });
  },
});

/**
 * unit-template.from-systems {} → ok({ templates }): one template per system in the systems list
 * (the list before unit templates), named after it, carrying it as its one weapon, with a plain
 * hostile land-unit symbol to edit. Systems already turned into a template (same name) are skipped.
 * The systems list itself is not changed.
 */
export const templatesFromSystems = defineMessage({
  kind: 'command', type: 'unit-template.from-systems', v: 1,
  async handle({ ctx, ports: { documentRepository, ids } }) {
    const [systems, existing] = await Promise.all([documentRepository.list('systems'), listTemplates(documentRepository)]);
    if (!systems.ok) return systems;
    if (!existing.ok) return existing;
    const taken = new Set(existing.value.map((t) => t.name));
    const templates = systems.value.map(readSystem).filter((s) => s && !taken.has(s.name))
      .map((s) => createUnitTemplate({ id: ids.next('ut'), ...templateFromSystem(s, SYSTEM_TEMPLATE_SIDC) }).value.template);
    for (const t of templates) {
      const saved = await documentRepository.save(COLLECTION, t, { expectedRevision: 0 });
      if (!saved.ok) return asTemplateError(saved, t.id);
    }
    templates.forEach((template) => ctx.emit({ type: 'unit-template.created', v: 1, payload: { template } }));
    return ok({ templates });
  },
});

export const UNIT_TEMPLATE_MESSAGES = Object.freeze([createTemplate, updateTemplate, deleteTemplate, listTemplatesMessage, exportTemplates, importTemplates, templatesFromSystems]);
