// The test doubles must honour the same port contracts as the real adapters.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from './fixed-clock.js';
import { SequenceIdGenerator } from './sequence-id-generator.js';
import { describeClockContract } from '../contracts/clock.contract.js';
import { describeIdGeneratorContract } from '../contracts/id-generator.contract.js';

describeClockContract('FixedClock', () => new FixedClock());
describeIdGeneratorContract('SequenceIdGenerator', () => new SequenceIdGenerator());

describe('FixedClock', () => {
  it('returns the time it was given until advanced', () => {
    const clock = new FixedClock('2026-11-22T20:40:00.000Z');
    assert.equal(clock.now(), '2026-11-22T20:40:00.000Z');
    assert.equal(clock.now(), '2026-11-22T20:40:00.000Z');
    clock.advance(1500);
    assert.equal(clock.now(), '2026-11-22T20:40:01.500Z');
  });

  it('can be set to an exact time and rejects non-canonical input', () => {
    const clock = new FixedClock();
    clock.set('2030-01-01T00:00:00.000Z');
    assert.equal(clock.now(), '2030-01-01T00:00:00.000Z');
    assert.throws(() => clock.set('2030-01-01'), TypeError);
    assert.throws(() => new FixedClock('yesterday'), TypeError);
  });
});

describe('SequenceIdGenerator', () => {
  it('yields predictable prefixed ids from one shared counter', () => {
    const ids = new SequenceIdGenerator();
    assert.deepEqual([ids.next('msg'), ids.next('coa'), ids.next()], ['msg-1', 'coa-2', 'id-3']);
  });
});
