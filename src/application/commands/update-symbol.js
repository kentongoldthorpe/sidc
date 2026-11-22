import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { updateSymbol as updateSymbolInCoa } from '../../domain/coa.js';
import { parseSymbolFields } from '../../domain/map-symbol.js';
import { mutateCoa } from './mutate-coa.js';
import { ok } from '../../shared/result.js';

/**
 * symbol.update { coaId, expectedRevision, symbolId, sidc?, label?, modifiers? }
 *   → ok({ coaId, revision, symbol }); emits symbol.updated { coaId, revision, symbol, changed }
 *   unless nothing changed. `modifiers` replaces the whole set. Position changes use symbol.move.
 */
export const updateSymbol = defineMessage({
  kind: 'command', type: 'symbol.update', v: 1,
  required: ['coaId', 'expectedRevision', 'symbolId'], optional: ['sidc', 'label', 'modifiers'],
  async handle({ payload: { coaId, expectedRevision, symbolId, ...changes }, ctx, ports: { coaRepository, clock } }) {
    const problems = [
      ...checkId('coaId', coaId),
      ...checkRevision('expectedRevision', expectedRevision),
      ...checkId('symbolId', symbolId),
      ...parseSymbolFields(changes).problems,
    ];
    if (problems.length) return validationFailed('Invalid symbol.update payload', problems);

    const result = await mutateCoa({
      coaRepository, ctx, coaId, expectedRevision,
      change: (coa) => updateSymbolInCoa(coa, { symbolId, ...changes }, { now: clock.now() }),
    });
    if (!result.ok) return result;
    const { coa } = result.value;
    return ok({ coaId, revision: coa.revision, symbol: coa.symbols.find((s) => s.id === symbolId) });
  },
});
