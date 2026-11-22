// Real Clock and IdGenerator adapters: the same contracts as the test doubles, plus their edge cases.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SystemClock } from '../../../src/adapters/system/system-clock.js';
import { CryptoIdGenerator } from '../../../src/adapters/system/crypto-id-generator.js';
import { describeClockContract } from '../../contracts/clock.contract.js';
import { describeIdGeneratorContract } from '../../contracts/id-generator.contract.js';

describeClockContract('SystemClock', () => new SystemClock());
describeIdGeneratorContract('CryptoIdGenerator (randomUUID)', () => new CryptoIdGenerator(globalThis.crypto));
const withoutRandomUuid = { getRandomValues: (a) => globalThis.crypto.getRandomValues(a) };
describeIdGeneratorContract('CryptoIdGenerator (getRandomValues fallback)', () => new CryptoIdGenerator(withoutRandomUuid));

describe('SystemClock', () => {
  it('never goes backwards even if the system clock is set back', () => {
    const readings = [Date.parse('2026-11-22T20:40:00.000Z'), Date.parse('2026-11-22T20:39:00.000Z')];
    const clock = new SystemClock(() => readings.shift());
    assert.deepEqual([clock.now(), clock.now()], ['2026-11-22T20:40:00.000Z', '2026-11-22T20:40:00.000Z']);
  });
});

describe('CryptoIdGenerator', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  for (const [name, crypto] of [['randomUUID', globalThis.crypto], ['getRandomValues fallback', withoutRandomUuid]]) {
    it(`makes "<prefix>-<uuid v4>" ids (${name})`, () => {
      const [prefix, ...rest] = new CryptoIdGenerator(crypto).next('coa').split('-');
      assert.equal(prefix, 'coa');
      assert.match(rest.join('-'), UUID_V4);
    });
  }

  it('uses "id" when no prefix is given', () => {
    assert.match(new CryptoIdGenerator(globalThis.crypto).next(), /^id-/);
  });

  it('requires a crypto object with getRandomValues', () => {
    assert.throws(() => new CryptoIdGenerator(undefined), TypeError);
    assert.throws(() => new CryptoIdGenerator({}), TypeError);
  });
});
