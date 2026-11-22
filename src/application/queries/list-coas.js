import { defineMessage } from '../message-definition.js';

/** coa.list {} → ok(CoaSummary[]) most recently updated first */
export const listCoas = defineMessage({
  kind: 'query', type: 'coa.list', v: 1,
  async handle({ ports: { coaRepository } }) {
    return coaRepository.list();
  },
});
