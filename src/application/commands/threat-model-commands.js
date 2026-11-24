// Threat models (Epic 3, T-2a): threat-model.create / update / delete / set-template, and the
// threat-model.list / threat-model.get queries. Stored in the DocumentRepository's "threat-models".
import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { withExtras } from '../../domain/weapon.js';
import { createThreatModel, updateThreatModel, setTemplate, readThreatModel, modelSummary, addThreatCoa, updateThreatCoa, removeThreatCoa } from '../../domain/threat-model.js';
import { readSystem } from '../../domain/system.js';
import { placePlay, POSITIONS } from '../../domain/placement.js';
import { parseLatLng } from '../../domain/lat-lng.js';
import { parseSymbolFields } from '../../domain/map-symbol.js';
import { parseNewGraphic } from '../../domain/graphic.js';
import { createPlacedCoa } from '../../domain/coa.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const COLLECTION = 'threat-models';

function asModelError(result) {
  const { code, message, details } = result.error;
  if (code === ErrorCode.NOT_FOUND) return err(code, `Threat model ${details.id} not found`, { modelId: details.id });
  if (code === ErrorCode.CONFLICT) return err(code, 'This threat model was changed elsewhere; reload and try again', { modelId: details.id, expectedRevision: details.expectedRevision, actualRevision: details.actualRevision });
  return err(code, message, details);
}

/** The systems list by id: templates kept before M10-3 name systems, which are read as weapons (D28). */
async function systemsById(documentRepository) {
  const listed = await documentRepository.list('systems');
  return listed.ok ? ok(new Map(listed.value.map(readSystem).filter(Boolean).map((s) => [s.id, s]))) : listed;
}

async function load(documentRepository, modelId) {
  const got = await documentRepository.get(COLLECTION, modelId);
  if (!got.ok) return asModelError(got);
  const systems = await systemsById(documentRepository);
  if (!systems.ok) return systems;
  const model = readThreatModel(got.value, systems.value);
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
 * threat-model.set-template { modelId, expectedRevision, target: "formation" | <threat COA id>, template: { units, graphics } }
 *   Replaces the whole template; items without an id get one. → ok(ThreatModel); emits threat-model.updated.
 */
export const setModelTemplate = defineMessage({
  kind: 'command', type: 'threat-model.set-template', v: 1,
  required: ['modelId', 'expectedRevision', 'target', 'template'],
  handle: ({ payload: { modelId, expectedRevision, target, template }, ctx, ports: { documentRepository, clock, ids, symbolRenderer } }) =>
    mutate({
      documentRepository, ctx, modelId, expectedRevision,
      change: async (model) => {
        const systems = await systemsById(documentRepository);
        if (!systems.ok) return systems;
        return setTemplate(model, { target, template }, {
          now: clock.now(), newId: (prefix) => ids.next(prefix), systemsById: systems.value,
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
    const systems = await systemsById(documentRepository);
    if (!systems.ok) return systems;
    return ok(listed.value.map((doc) => readThreatModel(doc, systems.value)).filter(Boolean).map(modelSummary)
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

/** threat-coa.add { modelId, expectedRevision, name, rank? } → ok(ThreatModel): a COA whose play is a copy of the formation. */
export const addCoa = defineMessage({
  kind: 'command', type: 'threat-coa.add', v: 1,
  required: ['modelId', 'expectedRevision', 'name'], optional: ['rank'],
  handle: ({ payload: { modelId, expectedRevision, name, rank }, ctx, ports: { documentRepository, clock, ids } }) =>
    mutate({ documentRepository, ctx, modelId, expectedRevision, change: (model) => addThreatCoa(model, { id: ids.next('tc'), name, ...(rank === undefined ? {} : { rank }) }, { now: clock.now() }) }),
});

/** threat-coa.update { modelId, expectedRevision, coaId, name?, rank?, statement?: { who?, what?, when?, where?, why?, how? }, endState? } → ok(ThreatModel). */
export const updateCoa = defineMessage({
  kind: 'command', type: 'threat-coa.update', v: 1,
  required: ['modelId', 'expectedRevision', 'coaId'], optional: ['name', 'rank', 'statement', 'endState'],
  handle: ({ payload: { modelId, expectedRevision, ...changes }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, modelId, expectedRevision, change: (model) => updateThreatCoa(model, changes, { now: clock.now() }) }),
});

/** threat-coa.remove { modelId, expectedRevision, coaId } → ok(ThreatModel). */
export const removeCoa = defineMessage({
  kind: 'command', type: 'threat-coa.remove', v: 1,
  required: ['modelId', 'expectedRevision', 'coaId'],
  handle: ({ payload: { modelId, expectedRevision, coaId }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, modelId, expectedRevision, change: (model) => removeThreatCoa(model, { coaId }, { now: clock.now() }) }),
});

/**
 * threat-coa.place { modelId, play: "formation" | <threat COA id>, anchor: { lat, lng }, bearing, positions: start | end | endWithMoves, name? }
 *   Lays the play on the map at the anchor, with +y along `bearing` (degrees from true north), keeping
 *   every distance (D24). → ok(Coa), a new COA with `source` linking back; emits coa.placed { coa }.
 */
export const placeCoa = defineMessage({
  kind: 'command', type: 'threat-coa.place', v: 1,
  required: ['modelId', 'play', 'anchor', 'bearing', 'positions'], optional: ['name'],
  async handle({ payload: { modelId, play, anchor, bearing, positions, name }, ctx, ports: { documentRepository, coaStore, clock, ids } }) {
    const at = parseLatLng(anchor, 'anchor');
    const problems = [
      ...checkId('modelId', modelId),
      ...(typeof play === 'string' && play !== '' ? [] : [{ field: 'play', reason: 'must be "formation" or a threat COA id' }]),
      ...(at.problems ?? []),
      ...(typeof bearing === 'number' && Number.isFinite(bearing) && bearing >= 0 && bearing < 360 ? [] : [{ field: 'bearing', reason: 'must be degrees from true north, 0 to less than 360' }]),
      ...(POSITIONS.includes(positions) ? [] : [{ field: 'positions', reason: `must be one of ${POSITIONS.join(', ')}` }]),
      ...(name === undefined || (typeof name === 'string' && name.trim() !== '') ? [] : [{ field: 'name', reason: 'must not be blank' }]),
    ];
    if (problems.length) return validationFailed('Invalid threat-coa.place payload', problems);
    const loaded = await load(documentRepository, modelId);
    if (!loaded.ok) return loaded;
    const placed = placePlay(loaded.value, { play, anchor: at.value, bearing, positions });
    if (!placed) return err(ErrorCode.NOT_FOUND, `Threat COA ${play} not found`, { modelId, coaId: play });

    // Every unit and graphic is checked like any other (e.g. a template that reaches past a pole).
    const checked = [];
    const symbols = placed.symbols.map((fields, i) => {
      const parsed = parseSymbolFields(fields);
      checked.push(...parsed.problems.map((p) => ({ ...p, field: `symbols[${i}].${p.field}` })));
      const v = parsed.value;
      return parsed.problems.length ? null : withExtras({ id: ids.next('sym'), sidc: v.sidc, position: v.position, label: v.label, modifiers: v.modifiers }, v);
    });
    const graphics = placed.graphics.map((g, i) => {
      const parsed = parseNewGraphic(g);
      checked.push(...parsed.problems.map((p) => ({ ...p, field: `graphics[${i}].${p.field}` })));
      return parsed.problems.length ? null : { id: ids.next('gfx'), ...parsed.value };
    });
    if (checked.length) return validationFailed('The placed template does not fit on the map here', checked);

    const created = createPlacedCoa({ id: ids.next('coa'), name: name ?? placed.name, description: placed.description, symbols, graphics, source: placed.source }, { now: clock.now() });
    if (!created.ok) return created;
    const saved = await coaStore.save(created.value.coa, { expectedRevision: 0 });
    if (!saved.ok) return saved;
    created.value.events.forEach((e) => ctx.emit(e));
    return ok(created.value.coa);
  },
});
