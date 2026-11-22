// Contract every SymbolRenderer adapter must satisfy (driven port).
// fixtures: { validSidc, invalidSidc } — a SIDC this renderer recognises and a well-formed one it does not.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

export function describeSymbolRendererContract(name, makeRenderer, { validSidc, invalidSidc }) {
  describe(`SymbolRenderer contract: ${name}`, () => {
    const isFinitePositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

    it('renders a recognised SIDC as valid SVG with size and an anchor inside it', () => {
      const r = makeRenderer().render(validSidc, {});
      assert.equal(r.valid, true);
      assert.deepEqual(r.warnings, []);
      assert.match(r.svg, /^<svg[\s>]/);
      assert.ok(isFinitePositive(r.width) && isFinitePositive(r.height));
      assert.ok(r.anchor.x >= 0 && r.anchor.x <= r.width && r.anchor.y >= 0 && r.anchor.y <= r.height);
    });

    it('marks an unrecognised SIDC invalid with readable warnings, but still draws something', () => {
      const r = makeRenderer().render(invalidSidc, {});
      assert.equal(r.valid, false);
      assert.ok(r.warnings.length > 0 && r.warnings.every((w) => typeof w === 'string' && w.trim() !== ''));
      assert.match(r.svg, /^<svg[\s>]/);
    });

    it('never throws, whatever string it is given', () => {
      for (const sidc of ['', 'nope', '!!!', '1'.repeat(40)]) {
        assert.equal(typeof makeRenderer().render(sidc, {}).valid, 'boolean', sidc);
      }
    });

    it('draws bigger for a bigger size', () => {
      const renderer = makeRenderer();
      assert.ok(renderer.render(validSidc, { size: 80 }).width > renderer.render(validSidc, { size: 30 }).width);
    });

    it('draws the label and text modifiers into the SVG', () => {
      const { svg } = makeRenderer().render(validSidc, { label: 'A/1-5', modifiers: { higherFormation: '1-5 INF' } });
      assert.ok(svg.includes('A/1-5') && svg.includes('1-5 INF'));
    });

    it('returns plain JSON data', () => {
      const r = makeRenderer().render(validSidc, { label: 'X', modifiers: { direction: 45 } });
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
      assert.deepEqual(Object.keys(r).sort(), ['anchor', 'height', 'svg', 'valid', 'warnings', 'width']);
    });
  });
}
