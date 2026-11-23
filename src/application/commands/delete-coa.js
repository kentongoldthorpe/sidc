import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { coaDeleted } from '../../domain/coa.js';
import { ok } from '../../shared/result.js';

/**
 * coa.delete { coaId, expectedRevision } → ok({ coaId }); emits coa.deleted { coaId }.
 * The repository enforces the revision check (CONFLICT) and existence (NOT_FOUND).
 */
export const deleteCoa = defineMessage({
  kind: 'command', type: 'coa.delete', v: 1,
  required: ['coaId', 'expectedRevision'],
  async handle({ payload: { coaId, expectedRevision }, ctx, ports: { coaStore } }) {
    const problems = [...checkId('coaId', coaId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid coa.delete payload', problems);

    const removed = await coaStore.remove(coaId, { expectedRevision });
    if (!removed.ok) return removed;

    ctx.emit(coaDeleted(coaId));
    return ok({ coaId });
  },
});
