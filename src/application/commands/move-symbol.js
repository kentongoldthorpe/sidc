import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { moveSymbol as moveSymbolInCoa } from '../../domain/coa.js';
import { parseSymbolFields } from '../../domain/map-symbol.js';
import { mutateCoa } from './mutate-coa.js';
import { ok } from '../../shared/result.js';

/**
 * symbol.move { coaId, expectedRevision, symbolId, position }
 *   → ok({ coaId, revision, symbol }); emits symbol.moved { coaId, revision, symbolId, from, to }
 *   unless the position is unchanged.
 */
export const moveSymbol = defineMessage({
  kind: 'command', type: 'symbol.move', v: 1,
  required: ['coaId', 'expectedRevision', 'symbolId', 'position'],
  async handle({ payload: { coaId, expectedRevision, symbolId, position }, ctx, ports: { coaRepository, clock } }) {
    const problems = [
      ...checkId('coaId', coaId),
      ...checkRevision('expectedRevision', expectedRevision),
      ...checkId('symbolId', symbolId),
      ...parseSymbolFields({ position }).problems,
    ];
    if (problems.length) return validationFailed('Invalid symbol.move payload', problems);

    const result = await mutateCoa({
      coaRepository, ctx, coaId, expectedRevision,
      change: (coa) => moveSymbolInCoa(coa, { symbolId, position }, { now: clock.now() }),
    });
    if (!result.ok) return result;
    const { coa } = result.value;
    return ok({ coaId, revision: coa.revision, symbol: coa.symbols.find((s) => s.id === symbolId) });
  },
});
