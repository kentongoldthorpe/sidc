// IdGenerator adapter: "<prefix>-<uuid v4>". Uses crypto.randomUUID where available; falls back to
// crypto.getRandomValues (randomUUID needs a secure context, e.g. not a plain-http LAN address).

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function uuidFromRandomValues(crypto) {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** @implements {import('../../application/ports/id-generator.js').IdGenerator} */
export class CryptoIdGenerator {
  #uuid;

  /** @param {Crypto} crypto e.g. globalThis.crypto */
  constructor(crypto) {
    if (typeof crypto?.getRandomValues !== 'function') throw new TypeError('CryptoIdGenerator: crypto.getRandomValues is required');
    this.#uuid = typeof crypto.randomUUID === 'function' ? () => crypto.randomUUID() : () => uuidFromRandomValues(crypto);
  }

  next(prefix = 'id') { return `${prefix}-${this.#uuid()}`; }
}
