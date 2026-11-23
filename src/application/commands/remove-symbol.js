import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { removeSymbol as removeSymbolFromCoa } from '../../domain/coa.js';
import { mutateCoa } from './mutate-coa.js';
import { ok } from '../../shared/result.js';

/**
 * symbol.remove { coaId, expectedRevision, symbolId }
 *   → ok({ coaId, revision, symbolId }); emits symbol.removed with the same payload.
 */
export const removeSymbol = defineMessage({
  kind: 'command', type: 'symbol.remove', v: 1,
  required: ['coaId', 'expectedRevision', 'symbolId'],
  async handle({ payload: { coaId, expectedRevision, symbolId }, ctx, ports: { coaStore, clock } }) {
    const problems = [
      ...checkId('coaId', coaId),
      ...checkRevision('expectedRevision', expectedRevision),
      ...checkId('symbolId', symbolId),
    ];
    if (problems.length) return validationFailed('Invalid symbol.remove payload', problems);

    const result = await mutateCoa({
      coaStore, ctx, coaId, expectedRevision,
      change: (coa) => removeSymbolFromCoa(coa, { symbolId }, { now: clock.now() }),
    });
    return result.ok ? ok({ coaId, revision: result.value.coa.revision, symbolId }) : result;
  },
});
