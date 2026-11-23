// The common path for commands that change an existing COA:
//   load → stale-revision check → apply the domain change → save (only if something changed) → emit.
// Checking the revision before applying means a client with a stale view always gets CONFLICT,
// even when the change would be a no-op or would target a symbol someone else removed.
import { staleRevision } from '../message-definition.js';
import { ok } from '../../shared/result.js';

/**
 * @param {{ coaStore: Object, ctx: { emit: Function }, coaId: string, expectedRevision: number,
 *           change: (coa: Object) => import('../../shared/result.js').Result<{ coa: Object, events: Object[] }> }} args
 * @returns {Promise<import('../../shared/result.js').Result<{ coa: Object, events: Object[] }>>}
 */
export async function mutateCoa({ coaStore, ctx, coaId, expectedRevision, change }) {
  const loaded = await coaStore.get(coaId);
  if (!loaded.ok) return loaded;
  if (loaded.value.revision !== expectedRevision) return staleRevision(coaId, expectedRevision, loaded.value.revision);

  const changed = change(loaded.value);
  if (!changed.ok) return changed;
  const { coa, events } = changed.value;

  if (events.length > 0) {
    const saved = await coaStore.save(coa, { expectedRevision });
    if (!saved.ok) return saved;
    events.forEach((e) => ctx.emit(e));
  }
  return ok({ coa, events });
}
