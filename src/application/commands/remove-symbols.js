import { defineMessage, checkId, checkIdList, checkRevision, validationFailed } from '../message-definition.js';
import { removeSymbols as removeSymbolsFromCoa } from '../../domain/coa.js';
import { mutateCoa } from './mutate-coa.js';
import { ok } from '../../shared/result.js';

/**
 * symbol.remove-many { coaId, expectedRevision, symbolIds } → ok({ coaId, revision, symbolIds })
 * All or nothing, one revision; emits symbol.removed per unit.
 */
export const removeSymbols = defineMessage({
  kind: 'command', type: 'symbol.remove-many', v: 1,
  required: ['coaId', 'expectedRevision', 'symbolIds'],
  async handle({ payload: { coaId, expectedRevision, symbolIds }, ctx, ports: { coaStore, clock } }) {
    const problems = [...checkId('coaId', coaId), ...checkRevision('expectedRevision', expectedRevision), ...checkIdList('symbolIds', symbolIds)];
    if (problems.length) return validationFailed('Invalid symbol.remove-many payload', problems);

    const result = await mutateCoa({
      coaStore, ctx, coaId, expectedRevision,
      change: (coa) => removeSymbolsFromCoa(coa, { symbolIds }, { now: clock.now() }),
    });
    return result.ok ? ok({ coaId, revision: result.value.coa.revision, symbolIds }) : result;
  },
});
