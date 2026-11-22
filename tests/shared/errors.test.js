// COA-1.3 — error codes and application errors.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCode, appError, isAppError } from '../../src/shared/errors.js';

const EXPECTED_CODES = [
  'VALIDATION_FAILED', 'INVALID_SIDC', 'NOT_FOUND', 'CONFLICT', 'UNKNOWN_MESSAGE_TYPE',
  'INVALID_ENVELOPE', 'STORAGE_UNAVAILABLE', 'STORAGE_QUOTA_EXCEEDED', 'IMPORT_INVALID',
  'UNSUPPORTED_VERSION', 'UNEXPECTED',
];

describe('ErrorCode', () => {
  it('contains exactly the codes from the epic, each mapped to its own name', () => {
    assert.deepEqual(Object.keys(ErrorCode).sort(), [...EXPECTED_CODES].sort());
    for (const code of EXPECTED_CODES) assert.equal(ErrorCode[code], code);
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(ErrorCode));
    assert.throws(() => { 'use strict'; ErrorCode.NEW = 'NEW'; }, TypeError);
  });
});

describe('appError', () => {
  it('builds a deep-frozen error with code, message and details', () => {
    const e = appError(ErrorCode.VALIDATION_FAILED, 'Name is required', { field: 'name', limits: { max: 120 } });
    assert.deepEqual(e, { code: 'VALIDATION_FAILED', message: 'Name is required', details: { field: 'name', limits: { max: 120 } } });
    assert.ok(Object.isFrozen(e) && Object.isFrozen(e.details) && Object.isFrozen(e.details.limits));
  });

  it('defaults details to an empty frozen object', () => {
    const e = appError(ErrorCode.NOT_FOUND, 'COA not found');
    assert.deepEqual(e.details, {});
    assert.ok(Object.isFrozen(e.details));
  });

  it('copies details so the caller\'s object is not frozen or shared', () => {
    const details = { field: 'name' };
    const e = appError(ErrorCode.VALIDATION_FAILED, 'x', details);
    assert.notEqual(e.details, details);
    assert.ok(!Object.isFrozen(details));
  });

  it('throws TypeError for an unknown code (programmer error)', () => {
    assert.throws(() => appError('NOPE', 'x'), { name: 'TypeError', message: /unknown error code "NOPE"/i });
    assert.throws(() => appError(undefined, 'x'), TypeError);
  });

  it('throws TypeError for a missing or blank message', () => {
    assert.throws(() => appError(ErrorCode.NOT_FOUND), TypeError);
    assert.throws(() => appError(ErrorCode.NOT_FOUND, '   '), TypeError);
  });

  it('throws TypeError when details are not a plain JSON object', () => {
    assert.throws(() => appError(ErrorCode.UNEXPECTED, 'x', [1]), TypeError);
    assert.throws(() => appError(ErrorCode.UNEXPECTED, 'x', 'oops'), TypeError);
    assert.throws(() => appError(ErrorCode.UNEXPECTED, 'x', { fn() {} }), TypeError);
  });

  it('survives a JSON round-trip', () => {
    const e = appError(ErrorCode.CONFLICT, 'Stale revision', { expected: 3, actual: 4 });
    assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
  });
});

describe('isAppError', () => {
  it('recognises app errors, including ones parsed from JSON', () => {
    const e = appError(ErrorCode.NOT_FOUND, 'missing');
    assert.equal(isAppError(e), true);
    assert.equal(isAppError(JSON.parse(JSON.stringify(e))), true);
  });

  for (const [name, v] of [
    ['null', null], ['an Error', new Error('x')], ['unknown code', { code: 'NOPE', message: 'x', details: {} }],
    ['missing details', { code: 'NOT_FOUND', message: 'x' }], ['blank message', { code: 'NOT_FOUND', message: '', details: {} }],
  ]) it(`rejects ${name}`, () => assert.equal(isAppError(v), false));
});
