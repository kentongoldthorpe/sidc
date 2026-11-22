// Test double for the IdGenerator port: predictable ids "<prefix>-1", "<prefix>-2", …
export class SequenceIdGenerator {
  #n = 0;

  next(prefix = 'id') { this.#n += 1; return `${prefix}-${this.#n}`; }
}
