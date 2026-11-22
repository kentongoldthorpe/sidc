// Drives the application only through its boundary: envelopes in, replies and events out.
import assert from 'node:assert/strict';
import { createApplication } from '../../src/application/create-application.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { createEnvelope, isEnvelope } from '../../src/shared/envelope.js';
import { FixedClock } from './fixed-clock.js';
import { SequenceIdGenerator } from './sequence-id-generator.js';
import { StubRenderer } from './stub-renderer.js';

export const T0 = '2026-11-22T20:40:00.000Z';
/** Well-formed, but the harness renderer does not recognise it. */
export const UNKNOWN_SIDC = '10031000009999990000';

export function createHarness({
  coaRepository = new InMemoryCoaRepository(),
  symbolRenderer = new StubRenderer({ invalid: [UNKNOWN_SIDC] }),
} = {}) {
  const clock = new FixedClock(T0);
  const ids = new SequenceIdGenerator();
  const app = createApplication({ clock, ids, coaRepository, symbolRenderer });

  const events = [];
  app.subscribe('*', (e) => { events.push(e); });

  let n = 0;
  const envelope = (kind, type, payload, v = 1) =>
    createEnvelope({ kind, type, v, payload, meta: { source: 'test' } }, { id: `t-${++n}`, now: clock.now() });

  return {
    app, clock, events,
    /** @returns {Promise<Envelope>} the reply */
    dispatch: (type, payload, { v } = {}) => checked(app.dispatch(envelope('command', type, payload, v))),
    query: (type, payload = {}, { v } = {}) => checked(app.query(envelope('query', type, payload, v))),
    /** Events published since the last call. */
    takeEvents: () => events.splice(0),
  };
}

async function checked(promise) {
  const reply = await promise;
  assert.ok(isEnvelope(reply), 'reply is not a valid envelope');
  return reply;
}

/** Assert a success reply and return its value. */
export function okValue(reply) {
  assert.equal(reply.payload.ok, true, `expected ok, got ${JSON.stringify(reply.payload.error)}`);
  return reply.payload.value;
}

/** Assert a failure reply with `code` and return the error. */
export function errorOf(reply, code) {
  assert.equal(reply.payload.ok, false, `expected ${code}, got ok: ${JSON.stringify(reply.payload.value)}`);
  assert.equal(reply.payload.error.code, code, JSON.stringify(reply.payload.error));
  return reply.payload.error;
}

/** Fields named in a VALIDATION_FAILED / INVALID_ENVELOPE error. */
export const problemFields = (error) => error.details.problems.map((p) => p.field);
