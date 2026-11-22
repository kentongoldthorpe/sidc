// Test double for the Clock port: time only moves when the test says so.
// (Tests may use Date; only the core is forbidden from it.)
import { isIsoUtcTimestamp } from '../../src/shared/envelope.js';

export class FixedClock {
  #ms;

  constructor(iso = '2026-01-01T00:00:00.000Z') { this.set(iso); }

  now() { return new Date(this.#ms).toISOString(); }

  set(iso) {
    if (!isIsoUtcTimestamp(iso)) throw new TypeError(`FixedClock: not a canonical ISO UTC timestamp: ${iso}`);
    this.#ms = Date.parse(iso);
  }

  advance(ms) { this.#ms += ms; }
}
