// The systems list (T-1): system.create, system.update, system.delete and the system.list query.
// Stored in the DocumentRepository's "systems" collection.
import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { createSystem as create, updateSystem as update, readSystem } from '../../domain/system.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const COLLECTION = 'systems';
const FIELDS = ['name', 'role', 'maxRange', 'minRange', 'arc'];

/** Repository failures in the terms of this message (systemId rather than collection/id). */
function asSystemError(result) {
  const { code, message, details } = result.error;
  if (code === ErrorCode.NOT_FOUND) return err(code, `System ${details.id} not found`, { systemId: details.id });
  if (code === ErrorCode.CONFLICT) return err(code, 'This system was changed elsewhere; reload and try again', { systemId: details.id, expectedRevision: details.expectedRevision, actualRevision: details.actualRevision });
  return err(code, message, details);
}

async function load(documentRepository, systemId) {
  const got = await documentRepository.get(COLLECTION, systemId);
  if (!got.ok) return asSystemError(got);
  const system = readSystem(got.value);
  return system ? ok(system) : err(ErrorCode.STORAGE_UNAVAILABLE, `The stored system ${systemId} is not valid`, { systemId });
}

/** system.create { name, role, maxRange, minRange?, arc? } → ok(System); emits system.created { system }. */
export const createSystem = defineMessage({
  kind: 'command', type: 'system.create', v: 1,
  required: [], optional: FIELDS,
  async handle({ payload, ctx, ports: { documentRepository, ids } }) {
    const created = create({ id: ids.next('sys'), ...payload });
    if (!created.ok) return created;
    const saved = await documentRepository.save(COLLECTION, created.value.system, { expectedRevision: 0 });
    if (!saved.ok) return asSystemError(saved);
    created.value.events.forEach((e) => ctx.emit(e));
    return ok(created.value.system);
  },
});

/** system.update { systemId, expectedRevision, ...fields (minRange: null removes it) } → ok(System); emits system.updated. */
export const updateSystem = defineMessage({
  kind: 'command', type: 'system.update', v: 1,
  required: ['systemId', 'expectedRevision'], optional: FIELDS,
  async handle({ payload: { systemId, expectedRevision, ...changes }, ctx, ports: { documentRepository } }) {
    const problems = [...checkId('systemId', systemId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid system.update payload', problems);
    const loaded = await load(documentRepository, systemId);
    if (!loaded.ok) return loaded;
    if (loaded.value.revision !== expectedRevision) {
      return err(ErrorCode.CONFLICT, 'This system was changed elsewhere; reload and try again', { systemId, expectedRevision, actualRevision: loaded.value.revision });
    }
    const updated = update(loaded.value, changes);
    if (!updated.ok) return updated;
    if (updated.value.events.length === 0) return ok(updated.value.system);
    const saved = await documentRepository.save(COLLECTION, updated.value.system, { expectedRevision });
    if (!saved.ok) return asSystemError(saved);
    updated.value.events.forEach((e) => ctx.emit(e));
    return ok(updated.value.system);
  },
});

/** system.delete { systemId, expectedRevision } → ok({ systemId }); emits system.deleted { systemId }. */
export const deleteSystem = defineMessage({
  kind: 'command', type: 'system.delete', v: 1,
  required: ['systemId', 'expectedRevision'],
  async handle({ payload: { systemId, expectedRevision }, ctx, ports: { documentRepository } }) {
    const problems = [...checkId('systemId', systemId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid system.delete payload', problems);
    const removed = await documentRepository.remove(COLLECTION, systemId, { expectedRevision });
    if (!removed.ok) return asSystemError(removed);
    ctx.emit({ type: 'system.deleted', v: 1, payload: { systemId } });
    return ok({ systemId });
  },
});

/** system.list {} → ok(System[]) by name (natural order); stored documents that are not valid systems are skipped. */
export const listSystems = defineMessage({
  kind: 'query', type: 'system.list', v: 1,
  async handle({ ports: { documentRepository } }) {
    const listed = await documentRepository.list(COLLECTION);
    if (!listed.ok) return listed;
    return ok(listed.value.map(readSystem).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
  },
});
