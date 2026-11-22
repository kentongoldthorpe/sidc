// In-process message bus: the driving port of the hexagon.
//
//   bus.registerCommand(type, handler)   one handler per type (commands and queries share a namespace)
//   bus.registerQuery(type, handler)
//   bus.dispatch(commandEnvelope) → Promise<reply envelope>   never rejects
//   bus.query(queryEnvelope)      → Promise<reply envelope>   never rejects
//   bus.publish(eventEnvelope)    → Promise<Result<void>>     for adapters that observe outside change
//   bus.subscribe(pattern, fn)    → unsubscribe               "coa.created" | "symbol.*" | "*"
//   bus.use(middleware)                                       (envelope, next) => Result | Promise<Result>
//
// Handlers: (envelope, ctx) => Result | Promise<Result>. Command handlers call
// ctx.emit({ type, v, payload }) to record domain events. The bus publishes them only
// after the handler returns ok — so subscribers never hear about a change that failed —
// in emit order, before the dispatch promise resolves.
//
// Pipeline: envelope validation (always first) → middleware in registration order → routing → handler.
import {
  MessageKind, createReply, createReplyToInvalid, deriveEnvelope, isMessageType, validateEnvelope,
} from '../../shared/envelope.js';
import { ErrorCode, appError } from '../../shared/errors.js';
import { ok, err, isResult } from '../../shared/result.js';

/** @typedef {import('../../shared/envelope.js').Envelope} Envelope */
/** @typedef {import('../../shared/result.js').Result<unknown>} Result */
/** @typedef {{ emit: (event: { type: string, v: number, payload: Object }) => void }} HandlerContext */
/** @typedef {(envelope: Envelope, ctx: HandlerContext) => Result | Promise<Result>} Handler */
/** @typedef {(envelope: Envelope, next: () => Promise<Result>) => Result | Promise<Result>} Middleware */

const REPLY_SOURCE = 'bus';
const EVENT_SOURCE = 'app';
const WILDCARD_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*\.\*$/;

/** Thrown inside the pipeline for contract breaches; reported as UNEXPECTED. */
class PipelineFault extends Error {}

function compilePattern(pattern) {
  if (pattern === '*') return () => true;
  if (isMessageType(pattern)) return (type) => type === pattern;
  if (typeof pattern === 'string' && WILDCARD_PATTERN.test(pattern)) {
    const prefix = pattern.slice(0, -1); // keep the trailing dot: "symbol." never matches "symbols.x"
    return (type) => type.startsWith(prefix);
  }
  throw new TypeError(`subscribe: invalid pattern "${String(pattern)}" (use "a.b", "a.*" or "*")`);
}

const unexpected = (type, error) => err(ErrorCode.UNEXPECTED, `Unexpected error while handling "${type}"`, {
  type, cause: error instanceof Error ? error.message : String(error),
});

/**
 * @param {{ clock: import('../ports/clock.js').Clock,
 *           ids: import('../ports/id-generator.js').IdGenerator,
 *           onError?: (error: unknown, event: Envelope) => void }} deps
 *   onError is told about subscribers that throw; it must not affect the bus.
 */
export function createMessageBus({ clock, ids, onError = () => {} } = {}) {
  if (typeof clock?.now !== 'function') throw new TypeError('createMessageBus: a Clock with now() is required');
  if (typeof ids?.next !== 'function') throw new TypeError('createMessageBus: an IdGenerator with next() is required');
  if (typeof onError !== 'function') throw new TypeError('createMessageBus: onError must be a function');

  /** @type {Map<string, { kind: string, handler: Handler }>} */
  const handlers = new Map();
  /** @type {Middleware[]} */
  const middlewares = [];
  /** @type {{ matches: (type: string) => boolean, fn: Function, active: boolean }[]} */
  let subscriptions = [];

  const stamp = () => ({ id: ids.next('msg'), now: clock.now() });

  function register(kind, type, handler) {
    if (!isMessageType(type)) throw new TypeError(`register: invalid message type "${String(type)}"`);
    if (typeof handler !== 'function') throw new TypeError(`register: handler for "${type}" must be a function`);
    if (handlers.has(type)) throw new TypeError(`register: a handler is already registered for "${type}"`);
    handlers.set(type, { kind, handler });
  }

  async function deliver(event) {
    const matching = subscriptions.filter((s) => s.matches(event.type)); // snapshot
    for (const s of matching) {
      if (!s.active) continue;
      try {
        await s.fn(event);
      } catch (error) {
        try { onError(error, event); } catch { /* a failing error reporter must not break delivery */ }
      }
    }
  }

  async function runPipeline(request, ctx) {
    const route = async () => {
      const entry = handlers.get(request.type);
      if (!entry || entry.kind !== request.kind) {
        return err(ErrorCode.UNKNOWN_MESSAGE_TYPE, `No ${request.kind} handler for "${request.type}"`, { type: request.type });
      }
      const result = await entry.handler(request, ctx);
      if (!isResult(result)) throw new PipelineFault('handler did not return a Result');
      return result;
    };

    const chain = [...middlewares]; // snapshot
    const run = async (i) => {
      if (i === chain.length) return route();
      let called = false;
      const next = () => {
        if (called) throw new PipelineFault('next() called more than once');
        called = true;
        return run(i + 1);
      };
      const result = await chain[i](request, next);
      if (!isResult(result)) throw new PipelineFault('middleware did not return a Result');
      return result;
    };
    return run(0);
  }

  /** Shared path for dispatch() and query(). Always resolves with a valid reply envelope. */
  async function send(request, expectedKind, method) {
    const validation = validateEnvelope(request);
    if (!validation.ok) return createReplyToInvalid(request, validation.error, { ...stamp(), source: REPLY_SOURCE });
    if (request.kind !== expectedKind) {
      const error = appError(ErrorCode.INVALID_ENVELOPE, 'Invalid message envelope', {
        problems: [{ field: 'kind', reason: `${method}() expects a ${expectedKind}` }],
      });
      return createReplyToInvalid(request, error, { ...stamp(), source: REPLY_SOURCE });
    }

    const emitted = [];
    let open = true;
    const eventMeta = { source: EVENT_SOURCE, ...('actor' in request.meta ? { actor: request.meta.actor } : {}) };
    const ctx = Object.freeze({
      emit({ type, v, payload } = {}) {
        if (expectedKind === MessageKind.QUERY) throw new TypeError('queries cannot emit events');
        if (!open) throw new TypeError('emit() called after the handler finished');
        emitted.push(deriveEnvelope(request, { kind: MessageKind.EVENT, type, v, payload, meta: eventMeta }, stamp()));
      },
    });

    let result;
    try {
      result = await runPipeline(request, ctx);
    } catch (error) {
      result = unexpected(request.type, error);
    } finally {
      open = false;
    }

    let reply;
    try {
      reply = createReply(request, result, { ...stamp(), source: REPLY_SOURCE });
    } catch (error) {
      result = unexpected(request.type, error);
      reply = createReply(request, result, { ...stamp(), source: REPLY_SOURCE });
    }

    if (result.ok) for (const event of emitted) await deliver(event);
    return reply;
  }

  return Object.freeze({
    /** @param {string} type @param {Handler} handler */
    registerCommand: (type, handler) => register(MessageKind.COMMAND, type, handler),
    /** @param {string} type @param {Handler} handler */
    registerQuery: (type, handler) => register(MessageKind.QUERY, type, handler),

    /** @param {Envelope} command @returns {Promise<Readonly<Envelope>>} */
    dispatch: (command) => send(command, MessageKind.COMMAND, 'dispatch'),
    /** @param {Envelope} query @returns {Promise<Readonly<Envelope>>} */
    query: (query) => send(query, MessageKind.QUERY, 'query'),

    /** @param {Envelope} event @returns {Promise<Result>} */
    async publish(event) {
      const validation = validateEnvelope(event);
      if (!validation.ok) return validation;
      if (event.kind !== MessageKind.EVENT) {
        return err(ErrorCode.INVALID_ENVELOPE, 'Invalid message envelope', {
          problems: [{ field: 'kind', reason: 'publish() expects an event' }],
        });
      }
      await deliver(event);
      return ok();
    },

    /** @param {string} pattern @param {(event: Envelope) => void | Promise<void>} fn @returns {() => void} */
    subscribe(pattern, fn) {
      const matches = compilePattern(pattern);
      if (typeof fn !== 'function') throw new TypeError('subscribe: subscriber must be a function');
      const subscription = { matches, fn, active: true };
      subscriptions = [...subscriptions, subscription];
      return () => {
        subscription.active = false;
        subscriptions = subscriptions.filter((s) => s !== subscription);
      };
    },

    /** @param {Middleware} middleware */
    use(middleware) {
      if (typeof middleware !== 'function') throw new TypeError('use: middleware must be a function');
      middlewares.push(middleware);
    },
  });
}
