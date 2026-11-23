// COA-6a.2: the slide layout. Pure function → display list (rects, text, lines, images in slide pixels).
// The display list is the boundary between layout and painting (PNG now; SVG/.pptx later).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSlide, SLIDE_SIZES, formatDtg, slideFileName } from '../../../src/adapters/export/slide-layout.js';

const MARKING = { text: 'UNCLASSIFIED', color: '#007a33' };
const FRAME = { aspect: '16:9', center: { lat: 34.1, lng: -117.3 }, width: 0.4 };
const unit = (id, lat, lng, label = id) => ({ id, sidc: '10031000001211000000', position: { lat, lng }, label, modifiers: {} });
const COA = { id: 'coa-1', name: 'COA 1 – Envelopment', symbols: [unit('A', 34.1, -117.3), unit('B', 34.15, -117.2), unit('far', 10, 10)] };
const SYMBOL = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"></svg>', width: 40, height: 30, anchor: { x: 20, y: 15 } };
const symbolsFor = (coa) => coa.symbols.map(() => SYMBOL);
const DTG = '230215ZNOV26';

const slide = (overrides = {}) => {
  const coa = overrides.coa ?? COA;
  return layoutSlide({ coa, frame: FRAME, marking: MARKING, dtg: DTG, symbols: symbolsFor(coa), ...overrides });
};
const byRole = (s, role) => s.items.filter((i) => i.role === role);
const one = (s, role) => { const found = byRole(s, role); assert.equal(found.length, 1, `${role}: ${found.length}`); return found[0]; };
const inside = (item, box) => item.x >= box.x && item.y >= box.y && item.x + (item.w ?? 0) <= box.x + box.w && item.y + (item.h ?? 0) <= box.y + box.h;

describe('slide size', () => {
  for (const [aspect, size] of Object.entries({ '16:9': [1920, 1080], '4:3': [1600, 1200], '5:4': [1500, 1200] })) {
    it(`is ${size.join('×')} for ${aspect}`, () => {
      assert.deepEqual(SLIDE_SIZES[aspect], size);
      const s = slide({ frame: { ...FRAME, aspect } });
      assert.deepEqual([s.width, s.height], size);
    });
  }
});

describe('classification banners', () => {
  it('runs full width at the top and the bottom, in the marking colour', () => {
    const s = slide();
    const top = one(s, 'banner-top');
    const bottom = one(s, 'banner-bottom');
    assert.deepEqual([top.x, top.y, top.w, top.fill], [0, 0, 1920, '#007a33']);
    assert.deepEqual([bottom.x, bottom.y + bottom.h, bottom.w, bottom.fill], [0, 1080, 1920, '#007a33']);
    assert.ok(top.h >= 30, 'readable height');
  });

  it('carries the marking text, centred, in a readable colour', () => {
    const texts = byRole(slide(), 'banner-text');
    assert.equal(texts.length, 2);
    for (const t of texts) assert.deepEqual([t.text, t.align, t.x, t.color], ['UNCLASSIFIED', 'center', 960, '#ffffff']);
    const orange = byRole(slide({ marking: { text: 'TOP SECRET', color: '#ff8c00' } }), 'banner-text');
    assert.equal(orange[0].color, '#000000');
  });
});

describe('title block', () => {
  it('shows the COA name on the left and the DTG on the right, between the banner and the map', () => {
    const s = slide();
    const title = one(s, 'title');
    const dtg = one(s, 'dtg');
    assert.equal(title.text, 'COA 1 – Envelopment');
    assert.equal(title.align, 'left');
    assert.equal(dtg.text, 'DTG 230215ZNOV26');
    assert.equal(dtg.align, 'right');
    assert.ok(title.y > one(s, 'banner-top').h && title.y < one(s, 'map-area').y);
  });

  it('formats a DTG as DDHHMMZMONYY in UTC, whatever the computer\'s time zone', () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles'; // UTC-8: local date and hour differ from UTC here
    try {
      assert.equal(formatDtg('2026-11-23T02:15:59.000Z'), '230215ZNOV26');
      assert.equal(formatDtg('2027-01-05T23:07:00.000Z'), '052307ZJAN27');
    } finally {
      if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
    }
  });
});

describe('map area', () => {
  it('sits between the title and the bottom banner, left of the legend', () => {
    const s = slide();
    const map = one(s, 'map-area');
    const legend = one(s, 'legend-area');
    assert.ok(map.x + map.w <= legend.x);
    assert.ok(map.y + map.h <= one(s, 'banner-bottom').y);
    assert.ok(map.w > s.width * 0.65, 'the map gets most of the width');
  });

  it('fits the whole frame inside the map area, centred on the frame centre', () => {
    const s = slide();
    const map = one(s, 'map-area');
    const [a] = byRole(s, 'unit'); // unit A is at the frame centre
    assert.ok(Math.abs(a.x + SYMBOL.anchor.x - (map.x + map.w / 2)) < 0.5 && Math.abs(a.y + SYMBOL.anchor.y - (map.y + map.h / 2)) < 0.5);
    assert.ok(s.frameBox.w <= map.w + 0.01 && s.frameBox.h <= map.h + 0.01);
    assert.ok(Math.abs(s.frameBox.w / s.frameBox.h - 16 / 9) < 0.001, 'the frame keeps its shape');
    assert.ok(Math.abs(s.frameBox.w - map.w) < 0.01 || Math.abs(s.frameBox.h - map.h) < 0.01, 'and fills one dimension');
  });

  it('places units by Web Mercator: east is right, north is up', () => {
    const [a, b] = byRole(slide(), 'unit');
    assert.ok(b.x > a.x && b.y < a.y);
  });

  it('leaves out units that fall outside the map area', () => {
    assert.deepEqual(byRole(slide(), 'unit').map((u) => u.id), ['A', 'B']);
  });

  it('draws the units with their renderer SVG, pinned at the anchor', () => {
    const [a] = byRole(slide(), 'unit');
    assert.deepEqual([a.svg, a.w, a.h], [SYMBOL.svg, 40, 30]);
  });

  it('draws grid lines inside the map area, labelled at the edges', () => {
    const s = slide();
    const map = one(s, 'map-area');
    const lines = byRole(s, 'grid');
    assert.ok(lines.length >= 4);
    for (const l of lines) assert.ok(Math.min(l.x1, l.x2) >= map.x - 0.5 && Math.max(l.x1, l.x2) <= map.x + map.w + 0.5 && Math.min(l.y1, l.y2) >= map.y - 0.5 && Math.max(l.y1, l.y2) <= map.y + map.h + 0.5);
    const labels = byRole(s, 'grid-label').map((t) => t.text);
    assert.ok(labels.some((t) => /°N$/.test(t)) && labels.some((t) => /°W$/.test(t)), labels.join(' '));
    for (const t of byRole(s, 'grid-label')) {
      const estimatedWidth = t.text.length * t.size * 0.62;
      assert.ok(t.x + estimatedWidth <= map.x + map.w && t.y - t.size / 2 >= map.y, `label ${t.text} would be cut off`);
    }
  });
});

describe('legend', () => {
  it('lists every unit with its symbol and label, in COA order, inside the legend area', () => {
    const s = slide();
    const area = one(s, 'legend-area');
    assert.equal(one(s, 'legend-title').text, 'Legend');
    assert.deepEqual(byRole(s, 'legend-label').map((t) => t.text), ['A', 'B', 'far']);
    const symbols = byRole(s, 'legend-symbol');
    assert.equal(symbols.length, 3);
    for (const item of [...symbols, ...byRole(s, 'legend-label')]) assert.ok(item.x >= area.x && item.y <= area.y + area.h);
  });

  it('draws the plain symbol (no label or modifier text) in the legend, when one is given', () => {
    const plain = { svg: '<svg plain/>', width: 30, height: 20, anchor: { x: 15, y: 10 } };
    const s = slide({ legendSymbols: COA.symbols.map(() => plain) });
    assert.ok(byRole(s, 'legend-symbol').every((i) => i.svg === '<svg plain/>'));
    assert.ok(byRole(s, 'unit').every((i) => i.svg === SYMBOL.svg), 'the map keeps the labelled symbols');
  });

  it('labels a unit without a label by its SIDC', () => {
    const s = slide({ coa: { ...COA, symbols: [unit('X', 34.1, -117.3, '')] } });
    assert.deepEqual(byRole(s, 'legend-label').map((t) => t.text), ['10031000001211000000']);
  });

  it('says how many more there are when the units do not fit', () => {
    const many = { ...COA, symbols: Array.from({ length: 60 }, (_, i) => unit(`U${i}`, 34.1, -117.3)) };
    const s = slide({ coa: many });
    const shown = byRole(s, 'legend-label').length;
    assert.ok(shown < 60);
    assert.equal(one(s, 'legend-more').text, `+${60 - shown} more`);
  });
});

describe('file name', () => {
  it('is the COA name made safe, plus the DTG', () => {
    assert.equal(slideFileName('COA 1 – Envelopment / Phase "A"', DTG), 'coa-1-envelopment-phase-a_230215ZNOV26.png');
    assert.equal(slideFileName('***', DTG), 'coa_230215ZNOV26.png');
  });
});
