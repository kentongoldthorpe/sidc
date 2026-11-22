// COA-1.3 — Result type: errors are values.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ok, err, isOk, isErr, isResult } from '../../src/shared/result.js';
import { ErrorCode, appError } from '../../src/shared/errors.js';

describe('ok', () => {
  it('wraps a value in a frozen success result', () => {
    const r = ok(42);
    assert.deepEqual(r, { ok: true, value: 42 });
    assert.ok(Object.isFrozen(r));
  });

  it('keeps the value by reference without freezing it', () => {
    const value = { a: 1 };
    const r = ok(value);
    assert.equal(r.value, value);
    assert.ok(!Object.isFrozen(value));
  });

  it('defaults to an undefined value for void successes', () => {
    assert.deepEqual(ok(), { ok: true, value: undefined });
  });
});

describe('err', () => {
  it('wraps an app error in a frozen failure result', () => {
    const r = err(ErrorCode.NOT_FOUND, 'COA not found', { id: 'c-1' });
    assert.deepEqual(r, { ok: false, error: { code: 'NOT_FOUND', message: 'COA not found', details: { id: 'c-1' } } });
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.error));
  });

  it('accepts an existing app error, to propagate it unchanged', () => {
    const e = appError(ErrorCode.CONFLICT, 'Stale');
    assert.equal(err(e).error, e);
  });

  it('throws TypeError for an unknown code', () => {
    assert.throws(() => err('NOPE', 'x'), TypeError);
  });
});

describe('isOk / isErr / isResult', () => {
  const good = ok(1);
  const bad = err(ErrorCode.UNEXPECTED, 'boom');

  it('discriminates successes and failures', () => {
    assert.equal(isOk(good), true);
    assert.equal(isOk(bad), false);
    assert.equal(isErr(bad), true);
    assert.equal(isErr(good), false);
  });

  it('recognises results, including ones parsed from JSON', () => {
    assert.equal(isResult(good), true);
    assert.equal(isResult(JSON.parse(JSON.stringify(bad))), true);
  });

  for (const [name, v] of [
    ['null', null], ['plain object', { value: 1 }], ['truthy non-boolean ok', { ok: 1, value: 1 }],
    ['failure without valid error', { ok: false, error: { code: 'NOPE' } }],
  ]) it(`isResult rejects ${name}`, () => {
    assert.equal(isResult(v), false);
    assert.equal(isOk(v), false);
    assert.equal(isErr(v), false);
  });
});
