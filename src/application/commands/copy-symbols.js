import { defineMessage, checkId, checkIdList, checkRevision, validationFailed } from '../message-definition.js';
import { copySymbols as copySymbolsInto, pickSymbols, checkOffset } from '../../domain/coa.js';
import { mutateCoa } from './mutate-coa.js';
import { ok } from '../../shared/result.js';

/**
 * symbol.copy { coaId, expectedRevision, fromCoaId, symbolIds, offset? }
 *   Copies units from `fromCoaId` into `coaId` (the same or another COA) with fresh ids, moved by
 *   `offset` degrees. All or nothing, one revision of the target; emits symbol.added per copy.
 *   → ok({ coaId, revision, symbols })
 */
export const copySymbols = defineMessage({
  kind: 'command', type: 'symbol.copy', v: 1,
  required: ['coaId', 'expectedRevision', 'fromCoaId', 'symbolIds'], optional: ['offset'],
  async handle({ payload: { coaId, expectedRevision, fromCoaId, symbolIds, offset }, ctx, ports: { coaRepository, clock, ids } }) {
    const problems = [
      ...checkId('coaId', coaId),
      ...checkRevision('expectedRevision', expectedRevision),
      ...checkId('fromCoaId', fromCoaId),
      ...checkIdList('symbolIds', symbolIds),
      ...(offset === undefined ? [] : checkOffset(offset)),
    ];
    if (problems.length) return validationFailed('Invalid symbol.copy payload', problems);

    let source = null; // loaded now when copying between COAs; the target itself otherwise
    if (fromCoaId !== coaId) {
      const loaded = await coaRepository.get(fromCoaId);
      if (!loaded.ok) return loaded;
      source = loaded.value;
    }

    const result = await mutateCoa({
      coaRepository, ctx, coaId, expectedRevision,
      change: (target) => {
        const picked = pickSymbols(source ?? target, symbolIds);
        if (!picked.ok) return picked;
        return copySymbolsInto(target, { sources: picked.value, symbolIds: picked.value.map(() => ids.next('sym')), offset }, { now: clock.now() });
      },
    });
    if (!result.ok) return result;
    const { coa, events } = result.value;
    return ok({ coaId, revision: coa.revision, symbols: events.map((e) => e.payload.symbol) });
  },
});
