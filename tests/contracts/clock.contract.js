// Contract every Clock adapter must satisfy. Usage: describeClockContract('SystemClock', () => new SystemClock())
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isIsoUtcTimestamp } from '../../src/shared/envelope.js';

export function describeClockContract(name, makeClock) {
  describe(`Clock contract: ${name}`, () => {
    it('now() returns a canonical ISO-8601 UTC timestamp', () => {
      assert.ok(isIsoUtcTimestamp(makeClock().now()));
    });

    it('now() never goes backwards', () => {
      const clock = makeClock();
      const a = clock.now(); const b = clock.now();
      assert.ok(b >= a, `${b} < ${a}`); // canonical ISO strings sort chronologically
    });
  });
}
