import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze, isJsonValue, cloneJson } from '../../src/shared/freeze.js';

describe('deepFreeze', () => {
  it('freezes nested objects and arrays and returns the same reference', () => {
    const o = { a: { b: [1, { c: 2 }] } };
    assert.equal(deepFreeze(o), o);
    assert.ok(Object.isFrozen(o) && Object.isFrozen(o.a) && Object.isFrozen(o.a.b) && Object.isFrozen(o.a.b[1]));
  });

  it('recurses into children of an already-frozen parent', () => {
    const child = { x: 1 };
    deepFreeze(Object.freeze({ child }));
    assert.ok(Object.isFrozen(child));
  });

  it('handles cycles and primitives', () => {
    const o = { n: 1 }; o.self = o;
    assert.equal(deepFreeze(o), o);
    assert.equal(deepFreeze(5), 5);
    assert.equal(deepFreeze(null), null);
  });
});

describe('isJsonValue', () => {
  for (const [name, v] of [
    ['string', 's'], ['finite number', 1.5], ['boolean', false], ['null', null],
    ['nested plain data', { a: [1, 'two', { three: null }] }], ['null-prototype object', Object.assign(Object.create(null), { a: 1 })],
  ]) it(`accepts ${name}`, () => assert.equal(isJsonValue(v), true));

  for (const [name, v] of [
    ['undefined', undefined], ['NaN', NaN], ['Infinity', Infinity], ['function', () => 1],
    ['symbol', Symbol('s')], ['bigint', 1n], ['Map', new Map()], ['class instance', new (class X {})()],
    ['undefined property', { a: undefined }], ['nested NaN', { a: [NaN] }], ['sparse array', [1, , 3]],
  ]) it(`rejects ${name}`, () => assert.equal(isJsonValue(v), false));

  it('rejects cycles', () => {
    const o = {}; o.o = o;
    assert.equal(isJsonValue(o), false);
  });

  it('accepts the same object referenced twice (a DAG, not a cycle)', () => {
    const shared = { x: 1 };
    assert.equal(isJsonValue({ a: shared, b: shared }), true);
  });
});

describe('cloneJson', () => {
  it('returns a deep, frozen copy without freezing the original', () => {
    const original = { a: { b: [1, 2] } };
    const copy = cloneJson(original);
    assert.deepEqual(copy, original);
    assert.notEqual(copy.a, original.a);
    assert.ok(Object.isFrozen(copy.a.b));
    assert.ok(!Object.isFrozen(original) && !Object.isFrozen(original.a));
  });

  it('throws TypeError for non-JSON input', () => {
    assert.throws(() => cloneJson({ f() {} }), TypeError);
  });
});
