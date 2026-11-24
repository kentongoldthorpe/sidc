import { defineMessage, checkId, checkRevision, checkSidcKnown, validationFailed } from '../message-definition.js';
import { addSymbol as addSymbolToCoa } from '../../domain/coa.js';
import { parseSymbolFields } from '../../domain/map-symbol.js';
import { ok } from '../../shared/result.js';

/**
 * symbol.add { coaId, expectedRevision, sidc, position, label?, modifiers? }
 *   → ok({ coaId, revision, symbol }); emits symbol.added with the same payload.
 */
export const addSymbol = defineMessage({
  kind: 'command', type: 'symbol.add', v: 1,
  required: ['coaId', 'expectedRevision', 'sidc', 'position'], optional: ['label', 'modifiers', 'facing', 'hvt', 'weapons', 'details'],
  async handle({ payload: { coaId, expectedRevision, ...fields }, ctx, ports: { coaStore, clock, ids, symbolRenderer } }) {
    const parsed = parseSymbolFields(fields);
    const problems = [
      ...checkId('coaId', coaId),
      ...checkRevision('expectedRevision', expectedRevision),
      ...parsed.problems,
    ];
    if (problems.length) return validationFailed('Invalid symbol.add payload', problems);
    const known = checkSidcKnown(symbolRenderer, parsed.value.sidc);
    if (!known.ok) return known;

    const loaded = await coaStore.get(coaId);
    if (!loaded.ok) return loaded;

    const added = addSymbolToCoa(loaded.value, { symbolId: ids.next('sym'), ...fields }, { now: clock.now() });
    if (!added.ok) return added;
    const { coa, events } = added.value;

    // The repository rejects a stale expectedRevision with CONFLICT.
    const saved = await coaStore.save(coa, { expectedRevision });
    if (!saved.ok) return saved;

    events.forEach((e) => ctx.emit(e));
    return ok(events[0].payload);
  },
});
