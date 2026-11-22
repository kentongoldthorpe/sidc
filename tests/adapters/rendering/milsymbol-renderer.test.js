// The real renderer against the vendored milsymbol bundle (asSVG needs no DOM).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MilsymbolRenderer } from '../../../src/adapters/rendering/milsymbol-renderer.js';
import { describeSymbolRendererContract } from '../../contracts/symbol-renderer.contract.js';

const ms = createRequire(import.meta.url)('../../../vendor/milsymbol/milsymbol.js');
const make = () => new MilsymbolRenderer(ms);

describeSymbolRendererContract('MilsymbolRenderer', make, {
  validSidc: '10031000001211000000',   // friendly infantry
  invalidSidc: '10031000009999990000', // unknown entity
});

describe('MilsymbolRenderer specifics', () => {
  for (const [name, sidc] of [
    ['hostile armour (2525D)', '10061000001205000000'],
    ['friendly infantry (2525E, 30 digits)', '130310000016110000000000000000'],
    ['friendly infantry (2525C)', 'SFGPUCI----D---'],
    ['2525C with * placeholders', 'SHGPUCAA--*****'],
  ]) {
    it(`recognises ${name}`, () => assert.equal(make().render(sidc, {}).valid, true));
  }

  it('treats an unknown symbol set as invalid even though milsymbol alone accepts it', () => {
    const r = make().render('10039900000000000000', {});
    assert.equal(r.valid, false);
    assert.ok(r.warnings.some((w) => /symbol set/i.test(w)));
  });

  it('explains each part milsymbol could not recognise', () => {
    const { warnings } = make().render('99999999999999999999', {});
    assert.ok(warnings.some((w) => /icon/i.test(w)) && warnings.some((w) => /affiliation/i.test(w)));
  });

  it('draws the direction-of-movement arrow when direction is set', () => {
    const plain = make().render('10031000001211000000', {}).svg;
    assert.notEqual(make().render('10031000001211000000', { modifiers: { direction: 90 } }).svg, plain);
  });

  it('requires the milsymbol library to be injected', () => {
    assert.throws(() => new MilsymbolRenderer(undefined), TypeError);
  });
});
