// Threat models (Epic 3, T-2a): threat-model.create / update / delete / set-template, and the
// threat-model.list / threat-model.get queries. Stored in the DocumentRepository's "threat-models".
import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { createThreatModel, updateThreatModel, setTemplate, readThreatModel, modelSummary } from '../../domain/threat-model.js';
import { readSystem } from '../../domain/system.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const COLLECTION = 'threat-models';

function asModelError(result) {
  const { code, message, details } = result.error;
  if (code === ErrorCode.NOT_FOUND) return err(code, `Threat model ${details.id} not found`, { modelId: details.id });
  if (code === ErrorCode.CONFLICT) return err(code, 'This threat model was changed elsewhere; reload and try again', { modelId: details.id, expectedRevision: details.expectedRevision, actualRevision: details.actualRevision });
  return err(code, message, details);
}

async function load(documentRepository, modelId) {
  const got = await documentRepository.get(COLLECTION, modelId);
  if (!got.ok) return asModelError(got);
  const model = readThreatModel(got.value);
  return model ? ok(model) : err(ErrorCode.STORAGE_UNAVAILABLE, `The stored threat model ${modelId} is not valid`, { modelId });
}

/** load → stale-revision check → change → save (only when something changed) → emit. */
async function mutate({ documentRepository, ctx, modelId, expectedRevision, change }) {
  const problems = [...checkId('modelId', modelId), ...checkRevision('expectedRevision', expectedRevision)];
  if (problems.length) return validationFailed('Invalid threat model payload', problems);
  const loaded = await load(documentRepository, modelId);
  if (!loaded.ok) return loaded;
  if (loaded.value.revision !== expectedRevision) {
    return err(ErrorCode.CONFLICT, 'This threat model was changed elsewhere; reload and try again', { modelId, expectedRevision, actualRevision: loaded.value.revision });
  }
  const changed = await change(loaded.value);
  if (!changed.ok) return changed;
  if (changed.value.events.length > 0) {
    const saved = await documentRepository.save(COLLECTION, changed.value.model, { expectedRevision });
    if (!saved.ok) return asModelError(saved);
    changed.value.events.forEach((e) => ctx.emit(e));
  }
  return ok(changed.value.model);
}

/** threat-model.create { name, description? } → ok(ThreatModel); emits threat-model.created { model }. */
export const createModel = defineMessage({
  kind: 'command', type: 'threat-model.create', v: 1,
  required: ['name'], optional: ['description'],
  async handle({ payload, ctx, ports: { documentRepository, ids, clock } }) {
    const created = createThreatModel({ id: ids.next('tm'), ...payload }, { now: clock.now() });
    if (!created.ok) return created;
    const saved = await documentRepository.save(COLLECTION, created.value.model, { expectedRevision: 0 });
    if (!saved.ok) return asModelError(saved);
    created.value.events.forEach((e) => ctx.emit(e));
    return ok(created.value.model);
  },
});

/** threat-model.update { modelId, expectedRevision, name?, description? } → ok(ThreatModel); emits threat-model.updated { model, changed }. */
export const updateModel = defineMessage({
  kind: 'command', type: 'threat-model.update', v: 1,
  required: ['modelId', 'expectedRevision'], optional: ['name', 'description'],
  handle: ({ payload: { modelId, expectedRevision, ...changes }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, modelId, expectedRevision, change: (model) => updateThreatModel(model, changes, { now: clock.now() }) }),
});

/**
 * threat-model.set-template { modelId, expectedRevision, target: "formation", template: { units, graphics } }
 *   Replaces the whole template; items without an id get one. → ok(ThreatModel); emits threat-model.updated.
 */
export const setModelTemplate = defineMessage({
  kind: 'command', type: 'threat-model.set-template', v: 1,
  required: ['modelId', 'expectedRevision', 'target', 'template'],
  handle: ({ payload: { modelId, expectedRevision, target, template }, ctx, ports: { documentRepository, clock, ids, symbolRenderer } }) =>
    mutate({
      documentRepository, ctx, modelId, expectedRevision,
      change: async (model) => {
        const systems = await documentRepository.list('systems');
        if (!systems.ok) return systems;
        const systemIds = new Set(systems.value.map(readSystem).filter(Boolean).map((s) => s.id));
        return setTemplate(model, { target, template }, {
          now: clock.now(), newId: (prefix) => ids.next(prefix), systemIds,
          knownSidc: (sidc) => symbolRenderer.render(sidc, {}).valid,
        });
      },
    }),
});

/** threat-model.delete { modelId, expectedRevision } → ok({ modelId }); emits threat-model.deleted { modelId }. */
export const deleteModel = defineMessage({
  kind: 'command', type: 'threat-model.delete', v: 1,
  required: ['modelId', 'expectedRevision'],
  async handle({ payload: { modelId, expectedRevision }, ctx, ports: { documentRepository } }) {
    const problems = [...checkId('modelId', modelId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid threat-model.delete payload', problems);
    const removed = await documentRepository.remove(COLLECTION, modelId, { expectedRevision });
    if (!removed.ok) return asModelError(removed);
    ctx.emit({ type: 'threat-model.deleted', v: 1, payload: { modelId } });
    return ok({ modelId });
  },
});

/** threat-model.list {} → ok(summaries { id, name, revision, updatedAt, unitCount, coaCount } by name). */
export const listModels = defineMessage({
  kind: 'query', type: 'threat-model.list', v: 1,
  async handle({ ports: { documentRepository } }) {
    const listed = await documentRepository.list(COLLECTION);
    if (!listed.ok) return listed;
    return ok(listed.value.map(readThreatModel).filter(Boolean).map(modelSummary)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
  },
});

/** threat-model.get { modelId } → ok(ThreatModel) | NOT_FOUND { modelId }. */
export const getModel = defineMessage({
  kind: 'query', type: 'threat-model.get', v: 1,
  required: ['modelId'],
  async handle({ payload: { modelId }, ports: { documentRepository } }) {
    const problems = checkId('modelId', modelId);
    if (problems.length) return validationFailed('Invalid threat-model.get payload', problems);
    return load(documentRepository, modelId);
  },
});
