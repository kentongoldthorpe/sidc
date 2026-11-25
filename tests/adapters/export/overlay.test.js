// E6-4: overlays at map scale.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overlaySheets, overlayHtml, mapArea } from '../../../src/adapters/export/overlay.js';
import { parseMgrs, toUtm } from '../../../src/domain/mgrs.js';

const at = (mgrs) => { const { lat, lng } = parseMgrs(mgrs); return { lat, lng }; };
const HEADER = { classification: 'SECRET', classificationColor: '#c8102e', project: 'P <1>', dtg: '251400ZNOV26' };
const SYM = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30"/></svg>', anchor: { x: 20, y: 15 }, width: 40, height: 30 };
const COA = {
  id: 'c', name: 'COA 1 <N>', symbols: [
    { id: 'a', sidc: 'x', label: '1 MRC', position: at('18S UJ 2300 0600'), modifiers: {}, hvt: true },
    { id: 'b', sidc: 'x', label: '2 MRC', position: at('18S UJ 2500 0700'), modifiers: {}, weapons: [{ name: 'Gun', role: 'direct', maxRange: 3000, arc: 360 }] },
  ],
  graphics: [{ id: 'g', kind: 'phaseLine', side: 'hostile', label: 'PL GOLD', annotation: 'H+2', points: [at('18S UJ 2200 0650'), at('18S UJ 2600 0650')] }],
};

describe('overlay sheets', () => {
  it('puts the map area inside the page, banners and checks', () => {
    assert.deepEqual(mapArea('letter', 'landscape'), { pageW: 279.4, pageH: 215.9, w: 257.4, h: 146.9 });
    assert.equal(mapArea('a4', 'portrait').w, 188);
  });

  it('covers the COA at scale: at 1:50 000 a 257.4 mm sheet is 12.87 km', () => {
    const layout = overlaySheets(COA, { scale: 50000 });
    assert.equal(layout.zone, 18);
    assert.deepEqual([layout.rows, layout.cols], [1, 1]);
    const [s] = layout.sheets;
    assert.ok(Math.abs((s.e1 - s.e0) - 12870) < 1e-6 && Math.abs((s.n1 - s.n0) - 7345) < 1e-6, JSON.stringify(s));
    assert.equal(s.e0 % 100, 0, 'starts on a 100 m line');
    const a = toUtm(COA.symbols[0].position);
    assert.ok(a.easting > s.e0 && a.easting < s.e1 && a.northing > s.n0 && a.northing < s.n1);
  });

  it('tiles a larger COA over sheets, north to south and west to east; nothing to print is null', () => {
    const wide = { ...COA, symbols: [...COA.symbols, { ...COA.symbols[0], id: 'c', position: at('18S UJ 6000 0600') }] };
    const layout = overlaySheets(wide, { scale: 25000 });
    assert.deepEqual([layout.rows, layout.cols], [1, 7]);
    assert.ok(layout.sheets[1].e0 === layout.sheets[0].e1);
    assert.equal(overlaySheets({ ...COA, symbols: [], graphics: [] }), null);
  });
});

describe('overlayHtml', () => {
  const html = overlayHtml({ coa: COA, symbols: [SYM, SYM], scale: 50000, header: HEADER, fingerprint: 'K7Q3-MD2A' });

  it('draws the map in millimetres at scale: 1 km between crosses is 20 mm at 1:50 000', () => {
    assert.match(html, /<svg class="map" xmlns="http:\/\/www.w3.org\/2000\/svg" width="257.4mm" height="146.9mm" viewBox="0 0 257.4 146.9">/);
    const xs = [...html.matchAll(/<path class="cross" d="M([\d.]+) ([\d.]+)h3.2/g)].map((m) => Number(m[1]) + 1.6);
    const distinct = [...new Set(xs.map((x) => x.toFixed(2)))].map(Number).sort((a, b) => a - b);
    assert.ok(distinct.length >= 12);
    for (let i = 1; i < distinct.length; i++) assert.ok(Math.abs(distinct[i] - distinct[i - 1] - 20) < 0.02, `${distinct[i - 1]} → ${distinct[i]}`);
  });

  it('places items where the grid says: a unit at 18S UJ 2300 0600 sits on the 23 / 06 crossing', () => {
    const cross = [...html.matchAll(/<path class="cross" d="M([\d.]+) ([\d.]+)h3.2/g)].map((m) => [Number(m[1]) + 1.6, Number(m[2])]);
    const unitAt = /<image x="([\d.]+)" y="([\d.]+)" width="9" height="6.75"/.exec(html);
    const ux = Number(unitAt[1]) + 4.5;
    const uy = Number(unitAt[2]) + 3.375;
    // The grid names the 10 m square's centre: 5 m from the crossing, 0.1 mm at 1:50 000.
    assert.ok(cross.some(([cx, cy]) => Math.abs(cx - ux) < 0.15 && Math.abs(cy - uy) < 0.15), `unit at ${ux}, ${uy}`);
  });

  it('numbers the grid along the edges, gives a corner reference, and draws lines, labels and HVT', () => {
    assert.match(html, /<text class="edge" x="[\d.]+" y="3.2" text-anchor="middle">23<\/text>/);
    assert.match(html, /<text class="ref" [^>]*>18S UJ \d\d \d\d<\/text>/);
    assert.match(html, /<path class="graphic" d="M[\d. L]+" stroke="#d0021b" fill="none" stroke-dasharray="2.4 1.4"\/>/);
    assert.match(html, /<text class="label note"[^>]*>H\+2<\/text>/);
    assert.match(html, />1 MRC \(HVT\)</);
    assert.doesNotMatch(html, /class="weapon"/, 'weapon ranges only when asked');
    assert.match(overlayHtml({ coa: COA, symbols: [SYM, SYM], weapons: true, header: HEADER }), /class="weapon"/);
  });

  it('carries the marking, scale, grid zone, version and the 100 mm check on every sheet, escaping text', () => {
    assert.match(html, /<div class="banner">SECRET<\/div>/);
    assert.match(html, /Scale <b>1:50,000<\/b>/);
    assert.match(html, /UTM zone 18N, WGS 84/);
    assert.match(html, /<b class="fp">K7Q3-MD2A<\/b>/);
    assert.match(html, /This bar must measure exactly 100 mm \(5 km at 1:50,000\)/);
    assert.match(html, /<svg width="104mm" height="9mm"/);
    assert.match(html, /Overlay: COA 1 &lt;N&gt;/);
    assert.doesNotMatch(html, /<script/);
    assert.match(overlayHtml({ coa: COA, symbols: [], scale: 25000, paper: 'a4', orientation: 'portrait', header: HEADER }), /@page \{ size: A4 portrait/);
  });
});
