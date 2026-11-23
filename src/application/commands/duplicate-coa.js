import { defineMessage, checkId, validationFailed } from '../message-definition.js';
import { checkCoaFields, duplicateCoa as duplicateCoaAggregate } from '../../domain/coa.js';
import { ok } from '../../shared/result.js';

/** coa.duplicate { coaId, name? } → ok(Coa copy); emits coa.duplicated { sourceCoaId, coa } */
export const duplicateCoa = defineMessage({
  kind: 'command', type: 'coa.duplicate', v: 1,
  required: ['coaId'], optional: ['name'],
  async handle({ payload: { coaId, ...rest }, ctx, ports: { coaRepository, clock, ids } }) {
    const problems = [...checkId('coaId', coaId), ...checkCoaFields(rest)];
    if (problems.length) return validationFailed('Invalid coa.duplicate payload', problems);

    const loaded = await coaRepository.get(coaId);
    if (!loaded.ok) return loaded;
    const source = loaded.value;

    const duplicated = duplicateCoaAggregate(source, {
      id: ids.next('coa'), name: rest.name, symbolIds: source.symbols.map(() => ids.next('sym')),
      graphicIds: source.graphics.map(() => ids.next('gfx')),
    }, { now: clock.now() });
    if (!duplicated.ok) return duplicated;
    const { coa, events } = duplicated.value;

    const saved = await coaRepository.save(coa, { expectedRevision: 0 });
    if (!saved.ok) return saved;

    events.forEach((e) => ctx.emit(e));
    return ok(coa);
  },
});
