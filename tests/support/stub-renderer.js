// Test double for the SymbolRenderer port: deterministic SVG text, configurable unknown SIDCs.
const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class StubRenderer {
  #invalid;

  /** @param {{ invalid?: string[] }} [options] SIDCs to report as unrecognised */
  constructor({ invalid = [] } = {}) { this.#invalid = new Set(invalid); }

  render(sidc, { label = '', modifiers = {}, size = 40 } = {}) {
    const width = size * 1.5;
    const height = size;
    const text = [sidc, label, ...Object.values(modifiers)].map(escapeXml).join(' ');
    const valid = this.#invalid.has(sidc) === false && /^[A-Z0-9*-]+$/.test(sidc);
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text>${text}</text></svg>`,
      valid,
      warnings: valid ? [] : [`Stub renderer does not recognise "${sidc}"`],
      anchor: { x: width / 2, y: height / 2 },
      width,
      height,
    };
  }
}
