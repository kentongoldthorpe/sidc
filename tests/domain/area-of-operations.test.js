// E6-6: the area of operations.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAo, boxAo, insideAo, itemsOutside } from '../../src/domain/area-of-operations.js';
import { parseMgrs, toUtm, mgrsOf } from '../../src/domain/mgrs.js';

const at = (m) => { const { lat, lng } = parseMgrs(m); return { lat, lng }; };
const AO = { name: 'AO IRON', points: boxAo(at('18S UJ 2000 0000'), at('18S UJ 3000 1000')) };

describe('area of operations', () => {
  it('checks its name and points, which may be grids', () => {
    const ok = parseAo({ name: ' AO IRON ', points: [{ mgrs: '18S UJ 2000 0000' }, { lat: 38.9, lng: -77 }, { mgrs: '18S UJ 2500 1000' }] });
    assert.equal(ok.value.name, 'AO IRON');
    assert.equal(ok.value.points.length, 3);
    assert.deepEqual(parseAo({ points: [{ lat: 1, lng: 1 }] }).problems.map((p) => p.field), ['ao.points']);
    assert.deepEqual(parseAo({ points: [{ mgrs: 'x' }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }], extra: 1 }).problems.map((p) => p.field), ['ao.extra', 'ao.points[0].mgrs']);
    assert.match(parseAo(null).problems[0].reason, /null to clear/);
  });
  it('makes a box square to the grid from two corners, as a map sheet is', () => {
    const corners = AO.points.map((p) => toUtm(p));
    assert.deepEqual(corners.map((u) => [Math.round(u.easting), Math.round(u.northing)]), [[320005, 4300005], [330005, 4300005], [330005, 4310005], [320005, 4310005]]);
    assert.equal(mgrsOf(AO.points[0]), '18S UJ 2000 0000', 'the corner reads back as typed');
  });
  it('tells inside from outside, and lists what is outside by name', () => {
    assert.equal(insideAo(at('18S UJ 2500 0500'), AO), true);
    assert.equal(insideAo(at('18S UJ 3500 0500'), AO), false);
    assert.equal(insideAo(at('18S UJ 2500 5000'), AO), false, 'a transposed digit');
    const coa = { symbols: [{ id: 'a', label: 'In', position: at('18S UJ 2500 0500') }, { id: 'b', label: 'Out', position: at('18S UJ 3500 0500') }],
      graphics: [{ id: 'g', kind: 'phaseLine', label: 'PL', points: [at('18S UJ 2100 0500'), at('18S UJ 3100 0500')] }, { id: 'r', kind: 'rangeRing', label: 'R', center: at('18S UJ 2500 0500'), radius: 9000 }] };
    assert.deepEqual(itemsOutside(coa, AO).map((x) => [x.kind, x.name]), [['unit', 'Out'], ['line', 'PL']]);
    assert.deepEqual(itemsOutside(coa, null), []);
  });
});
