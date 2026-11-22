// COA-1.5 — In-process message bus.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageBus } from '../../../src/application/bus/message-bus.js';
import { createEnvelope, deriveEnvelope, isEnvelope, UNKNOWN_CAUSATION } from '../../../src/shared/envelope.js';
import { ok, err } from '../../../src/shared/result.js';
import { ErrorCode } from '../../../src/shared/errors.js';
import { FixedClock } from '../../support/fixed-clock.js';
import { SequenceIdGenerator } from '../../support/sequence-id-generator.js';

const NOW = '2026-11-22T20:40:00.000Z';

function setup(options = {}) {
  const clock = new FixedClock(NOW);
  const ids = new SequenceIdGenerator();
  const bus = createMessageBus({ clock, ids, ...options });
  return { bus, clock, ids };
}

const command = (type = 'coa.create', payload = { name: 'COA 1' }, meta = { source: 'test' }) =>
  createEnvelope({ kind: 'command', type, v: 1, payload, meta }, { id: 'c-1', now: NOW });
const query = (type = 'coa.list', payload = {}) =>
  createEnvelope({ kind: 'query', type, v: 1, payload, meta: { source: 'test' } }, { id: 'q-1', now: NOW });

/** Every reply must be a valid, frozen envelope — check it on the way out. */
async function send(promise) {
  const reply = await promise;
  assert.ok(isEnvelope(reply), `not a valid envelope: ${JSON.stringify(reply)}`);
  assert.ok(Object.isFrozen(reply));
  assert.equal(reply.kind, 'reply');
  return reply;
}

const recorder = () => {
  const calls = [];
  const fn = (e) => { calls.push(e); };
  return Object.assign(fn, { calls });
};

describe('createMessageBus', () => {
  it('requires a Clock and an IdGenerator', () => {
    assert.throws(() => createMessageBus({ ids: new SequenceIdGenerator() }), TypeError);
    assert.throws(() => createMessageBus({ clock: new FixedClock() }), TypeError);
    assert.throws(() => createMessageBus(), TypeError);
  });
});

describe('registration', () => {
  it('rejects a second handler for the same type, across commands and queries', () => {
    const { bus } = setup();
    bus.registerCommand('coa.create', () => ok());
    assert.throws(() => bus.registerCommand('coa.create', () => ok()), { name: 'TypeError', message: /already registered.*coa\.create/ });
    assert.throws(() => bus.registerQuery('coa.create', () => ok()), TypeError);
  });

  it('rejects invalid types and non-function handlers', () => {
    const { bus } = setup();
    for (const type of ['coa', 'Coa.Create', 'coa.create.reply', '']) {
      assert.throws(() => bus.registerCommand(type, () => ok()), TypeError, type);
    }
    assert.throws(() => bus.registerQuery('coa.list', 'not a function'), TypeError);
  });
});

describe('dispatch', () => {
  it('routes a command to its handler and replies with the handler result', async () => {
    const { bus } = setup();
    const seen = [];
    bus.registerCommand('coa.create', (envelope) => { seen.push(envelope); return ok({ id: 'coa-9' }); });
    bus.registerCommand('coa.delete', () => assert.fail('wrong handler'));

    const cmd = command();
    const reply = await send(bus.dispatch(cmd));

    assert.deepEqual(seen, [cmd]);
    assert.deepEqual(reply, {
      kind: 'reply', type: 'coa.create.reply', v: 1, id: 'msg-1',
      correlationId: 'c-1', causationId: 'c-1', at: NOW,
      payload: { ok: true, value: { id: 'coa-9' } }, meta: { source: 'bus' },
    });
  });

  it('supports async handlers', async () => {
    const { bus } = setup();
    bus.registerCommand('coa.create', async () => { await Promise.resolve(); return ok('done'); });
    assert.equal((await send(bus.dispatch(command()))).payload.value, 'done');
  });

  it('passes a handler failure through unchanged', async () => {
    const { bus } = setup();
    bus.registerCommand('coa.create', () => err(ErrorCode.VALIDATION_FAILED, 'Name is required', { field: 'name' }));
    const reply = await send(bus.dispatch(command()));
    assert.deepEqual(reply.payload, {
      ok: false, error: { code: 'VALIDATION_FAILED', message: 'Name is required', details: { field: 'name' } },
    });
  });

  it('replies UNKNOWN_MESSAGE_TYPE when no handler is registered', async () => {
    const { bus } = setup();
    const reply = await send(bus.dispatch(command('coa.explode')));
    assert.equal(reply.payload.error.code, ErrorCode.UNKNOWN_MESSAGE_TYPE);
    assert.deepEqual(reply.payload.error.details, { type: 'coa.explode' });
  });

  describe('never rejects: failures become UNEXPECTED replies', () => {
    for (const [name, handler, cause] of [
      ['a handler that throws', () => { throw new Error('boom'); }, 'boom'],
      ['an async handler that rejects', async () => { throw new Error('later boom'); }, 'later boom'],
      ['a handler that throws a non-Error', () => { throw 'oops'; }, 'oops'],
      ['a handler that returns a non-Result', () => ({ id: 1 }), 'handler did not return a Result'],
      ['a handler that returns nothing', () => undefined, 'handler did not return a Result'],
      ['a handler whose value is not JSON', () => ok({ when: new Map() }), 'result value must be plain JSON data'],
    ]) {
      it(name, async () => {
        const { bus } = setup();
        bus.registerCommand('coa.create', handler);
        const reply = await send(bus.dispatch(command()));
        assert.equal(reply.payload.error.code, ErrorCode.UNEXPECTED);
        assert.equal(reply.payload.error.details.type, 'coa.create');
        assert.match(reply.payload.error.details.cause, new RegExp(cause));
      });
    }
  });

  it('replies INVALID_ENVELOPE, without calling the handler, for an invalid envelope', async () => {
    const { bus } = setup();
    bus.registerCommand('coa.create', () => assert.fail('handler must not run'));
    const bad = { ...JSON.parse(JSON.stringify(command())), v: 0 };
    const reply = await send(bus.dispatch(bad));
    assert.equal(reply.payload.error.code, ErrorCode.INVALID_ENVELOPE);
    assert.deepEqual(reply.payload.error.details.problems.map((p) => p.field), ['v']);
    assert.deepEqual([reply.type, reply.causationId, reply.correlationId], ['coa.create.reply', 'c-1', 'c-1']);
  });

  for (const [name, junk] of [['null', null], ['undefined', undefined], ['a number', 7], ['an empty object', {}]]) {
    it(`still resolves with a valid reply for ${name}`, async () => {
      const reply = await send(setup().bus.dispatch(junk));
      assert.equal(reply.payload.error.code, ErrorCode.INVALID_ENVELOPE);
      assert.equal(reply.causationId, UNKNOWN_CAUSATION);
    });
  }

  it('rejects a query envelope (use bus.query)', async () => {
    const { bus } = setup();
    bus.registerQuery('coa.list', () => assert.fail('must not run'));
    const reply = await send(bus.dispatch(query()));
    assert.equal(reply.payload.error.code, ErrorCode.INVALID_ENVELOPE);
    assert.deepEqual(reply.payload.error.details.problems, [{ field: 'kind', reason: 'dispatch() expects a command' }]);
  });

  it('does not route a command to a query handler of the same type', async () => {
    const { bus } = setup();
    bus.registerQuery('coa.list', () => assert.fail('must not run'));
    const reply = await send(bus.dispatch(command('coa.list')));
    assert.equal(reply.payload.error.code, ErrorCode.UNKNOWN_MESSAGE_TYPE);
  });
});

describe('query', () => {
  it('routes a query to its handler and replies', async () => {
    const { bus } = setup();
    bus.registerQuery('coa.list', () => ok([{ id: 'coa-1' }]));
    const reply = await send(bus.query(query()));
    assert.deepEqual([reply.type, reply.causationId, reply.payload], ['coa.list.reply', 'q-1', { ok: true, value: [{ id: 'coa-1' }] }]);
  });

  it('rejects a command envelope (use bus.dispatch)', async () => {
    const { bus } = setup();
    const reply = await send(bus.query(command()));
    assert.deepEqual(reply.payload.error.details.problems, [{ field: 'kind', reason: 'query() expects a query' }]);
  });

  it('does not let a query emit events', async () => {
    const { bus } = setup();
    const sub = recorder();
    bus.subscribe('*', sub);
    bus.registerQuery('coa.list', (_e, ctx) => { ctx.emit({ type: 'coa.listed', v: 1, payload: {} }); return ok([]); });
    const reply = await send(bus.query(query()));
    assert.equal(reply.payload.error.code, ErrorCode.UNEXPECTED);
    assert.match(reply.payload.error.details.cause, /queries cannot emit events/);
    assert.equal(sub.calls.length, 0);
  });
});

describe('events emitted by command handlers', () => {
  const emitTwo = (_cmd, ctx) => {
    ctx.emit({ type: 'coa.created', v: 1, payload: { id: 'coa-9' } });
    ctx.emit({ type: 'symbol.added', v: 2, payload: { symbolId: 's-1' } });
    return ok({ id: 'coa-9' });
  };

  it('are published to subscribers in order, as envelopes derived from the command', async () => {
    const { bus } = setup();
    const sub = recorder();
    bus.subscribe('*', sub);
    bus.registerCommand('coa.create', emitTwo);
    await send(bus.dispatch(command('coa.create', { name: 'x' }, { source: 'ui', actor: 'local-user' })));

    assert.deepEqual(sub.calls.map((e) => [e.kind, e.type, e.v, e.correlationId, e.causationId]), [
      ['event', 'coa.created', 1, 'c-1', 'c-1'],
      ['event', 'symbol.added', 2, 'c-1', 'c-1'],
    ]);
    for (const e of sub.calls) {
      assert.ok(isEnvelope(e) && Object.isFrozen(e));
      assert.deepEqual(e.meta, { source: 'app', actor: 'local-user' });
    }
    assert.deepEqual(sub.calls.map((e) => e.payload), [{ id: 'coa-9' }, { symbolId: 's-1' }]);
  });

  it('are delivered before dispatch resolves', async () => {
    const { bus } = setup();
    const log = [];
    bus.subscribe('coa.created', async () => { await Promise.resolve(); log.push('subscriber'); });
    bus.registerCommand('coa.create', emitTwo);
    await bus.dispatch(command());
    log.push('reply');
    assert.deepEqual(log, ['subscriber', 'reply']);
  });

  for (const [name, handler] of [
    ['the handler returns a failure', (_c, ctx) => { ctx.emit({ type: 'coa.created', v: 1, payload: {} }); return err(ErrorCode.CONFLICT, 'Stale'); }],
    ['the handler throws', (_c, ctx) => { ctx.emit({ type: 'coa.created', v: 1, payload: {} }); throw new Error('save failed'); }],
    ['an emitted event is invalid', (_c, ctx) => { ctx.emit({ type: 'coa.created', v: 1, payload: {} }); ctx.emit({ type: 'Bad', v: 1, payload: {} }); return ok(); }],
  ]) {
    it(`are discarded when ${name}`, async () => {
      const { bus } = setup();
      const sub = recorder();
      bus.subscribe('*', sub);
      bus.registerCommand('coa.create', handler);
      const reply = await send(bus.dispatch(command()));
      assert.equal(reply.payload.ok, false);
      assert.equal(sub.calls.length, 0);
    });
  }

  it('cannot be emitted after the handler has returned', async () => {
    const { bus } = setup();
    const sub = recorder();
    bus.subscribe('*', sub);
    let leakedCtx;
    bus.registerCommand('coa.create', (_c, ctx) => { leakedCtx = ctx; return ok(); });
    await bus.dispatch(command());
    assert.throws(() => leakedCtx.emit({ type: 'coa.created', v: 1, payload: {} }), TypeError);
    assert.equal(sub.calls.length, 0);
  });
});

describe('subscribe', () => {
  async function deliver(pattern, types) {
    const { bus } = setup();
    const sub = recorder();
    bus.subscribe(pattern, sub);
    bus.registerCommand('test.run', (_c, ctx) => { for (const type of types) ctx.emit({ type, v: 1, payload: {} }); return ok(); });
    await bus.dispatch(command('test.run'));
    return sub.calls.map((e) => e.type);
  }

  const ALL = ['coa.created', 'symbol.added', 'symbol.moved', 'symbols.added', 'symbol.label.changed'];

  it('matches an exact type', async () => assert.deepEqual(await deliver('symbol.added', ALL), ['symbol.added']));
  it('matches a prefix wildcard on whole segments', async () =>
    assert.deepEqual(await deliver('symbol.*', ALL), ['symbol.added', 'symbol.moved', 'symbol.label.changed']));
  it('matches everything with *', async () => assert.deepEqual(await deliver('*', ALL), ALL));

  it('rejects invalid patterns and non-function subscribers', () => {
    const { bus } = setup();
    for (const p of ['', 'symbol', 'symbol.*.x', 'Symbol.*', '*.added', 'symbol.**', 'x.reply']) {
      assert.throws(() => bus.subscribe(p, () => {}), TypeError, p);
    }
    assert.throws(() => bus.subscribe('*', null), TypeError);
  });

  it('calls subscribers in subscription order, awaiting each one', async () => {
    const { bus } = setup();
    const log = [];
    bus.subscribe('*', async (e) => { await new Promise((r) => setImmediate(r)); log.push(`slow:${e.type}`); });
    bus.subscribe('coa.*', (e) => log.push(`fast:${e.type}`));
    bus.registerCommand('test.run', (_c, ctx) => {
      ctx.emit({ type: 'coa.created', v: 1, payload: {} });
      ctx.emit({ type: 'coa.updated', v: 1, payload: {} });
      return ok();
    });
    await bus.dispatch(command('test.run'));
    assert.deepEqual(log, ['slow:coa.created', 'fast:coa.created', 'slow:coa.updated', 'fast:coa.updated']);
  });

  it('isolates failing subscribers: others still run, the reply is unaffected, onError is told', async () => {
    const errors = [];
    const { bus } = setup({ onError: (error, event) => errors.push([error.message, event.type]) });
    const sub = recorder();
    bus.subscribe('*', () => { throw new Error('sync fail'); });
    bus.subscribe('*', async () => { throw new Error('async fail'); });
    bus.subscribe('*', sub);
    bus.registerCommand('coa.create', (_c, ctx) => { ctx.emit({ type: 'coa.created', v: 1, payload: {} }); return ok('fine'); });

    const reply = await send(bus.dispatch(command()));
    assert.equal(reply.payload.value, 'fine');
    assert.equal(sub.calls.length, 1);
    assert.deepEqual(errors, [['sync fail', 'coa.created'], ['async fail', 'coa.created']]);
  });

  it('survives an onError callback that itself throws', async () => {
    const { bus } = setup({ onError: () => { throw new Error('logger down'); } });
    bus.subscribe('*', () => { throw new Error('fail'); });
    bus.registerCommand('coa.create', (_c, ctx) => { ctx.emit({ type: 'coa.created', v: 1, payload: {} }); return ok(); });
    assert.equal((await send(bus.dispatch(command()))).payload.ok, true);
  });

  it('returns an idempotent unsubscribe', async () => {
    const { bus } = setup();
    const sub = recorder();
    const unsubscribe = bus.subscribe('*', sub);
    unsubscribe();
    unsubscribe();
    bus.registerCommand('coa.create', (_c, ctx) => { ctx.emit({ type: 'coa.created', v: 1, payload: {} }); return ok(); });
    await bus.dispatch(command());
    assert.equal(sub.calls.length, 0);
  });

  it('treats the same function subscribed twice as two subscriptions', async () => {
    const { bus } = setup();
    const sub = recorder();
    const first = bus.subscribe('*', sub);
    bus.subscribe('*', sub);
    first();
    bus.registerCommand('coa.create', (_c, ctx) => { ctx.emit({ type: 'coa.created', v: 1, payload: {} }); return ok(); });
    await bus.dispatch(command());
    assert.equal(sub.calls.length, 1);
  });

  it('stops delivering to a subscriber unsubscribed by an earlier one during the same event', async () => {
    const { bus } = setup();
    const victim = recorder();
    let unsubscribeVictim;
    bus.subscribe('*', () => unsubscribeVictim());
    unsubscribeVictim = bus.subscribe('*', victim);
    bus.registerCommand('coa.create', (_c, ctx) => { ctx.emit({ type: 'coa.created', v: 1, payload: {} }); return ok(); });
    await bus.dispatch(command());
    assert.equal(victim.calls.length, 0);
  });

  it('does not deliver the current event to a subscriber added while it is being delivered', async () => {
    const { bus } = setup();
    const late = recorder();
    bus.subscribe('*', () => { bus.subscribe('*', late); });
    bus.registerCommand('coa.create', (_c, ctx) => {
      ctx.emit({ type: 'coa.created', v: 1, payload: {} });
      ctx.emit({ type: 'coa.updated', v: 1, payload: {} });
      return ok();
    });
    await bus.dispatch(command());
    assert.deepEqual(late.calls.map((e) => e.type), ['coa.updated']);
  });
});

describe('publish', () => {
  const event = () => deriveEnvelope(command(), { kind: 'event', type: 'coa.externally-changed', v: 1, payload: { id: 'coa-1' }, meta: { source: 'storage' } }, { id: 'e-1', now: NOW });

  it('delivers an event envelope from an adapter to subscribers', async () => {
    const { bus } = setup();
    const sub = recorder();
    bus.subscribe('coa.*', sub);
    const e = event();
    assert.deepEqual(await bus.publish(e), { ok: true, value: undefined });
    assert.deepEqual(sub.calls, [e]);
  });

  for (const [name, value] of [['a command', command()], ['an invalid envelope', { type: 'coa.created' }], ['null', null]]) {
    it(`refuses ${name} with INVALID_ENVELOPE and delivers nothing`, async () => {
      const { bus } = setup();
      const sub = recorder();
      bus.subscribe('*', sub);
      const result = await bus.publish(value);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, ErrorCode.INVALID_ENVELOPE);
      assert.equal(sub.calls.length, 0);
    });
  }
});

describe('middleware', () => {
  it('runs in registration order around the handler', async () => {
    const { bus } = setup();
    const log = [];
    bus.use(async (envelope, next) => { log.push(`a>${envelope.type}`); const r = await next(); log.push('a<'); return r; });
    bus.use(async (_e, next) => { log.push('b>'); const r = await next(); log.push('b<'); return r; });
    bus.registerCommand('coa.create', () => { log.push('handler'); return ok(); });
    await bus.dispatch(command());
    assert.deepEqual(log, ['a>coa.create', 'b>', 'handler', 'b<', 'a<']);
  });

  it('wraps queries too, and sees unknown types before routing', async () => {
    const { bus } = setup();
    const seen = [];
    bus.use((e, next) => { seen.push(e.type); return next(); });
    bus.registerQuery('coa.list', () => ok([]));
    await bus.query(query());
    const reply = await send(bus.dispatch(command('coa.explode')));
    assert.deepEqual(seen, ['coa.list', 'coa.explode']);
    assert.equal(reply.payload.error.code, ErrorCode.UNKNOWN_MESSAGE_TYPE);
  });

  it('can short-circuit with a failure; the handler does not run', async () => {
    const { bus } = setup();
    bus.use(() => err(ErrorCode.VALIDATION_FAILED, 'Read-only mode'));
    bus.registerCommand('coa.create', () => assert.fail('must not run'));
    const reply = await send(bus.dispatch(command()));
    assert.equal(reply.payload.error.message, 'Read-only mode');
  });

  it('only ever sees valid envelopes: validation runs first, by default', async () => {
    const { bus } = setup();
    bus.use(() => assert.fail('middleware must not see an invalid envelope'));
    const reply = await send(bus.dispatch({ ...JSON.parse(JSON.stringify(command())), at: 'now' }));
    assert.equal(reply.payload.error.code, ErrorCode.INVALID_ENVELOPE);
  });

  for (const [name, mw, cause] of [
    ['throws', () => { throw new Error('mw boom'); }, 'mw boom'],
    ['returns a non-Result', () => 'nope', 'middleware did not return a Result'],
    ['calls next() twice', async (_e, next) => { await next(); return next(); }, 'next\\(\\) called more than once'],
  ]) {
    it(`turns middleware that ${name} into UNEXPECTED`, async () => {
      const { bus } = setup();
      bus.use(mw);
      bus.registerCommand('coa.create', () => ok());
      const reply = await send(bus.dispatch(command()));
      assert.equal(reply.payload.error.code, ErrorCode.UNEXPECTED);
      assert.match(reply.payload.error.details.cause, new RegExp(cause));
    });
  }

  it('rejects non-function middleware', () => {
    assert.throws(() => setup().bus.use({}), TypeError);
  });
});
