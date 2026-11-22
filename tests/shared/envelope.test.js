// COA-1.4 — Message envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MessageKind, createEnvelope, deriveEnvelope, createReply, createReplyToInvalid,
  validateEnvelope, isEnvelope, isMessageType, UNKNOWN_CAUSATION,
} from '../../src/shared/envelope.js';
import { ok, err } from '../../src/shared/result.js';
import { ErrorCode, appError } from '../../src/shared/errors.js';

const NOW = '2026-11-22T20:40:00.000Z';
const LATER = '2026-11-22T20:40:00.004Z';

const addSymbol = () => ({
  kind: 'command', type: 'symbol.add', v: 1,
  payload: { coaId: 'c-7', sidc: '10031000001211000000', position: { lat: 34.05, lng: -117.6 }, label: 'A/1-5' },
  meta: { source: 'ui.symbol-editor' },
});

const command = () => createEnvelope(addSymbol(), { id: 'm-01', now: NOW });

/** A valid envelope as plain mutable data, for table-driven invalid cases. */
const raw = () => JSON.parse(JSON.stringify(command()));

const problemsOf = (x) => {
  const r = validateEnvelope(x);
  assert.equal(r.ok, false, 'expected validation to fail');
  assert.equal(r.error.code, ErrorCode.INVALID_ENVELOPE);
  return r.error.details.problems;
};
const fieldsOf = (x) => problemsOf(x).map((p) => p.field);

describe('MessageKind', () => {
  it('lists the four kinds and is frozen', () => {
    assert.deepEqual(Object.values(MessageKind).sort(), ['command', 'event', 'query', 'reply']);
    assert.ok(Object.isFrozen(MessageKind));
  });
});

describe('createEnvelope', () => {
  it('builds a root envelope: correlationId = id, causationId = null, at = now', () => {
    assert.deepEqual(command(), {
      kind: 'command', type: 'symbol.add', v: 1,
      id: 'm-01', correlationId: 'm-01', causationId: null, at: NOW,
      payload: addSymbol().payload, meta: { source: 'ui.symbol-editor' },
    });
  });

  it('is deep-frozen', () => {
    const e = command();
    assert.ok(Object.isFrozen(e) && Object.isFrozen(e.payload) && Object.isFrozen(e.payload.position) && Object.isFrozen(e.meta));
  });

  it('copies payload and meta, leaving the caller\'s objects mutable and unshared', () => {
    const input = addSymbol();
    const e = createEnvelope(input, { id: 'm-01', now: NOW });
    assert.notEqual(e.payload, input.payload);
    assert.ok(!Object.isFrozen(input.payload) && !Object.isFrozen(input.payload.position));
  });

  it('throws TypeError listing every problem for invalid input (programmer error)', () => {
    assert.throws(
      () => createEnvelope({ kind: 'shout', type: 'Bad', v: 0, payload: [], meta: {} }, { id: '', now: 'yesterday' }),
      (e) => e instanceof TypeError && ['kind', 'type', 'v', 'id', 'at', 'payload', 'meta.source'].every((f) => e.message.includes(f)),
    );
  });

  it('rejects a reply built by hand (use createReply)', () => {
    assert.throws(() => createEnvelope({ ...addSymbol(), kind: 'reply', type: 'symbol.add.reply', payload: ok(1) }, { id: 'r', now: NOW }), TypeError);
  });
});

describe('deriveEnvelope', () => {
  it('keeps correlationId and sets causationId to the parent id', () => {
    const cmd = command();
    const evt = deriveEnvelope(cmd, {
      kind: 'event', type: 'symbol.added', v: 1,
      payload: { coaId: 'c-7', revision: 4 }, meta: { source: 'app' },
    }, { id: 'm-02', now: LATER });
    assert.equal(evt.correlationId, 'm-01');
    assert.equal(evt.causationId, 'm-01');
    assert.equal(evt.id, 'm-02');
    assert.equal(evt.at, LATER);
    assert.ok(isEnvelope(evt));
  });

  it('carries correlation through a chain of three messages', () => {
    const a = command();
    const b = deriveEnvelope(a, { kind: 'event', type: 'symbol.added', v: 1, payload: {}, meta: { source: 'app' } }, { id: 'm-02', now: NOW });
    const c = deriveEnvelope(b, { kind: 'command', type: 'coa.update', v: 1, payload: {}, meta: { source: 'app' } }, { id: 'm-03', now: NOW });
    assert.deepEqual([c.correlationId, c.causationId], ['m-01', 'm-02']);
  });

  it('throws TypeError when the parent is not a valid envelope', () => {
    assert.throws(() => deriveEnvelope({ id: 'x' }, addSymbol(), { id: 'm-02', now: NOW }), TypeError);
  });

  it('throws TypeError when the child reuses the parent id', () => {
    assert.throws(() => deriveEnvelope(command(), addSymbol(), { id: 'm-01', now: NOW }), TypeError);
  });
});

describe('createReply', () => {
  it('wraps a success Result as a reply caused by the request', () => {
    const reply = createReply(command(), ok({ symbolId: 's-3' }), { id: 'm-09', now: LATER });
    assert.deepEqual(reply, {
      kind: 'reply', type: 'symbol.add.reply', v: 1,
      id: 'm-09', correlationId: 'm-01', causationId: 'm-01', at: LATER,
      payload: { ok: true, value: { symbolId: 's-3' } }, meta: { source: 'app' },
    });
    assert.ok(Object.isFrozen(reply.payload.value));
  });

  it('wraps a failure Result', () => {
    const reply = createReply(command(), err(ErrorCode.NOT_FOUND, 'COA not found', { id: 'c-7' }), { id: 'm-09', now: LATER });
    assert.deepEqual(reply.payload, { ok: false, error: { code: 'NOT_FOUND', message: 'COA not found', details: { id: 'c-7' } } });
  });

  it('turns a void success into value: null so it survives JSON', () => {
    const reply = createReply(command(), ok(), { id: 'm-09', now: LATER });
    assert.deepEqual(reply.payload, { ok: true, value: null });
    assert.ok(isEnvelope(JSON.parse(JSON.stringify(reply))));
  });

  it('allows a custom meta.source', () => {
    assert.equal(createReply(command(), ok(1), { id: 'm-09', now: LATER, source: 'bus' }).meta.source, 'bus');
  });

  it('answers queries too', () => {
    const q = createEnvelope({ kind: 'query', type: 'coa.list', v: 1, payload: {}, meta: { source: 'ui' } }, { id: 'q-1', now: NOW });
    assert.equal(createReply(q, ok([]), { id: 'r-1', now: NOW }).type, 'coa.list.reply');
  });

  it('throws TypeError when replying to an event or reply, or with a non-Result', () => {
    const evt = deriveEnvelope(command(), { kind: 'event', type: 'symbol.added', v: 1, payload: {}, meta: { source: 'app' } }, { id: 'e-1', now: NOW });
    assert.throws(() => createReply(evt, ok(1), { id: 'r', now: NOW }), TypeError);
    assert.throws(() => createReply(command(), { value: 1 }, { id: 'r', now: NOW }), TypeError);
    assert.throws(() => createReply(command(), ok(() => 1), { id: 'r', now: NOW }), TypeError);
  });
});

describe('validateEnvelope', () => {
  it('returns ok(envelope) for a valid envelope', () => {
    const e = command();
    const r = validateEnvelope(e);
    assert.equal(r.ok, true);
    assert.equal(r.value, e);
  });

  it('accepts an envelope after a JSON round-trip (commands, events and replies)', () => {
    const cmd = command();
    const evt = deriveEnvelope(cmd, { kind: 'event', type: 'symbol.added', v: 1, payload: { n: 1 }, meta: { source: 'app', actor: 'local-user' } }, { id: 'm-02', now: LATER });
    const reply = createReply(cmd, err(ErrorCode.CONFLICT, 'Stale'), { id: 'm-03', now: LATER });
    for (const e of [cmd, evt, reply]) {
      const parsed = JSON.parse(JSON.stringify(e));
      assert.deepEqual(parsed, e);
      assert.equal(validateEnvelope(parsed).ok, true, e.type);
    }
  });

  for (const [name, value] of [['null', null], ['a string', 'envelope'], ['an array', []]]) {
    it(`rejects ${name} as a whole`, () => assert.deepEqual(fieldsOf(value), ['(root)']));
  }

  it('reports missing required fields', () => {
    assert.deepEqual(fieldsOf({}).sort(),
      ['at', 'causationId', 'correlationId', 'id', 'kind', 'meta', 'payload', 'type', 'v'].sort());
  });

  it('rejects unknown top-level fields (catches typos like "paylod")', () => {
    assert.deepEqual(fieldsOf({ ...raw(), paylod: {} }), ['paylod']);
  });

  const invalid = [
    ['kind', (e) => { e.kind = 'shout'; }],
    ['type', (e) => { e.type = 'symbol'; }],                       // needs at least two segments
    ['type', (e) => { e.type = 'Symbol.Add'; }],                   // lower case only
    ['type', (e) => { e.type = 'symbol..add'; }],
    ['type', (e) => { e.type = 'symbol.add-'; }],
    ['type', (e) => { e.type = 'symbol.add.reply'; }],             // only replies end in .reply
    ['v', (e) => { e.v = 0; }],
    ['v', (e) => { e.v = 1.5; }],
    ['v', (e) => { e.v = '1'; }],
    ['id', (e) => { e.id = '  '; }],
    ['id', (e) => { e.id = 'x'.repeat(129); }],
    ['correlationId', (e) => { e.correlationId = 7; }],
    ['correlationId', (e) => { e.correlationId = 'other'; }],      // root message must correlate to itself
    ['causationId', (e) => { e.causationId = ''; }],
    ['causationId', (e) => { e.causationId = e.id; }],             // cannot cause itself
    ['at', (e) => { e.at = '2026-11-22T20:40:00Z'; }],             // canonical toISOString form only
    ['at', (e) => { e.at = '2026-11-22T20:40:00.000+01:00'; }],
    ['at', (e) => { e.at = '2026-13-01T00:00:00.000Z'; }],
    ['at', (e) => { e.at = '2026-02-29T00:00:00.000Z'; }],         // 2026 is not a leap year
    ['at', (e) => { e.at = '2026-11-22T24:00:00.000Z'; }],
    ['at', (e) => { e.at = 1764000000000; }],
    ['payload', (e) => { e.payload = null; }],
    ['payload', (e) => { e.payload = [1]; }],
    ['payload', (e) => { e.payload = { when: new Map() }; }],
    ['payload', (e) => { e.payload = { n: NaN }; }],
    ['payload', (e) => { e.payload = { n: Infinity }; }],
    ['payload', (e) => { e.payload = { f() {} }; }],
    ['payload', (e) => { e.payload = { u: undefined }; }],
    ['payload', (e) => { e.payload = { big: 1n }; }],
    ['payload', (e) => { e.payload = { list: [1, , 3] }; }],                    // sparse array
    ['payload', (e) => { e.payload = { thing: new (class Thing {})() }; }],     // class instance
    ['payload', (e) => { e.payload = { [Symbol('s')]: 1 }; }],
    ['payload', (e) => { const p = {}; p.self = p; e.payload = p; }],           // cycle
    ['meta', (e) => { e.meta = null; }],
    ['meta.source', (e) => { e.meta = {}; }],
    ['meta.source', (e) => { e.meta.source = ' '; }],
    ['meta.actor', (e) => { e.meta.actor = 42; }],
    ['meta', (e) => { e.meta.extra = () => 1; }],
  ];
  for (const [field, mutate] of invalid) {
    it(`rejects invalid ${field}: ${mutate.toString().replace(/^\(e\) => \{ |; \}$/g, '')}`, () => {
      const e = raw(); mutate(e);
      assert.deepEqual(fieldsOf(e), [field]);
    });
  }

  it('accepts the same object referenced twice in a payload (shared, not cyclic)', () => {
    const shared = { x: 1 };
    assert.equal(validateEnvelope({ ...raw(), payload: { a: shared, b: shared } }).ok, true);
  });

  it('accepts a null-prototype payload object', () => {
    assert.equal(validateEnvelope({ ...raw(), payload: Object.assign(Object.create(null), { a: 1 }) }).ok, true);
  });

  it('accepts a leap day', () => {
    assert.equal(validateEnvelope({ ...raw(), at: '2028-02-29T23:59:59.999Z' }).ok, true);
  });

  it('accepts a type segment with hyphens and digits', () => {
    assert.equal(validateEnvelope({ ...raw(), type: 'coa.externally-changed2' }).ok, true);
  });

  describe('replies', () => {
    const rawReply = () => JSON.parse(JSON.stringify(createReply(command(), ok(1), { id: 'r-1', now: LATER })));

    it('requires a reply type to end in .reply', () => {
      assert.deepEqual(fieldsOf({ ...rawReply(), type: 'symbol.add' }), ['type']);
    });

    it('requires a causationId (the request)', () => {
      assert.deepEqual(fieldsOf({ ...rawReply(), causationId: null }), ['causationId']);
    });

    for (const [name, payload] of [
      ['a non-Result payload', { value: 1 }],
      ['a success without value', { ok: true }],
      ['a failure with an unknown code', { ok: false, error: { code: 'NOPE', message: 'x', details: {} } }],
    ]) it(`rejects ${name}`, () => assert.deepEqual(fieldsOf({ ...rawReply(), payload }), ['payload']));
  });

  it('reports every problem at once with a reason for each', () => {
    const problems = problemsOf({ ...raw(), kind: 'x', v: -1, at: 'now' });
    assert.deepEqual(problems.map((p) => p.field), ['kind', 'v', 'at']);
    for (const p of problems) assert.equal(typeof p.reason, 'string');
  });
});

describe('isEnvelope', () => {
  it('is a boolean shortcut for validateEnvelope', () => {
    assert.equal(isEnvelope(command()), true);
    assert.equal(isEnvelope({ ...raw(), v: 0 }), false);
  });
});

describe('isMessageType', () => {
  for (const t of ['coa.create', 'symbol.moved', 'coa.externally-changed', 'a.b.c'])
    it(`accepts ${t}`, () => assert.equal(isMessageType(t), true));
  for (const t of ['coa', 'Coa.create', 'coa.create.reply', 'coa..x', '', 42, null])
    it(`rejects ${JSON.stringify(t)}`, () => assert.equal(isMessageType(t), false));
});

describe('createReplyToInvalid', () => {
  const failure = appError(ErrorCode.INVALID_ENVELOPE, 'Invalid message envelope', { problems: [] });

  it('links to the request when its id, type and correlationId are usable', () => {
    const request = { ...raw(), v: 0 };
    const reply = createReplyToInvalid(request, failure, { id: 'r-1', now: LATER });
    assert.deepEqual(
      [reply.kind, reply.type, reply.correlationId, reply.causationId, reply.at],
      ['reply', 'symbol.add.reply', 'm-01', 'm-01', LATER]);
    assert.deepEqual(reply.payload, { ok: false, error: failure });
    assert.ok(isEnvelope(reply));
  });

  for (const [name, request] of [
    ['null', null], ['a string', 'junk'], ['an object with nothing usable', { id: '', type: 'BAD', correlationId: 5 }],
    ['a reply', { id: 'x', type: 'symbol.add.reply', correlationId: 'x' }],
  ]) it(`still builds a valid reply for ${name}`, () => {
    const reply = createReplyToInvalid(request, failure, { id: 'r-1', now: LATER });
    assert.ok(isEnvelope(reply));
    assert.equal(reply.type, 'invalid.message.reply');
    assert.equal(reply.correlationId, request?.id === 'x' ? 'x' : 'r-1');
    assert.equal(reply.causationId, request?.id === 'x' ? 'x' : UNKNOWN_CAUSATION);
  });

  it('does not let the request id collide with the reply id', () => {
    const reply = createReplyToInvalid({ id: 'r-1', type: 'coa.create', correlationId: 'r-1' }, failure, { id: 'r-1', now: LATER });
    assert.equal(reply.causationId, UNKNOWN_CAUSATION);
    assert.ok(isEnvelope(reply));
  });

  it('throws TypeError unless given an AppError', () => {
    assert.throws(() => createReplyToInvalid(null, new Error('x'), { id: 'r-1', now: LATER }), TypeError);
  });
});
