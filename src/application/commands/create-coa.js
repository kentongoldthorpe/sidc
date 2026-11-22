import { defineMessage } from '../message-definition.js';
import { createCoa as createCoaAggregate } from '../../domain/coa.js';
import { ok } from '../../shared/result.js';

/** coa.create { name, description? } → ok(Coa); emits coa.created { coa } */
export const createCoa = defineMessage({
  kind: 'command', type: 'coa.create', v: 1,
  required: ['name'], optional: ['description'],
  async handle({ payload, ctx, ports: { coaRepository, clock, ids } }) {
    const created = createCoaAggregate({ id: ids.next('coa'), ...payload }, { now: clock.now() });
    if (!created.ok) return created;
    const { coa, events } = created.value;

    const saved = await coaRepository.save(coa, { expectedRevision: 0 });
    if (!saved.ok) return saved;

    events.forEach((e) => ctx.emit(e));
    return ok(coa);
  },
});
