// graphic.add, graphic.update, graphic.remove: lines, areas and range rings on a COA.
import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import { addGraphic as addToCoa, updateGraphic as updateInCoa, removeGraphic as removeFromCoa, graphicById } from '../../domain/coa.js';
import { parseNewGraphic, parseGraphicFields } from '../../domain/graphic.js';
import { mutateCoa } from './mutate-coa.js';
import { ok } from '../../shared/result.js';

const GRAPHIC_FIELDS = ['kind', 'side', 'color', 'label', 'points', 'center', 'radius'];

/**
 * graphic.add { coaId, expectedRevision, kind, side?, color?, label?, points? | center?, radius? }
 *   → ok({ coaId, revision, graphic }); emits graphic.added with the same payload.
 */
export const addGraphic = defineMessage({
  kind: 'command', type: 'graphic.add', v: 1,
  required: ['coaId', 'expectedRevision'], optional: GRAPHIC_FIELDS,
  async handle({ payload: { coaId, expectedRevision, ...fields }, ctx, ports: { coaRepository, clock, ids } }) {
    const problems = [...checkId('coaId', coaId), ...checkRevision('expectedRevision', expectedRevision), ...parseNewGraphic(fields).problems];
    if (problems.length) return validationFailed('Invalid graphic.add payload', problems);
    const result = await mutateCoa({
      coaRepository, ctx, coaId, expectedRevision,
      change: (coa) => addToCoa(coa, { graphicId: ids.next('gfx'), ...fields }, { now: clock.now() }),
    });
    return result.ok ? ok(result.value.events[0].payload) : result;
  },
});

/**
 * graphic.update { coaId, expectedRevision, graphicId, kind?, side?, color? (null: side colour), label?, points? | center?, radius? }
 *   → ok({ coaId, revision, graphic, changed }); emits graphic.updated with the same payload (none for a no-op).
 */
export const updateGraphic = defineMessage({
  kind: 'command', type: 'graphic.update', v: 1,
  required: ['coaId', 'expectedRevision', 'graphicId'], optional: GRAPHIC_FIELDS,
  async handle({ payload: { coaId, expectedRevision, graphicId, ...changes }, ctx, ports: { coaRepository, clock } }) {
    const problems = [
      ...checkId('coaId', coaId), ...checkRevision('expectedRevision', expectedRevision), ...checkId('graphicId', graphicId),
      ...parseGraphicFields(changes, undefined, { allowNullColor: true }).problems,
    ];
    if (problems.length) return validationFailed('Invalid graphic.update payload', problems);
    const result = await mutateCoa({
      coaRepository, ctx, coaId, expectedRevision,
      change: (coa) => updateInCoa(coa, { graphicId, ...changes }, { now: clock.now() }),
    });
    if (!result.ok) return result;
    const [event] = result.value.events;
    return ok(event ? event.payload : { coaId, revision: result.value.coa.revision, graphic: graphicById(result.value.coa, graphicId), changed: [] });
  },
});

/** graphic.remove { coaId, expectedRevision, graphicId } → ok({ coaId, revision, graphicId }); emits graphic.removed. */
export const removeGraphic = defineMessage({
  kind: 'command', type: 'graphic.remove', v: 1,
  required: ['coaId', 'expectedRevision', 'graphicId'],
  async handle({ payload: { coaId, expectedRevision, graphicId }, ctx, ports: { coaRepository, clock } }) {
    const problems = [...checkId('coaId', coaId), ...checkRevision('expectedRevision', expectedRevision), ...checkId('graphicId', graphicId)];
    if (problems.length) return validationFailed('Invalid graphic.remove payload', problems);
    const result = await mutateCoa({
      coaRepository, ctx, coaId, expectedRevision,
      change: (coa) => removeFromCoa(coa, { graphicId }, { now: clock.now() }),
    });
    return result.ok ? ok({ coaId, revision: result.value.coa.revision, graphicId }) : result;
  },
});
