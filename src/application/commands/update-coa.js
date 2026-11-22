import { defineMessage, checkId, checkRevision, staleRevision, validationFailed } from '../message-definition.js';
import { checkCoaFields, updateCoa as updateCoaAggregate } from '../../domain/coa.js';
import { ok } from '../../shared/result.js';

/**
 * coa.update { coaId, expectedRevision, name?, description? } → ok(Coa)
 * emits coa.updated { coa, changed } unless nothing changed.
 */
export const updateCoa = defineMessage({
  kind: 'command', type: 'coa.update', v: 1,
  required: ['coaId', 'expectedRevision'], optional: ['name', 'description'],
  async handle({ payload: { coaId, expectedRevision, ...changes }, ctx, ports: { coaRepository, clock } }) {
    const problems = [
      ...checkId('coaId', coaId),
      ...checkRevision('expectedRevision', expectedRevision),
      ...checkCoaFields(changes),
    ];
    if (problems.length) return validationFailed('Invalid coa.update payload', problems);

    const loaded = await coaRepository.get(coaId);
    if (!loaded.ok) return loaded;
    if (loaded.value.revision !== expectedRevision) return staleRevision(coaId, expectedRevision, loaded.value.revision);

    const updated = updateCoaAggregate(loaded.value, changes, { now: clock.now() });
    if (!updated.ok) return updated;
    const { coa, events } = updated.value;
    if (events.length === 0) return ok(coa);

    const saved = await coaRepository.save(coa, { expectedRevision });
    if (!saved.ok) return saved;

    events.forEach((e) => ctx.emit(e));
    return ok(coa);
  },
});
