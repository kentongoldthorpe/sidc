// The app client: the UI's single way into the application (a driving-side adapter helper).
//
//   client.send(type, payload, { source? })  → Promise<Result>   commands
//   client.ask(type, payload, { source? })   → Promise<Result>   queries
//   client.subscribe(pattern, fn)            → unsubscribe       app events
//   client.revisionOf(coaId)                 → number | undefined
//   client.close()                                               stop listening to app events
//
// It builds the envelopes, so views never deal with ids, timestamps or correlation. It remembers
// the latest revision of every COA it hears about (replies and events) and fills in expectedRevision
// for commands that need it. Commands for the same COA run one at a time, and expectedRevision is
// filled when a command actually runs, so rapid edits (drag, then rename) do not CONFLICT with each
// other. It never adopts the newer revision from a CONFLICT: the user must reload to see the change.
import { MESSAGES } from '../../application/create-application.js';
import { createEnvelope } from '../../shared/envelope.js';
import { ErrorCode, appError } from '../../shared/errors.js';

const KIND_BY_TYPE = new Map(MESSAGES.map((m) => [m.type, m.kind]));
const NEEDS_REVISION = new Set(MESSAGES.filter((m) => m.required.includes('expectedRevision')).map((m) => m.type));

const failure = (code, message, details) => Object.freeze({ ok: false, error: appError(code, message, details) });

/**
 * @param {{ dispatch: Function, query: Function, subscribe: Function }} app  from createApplication()
 * @param {{ clock: { now(): string }, ids: { next(prefix?: string): string }, source?: string }} options
 */
export function createAppClient(app, { clock, ids, source = 'ui' } = {}) {
  if (typeof app?.dispatch !== 'function' || typeof app?.query !== 'function' || typeof app?.subscribe !== 'function') {
    throw new TypeError('createAppClient: an application with dispatch, query and subscribe is required');
  }
  if (typeof clock?.now !== 'function') throw new TypeError('createAppClient: a Clock is required');
  if (typeof ids?.next !== 'function') throw new TypeError('createAppClient: an IdGenerator is required');

  /** @type {Map<string, number>} */
  const revisions = new Map();
  /** @type {Map<string, Promise<unknown>>} the tail of each COA's command queue */
  const queues = new Map();

  const remember = (coaId, revision) => {
    if (typeof coaId === 'string' && Number.isInteger(revision)) {
      revisions.set(coaId, Math.max(revisions.get(coaId) ?? 0, revision));
    }
  };
  const learn = (value) => {
    if (Array.isArray(value)) value.forEach(learn);
    else if (value !== null && typeof value === 'object') remember(value.coaId ?? value.id, value.revision);
  };

  const stopListening = app.subscribe('*', (event) => {
    if (event.type === 'coa.deleted') revisions.delete(event.payload.coaId);
    else learn(event.payload.coa ?? event.payload);
  });

  async function call(kind, type, payload, options = {}) {
    let envelope;
    try {
      envelope = createEnvelope(
        { kind, type, v: 1, payload, meta: { source: options.source ?? source } },
        { id: ids.next('msg'), now: clock.now() },
      );
    } catch (error) {
      return failure(ErrorCode.INVALID_ENVELOPE, 'The message could not be built', { cause: String(error.message ?? error) });
    }
    const reply = await (kind === 'query' ? app.query(envelope) : app.dispatch(envelope));
    const result = reply.payload;
    if (result.ok) {
      if (type === 'coa.delete') revisions.delete(payload.coaId);
      else learn(result.value);
    }
    return result;
  }

  const ask = (type, payload = {}, options) => call('query', type, payload, options);

  async function runCommand(type, payload, options) {
    if (NEEDS_REVISION.has(type) && payload !== null && typeof payload === 'object' && !('expectedRevision' in payload)) {
      if (!revisions.has(payload.coaId)) {
        const loaded = await ask('coa.get', { coaId: payload.coaId }, options);
        if (!loaded.ok) return loaded;
      }
      return call('command', type, { ...payload, expectedRevision: revisions.get(payload.coaId) }, options);
    }
    return call('command', type, payload, options);
  }

  function send(type, payload = {}, options) {
    const kind = KIND_BY_TYPE.get(type) ?? 'command';
    if (kind === 'query') return ask(type, payload, options);
    const coaId = payload?.coaId;
    if (typeof coaId !== 'string') return runCommand(type, payload, options);

    const previous = queues.get(coaId) ?? Promise.resolve();
    const run = previous.then(() => runCommand(type, payload, options));
    queues.set(coaId, run);
    run.then(() => { if (queues.get(coaId) === run) queues.delete(coaId); });
    return run;
  }

  return Object.freeze({
    send,
    ask,
    subscribe: (pattern, fn) => app.subscribe(pattern, fn),
    revisionOf: (coaId) => revisions.get(coaId),
    close: () => stopListening(),
  });
}
