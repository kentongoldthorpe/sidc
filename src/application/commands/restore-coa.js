// coa.restore: put back a COA's content (undo / redo), or bring back a deleted COA.
import { defineMessage, checkId, staleRevision, validationFailed } from '../message-definition.js';
import { restoreCoa as restore, parseCoaContent } from '../../domain/coa.js';
import { mutateCoa } from './mutate-coa.js';
import { ok } from '../../shared/result.js';

/**
 * coa.restore { coaId, expectedRevision, content: { name, description, frame?, symbols, graphics } }
 *   expectedRevision 0 brings back a deleted COA under the same id (CONFLICT if it exists).
 *   → ok(Coa); emits coa.restored { coa } (nothing when the content is already the same).
 */
export const restoreCoa = defineMessage({
  kind: 'command', type: 'coa.restore', v: 1,
  required: ['coaId', 'expectedRevision', 'content'],
  async handle({ payload: { coaId, expectedRevision, content }, ctx, ports: { coaRepository, clock, symbolRenderer } }) {
    const parsed = parseCoaContent(content);
    const problems = [
      ...checkId('coaId', coaId),
      ...(Number.isInteger(expectedRevision) && expectedRevision >= 0 ? [] : [{ field: 'expectedRevision', reason: 'must be an integer ≥ 0 (0 brings back a deleted COA)' }]),
      ...parsed.problems,
      ...(parsed.value?.symbols ?? []).flatMap((s, i) => (symbolRenderer.render(s.sidc, {}).valid ? [] : [{ field: `content.symbols[${i}].sidc`, reason: 'is not a recognised symbol' }])),
    ];
    if (problems.length) return validationFailed('Invalid coa.restore payload', problems);

    if (expectedRevision === 0) {
      const existing = await coaRepository.get(coaId);
      if (existing.ok) return staleRevision(coaId, 0, existing.value.revision);
      if (existing.error.code !== 'NOT_FOUND') return existing;
      const restored = restore(null, { id: coaId, content }, { now: clock.now() });
      const saved = await coaRepository.save(restored.value.coa, { expectedRevision: 0 });
      if (!saved.ok) return saved;
      restored.value.events.forEach((e) => ctx.emit(e));
      return ok(restored.value.coa);
    }
    const result = await mutateCoa({
      coaRepository, ctx, coaId, expectedRevision,
      change: (coa) => restore(coa, { id: coaId, content }, { now: clock.now() }),
    });
    return result.ok ? ok(result.value.coa) : result;
  },
});
