import { defineMessage, checkId, validationFailed } from '../message-definition.js';

/** coa.get { coaId } → ok(Coa) | NOT_FOUND */
export const getCoa = defineMessage({
  kind: 'query', type: 'coa.get', v: 1,
  required: ['coaId'],
  async handle({ payload: { coaId }, ports: { coaRepository } }) {
    const problems = checkId('coaId', coaId);
    if (problems.length) return validationFailed('Invalid coa.get payload', problems);
    return coaRepository.get(coaId);
  },
});
