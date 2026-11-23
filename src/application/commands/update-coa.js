import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { checkCoaFields, updateCoa as updateCoaAggregate } from '../../domain/coa.js';
import { mutateCoa } from './mutate-coa.js';
import { ok } from '../../shared/result.js';

/**
 * coa.update { coaId, expectedRevision, name?, description?, frame? } → ok(Coa)
 * frame: the COA's own export frame; null removes it (back to the shared frame).
 * emits coa.updated { coa, changed } unless nothing changed.
 */
export const updateCoa = defineMessage({
  kind: 'command', type: 'coa.update', v: 1,
  required: ['coaId', 'expectedRevision'], optional: ['name', 'description', 'frame'],
  async handle({ payload: { coaId, expectedRevision, ...changes }, ctx, ports: { coaRepository, clock } }) {
    const problems = [
      ...checkId('coaId', coaId),
      ...checkRevision('expectedRevision', expectedRevision),
      ...checkCoaFields(changes),
    ];
    if (problems.length) return validationFailed('Invalid coa.update payload', problems);

    const result = await mutateCoa({
      coaRepository, ctx, coaId, expectedRevision,
      change: (coa) => updateCoaAggregate(coa, changes, { now: clock.now() }),
    });
    return result.ok ? ok(result.value.coa) : result;
  },
});
