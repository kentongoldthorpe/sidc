// Clock adapter over the host's wall clock. Never goes backwards, even if the system time is set back.
/** @implements {import('../../application/ports/clock.js').Clock} */
export class SystemClock {
  #nowMs;
  #last = -Infinity;

  /** @param {() => number} [nowMs] milliseconds since the epoch (default Date.now) */
  constructor(nowMs = () => Date.now()) { this.#nowMs = nowMs; }

  now() {
    this.#last = Math.max(this.#last, this.#nowMs());
    return new Date(this.#last).toISOString();
  }
}
