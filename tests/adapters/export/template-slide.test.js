// T-7 Template slide: the formation or a threat COA's play as a slide. Pure layout → display list.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTemplateSlide, wrapText } from '../../../src/adapters/export/template-slide.js';

const MARKING = { text: 'SECRET', color: '#c8102e' };
const SYMBOL = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"></svg>', width: 40, height: 30, anchor: { x: 20, y: 15 } };
const INF = '10061000001211000000';
const MODEL = {
  id: 'tm-1', name: 'MRB in the attack', description: 'Doctrine: forward detachment leads by 5 km.',
  formation: { units: [{ id: 'a', sidc: INF, label: '1 MRC', x: -900, y: 0, facing: 0, weapons: [], hvt: false }], graphics: [] },
  coas: [{
    id: 'tc-1', name: 'COA 1 Penetration', rank: 'mostLikely', endState: 'Crossings held',
    statement: { who: 'MRB(-)', what: 'attacks', when: 'at dawn', where: 'north along the valley', why: 'to seize the river crossings', how: 'MRCs abreast fix; the TK Coy passes through' },
    template: {
      units: [
        { id: 'a', sidc: INF, label: '1 MRC', x: -900, y: 0, facing: 0, weapons: [{ name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 }], hvt: false, end: { x: -900, y: 4000 } },
        { id: 'b', sidc: INF, label: 'AD Bty', x: 0, y: -4000, facing: 0, weapons: [{ name: 'SA-15', role: 'airDefence', maxRange: 6000, arc: 360 }], hvt: true },
      ],
      graphics: [{ id: 'g1', kind: 'axisOfAdvance', side: 'hostile', label: 'AXIS', points: [{ x: 0, y: -2000 }, { x: 0, y: 7000 }] }],
    },
  }],
};
const slide = (play = 'tc-1', over = {}) => layoutTemplateSlide({ model: MODEL, play, marking: MARKING, dtg: '241200ZNOV26', symbols: [SYMBOL, SYMBOL], ...over });
const byRole = (s, role) => s.items.filter((i) => i.role === role);
const texts = (s, role) => byRole(s, role).map((i) => i.text);

describe('layoutTemplateSlide', () => {
  it('has the banners, the model and COA as title with its rank, and the DTG', () => {
    const s = slide();
    assert.deepEqual([s.width, s.height], [1920, 1080]);
    assert.deepEqual(texts(s, 'banner-text'), ['SECRET', 'SECRET']);
    assert.deepEqual(texts(s, 'title'), ['MRB in the attack · COA 1 Penetration (MLCOA)']);
    assert.deepEqual(texts(s, 'dtg'), ['DTG 241200ZNOV26']);
  });

  it('draws the play to scale: the same metres are the same pixels across and along', () => {
    const s = slide();
    const [start] = byRole(s, 'unit-start');
    const ends = byRole(s, 'unit');
    const along = (ends[0].y - start.y) * -s.metresPerPixel; // up the slide is the direction of attack
    assert.ok(Math.abs(along - 4000) < 1, `${along}`);
    const across = (ends[1].x - ends[0].x) * s.metresPerPixel;
    assert.ok(Math.abs(across - 900) < 1, `${across}`);
  });

  it('fits everything inside the drawing area: units, both weapon ranges and the axis', () => {
    const s = slide();
    for (const item of [...byRole(s, 'unit'), ...byRole(s, 'unit-start')]) {
      assert.ok(item.x >= s.area.x && item.x + item.w <= s.area.x + s.area.w && item.y >= s.area.y && item.y + item.h <= s.area.y + s.area.h, item.id);
    }
    const coverage = byRole(s, 'unit-coverage');
    assert.deepEqual(coverage.map((c) => c.color), ['#c8102e', '#7b3fa0']);
    for (const p of coverage.flatMap((c) => c.points)) assert.ok(p.x >= s.area.x - 1 && p.x <= s.area.x + s.area.w + 1 && p.y >= s.area.y - 1 && p.y <= s.area.y + s.area.h + 1);
  });

  it('shows the start faded, a move arrow, the end, and badges HVTs', () => {
    const s = slide();
    assert.equal(byRole(s, 'unit-start')[0].alpha, 0.35);
    assert.equal(byRole(s, 'move').length, 1);
    assert.equal(byRole(s, 'move-arrow').length, 1);
    assert.deepEqual(byRole(s, 'hvt-badge').map((b) => b.id), ['b']);
  });

  it('labels weapons and lines, and has the direction of attack, a scale bar and the extent', () => {
    const s = slide();
    assert.deepEqual(texts(s, 'graphic-label').sort(), ['AXIS', 'Gun', 'SA-15']);
    assert.deepEqual(texts(s, 'attack'), ['↑ Direction of attack']);
    assert.match(texts(s, 'scale-text')[0], /^\d+(\.\d)? k?m$/);
    assert.deepEqual(texts(s, 'extent'), ['Frontage 900 m · Depth 4 km']);
  });

  it('writes the COA statement and end state beside the drawing, then the units', () => {
    const s = slide();
    assert.deepEqual(texts(s, 'statement-title'), ['Most likely COA (MLCOA)']);
    assert.deepEqual(texts(s, 'statement-heading'), ['WHO', 'WHAT', 'WHEN', 'WHERE', 'WHY', 'HOW', 'END STATE', 'UNITS']);
    assert.ok(texts(s, 'statement-text').includes('Crossings held'));
    assert.deepEqual(texts(s, 'unit-line'), ['1 MRC: Gun 2.5 km', 'AD Bty (HVT): SA-15 6 km']);
    for (const t of byRole(s, 'statement-text')) assert.ok(t.x >= s.area.w, 'in the panel');
  });

  it('shows the formation with the model\'s description', () => {
    const s = slide('formation', { symbols: [SYMBOL] });
    assert.deepEqual(texts(s, 'title'), ['MRB in the attack · Formation']);
    assert.deepEqual(texts(s, 'statement-title'), ['Doctrinal template (formation)']);
    assert.ok(texts(s, 'statement-text').join(' ').includes('forward detachment'));
  });

  it('is null for a play that does not exist, and takes the other slide shapes', () => {
    assert.equal(slide('tc-404'), null);
    assert.deepEqual([slide('tc-1', { aspect: '4:3' }).width, slide('tc-1', { aspect: '4:3' }).height], [1600, 1200]);
  });
});

describe('wrapText', () => {
  it('breaks at spaces, keeps paragraphs, and cuts a word longer than a line', () => {
    assert.deepEqual(wrapText('the quick brown fox jumps', 10), ['the quick', 'brown fox', 'jumps']);
    assert.deepEqual(wrapText('a\nb', 10), ['a', 'b']);
    assert.deepEqual(wrapText('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
  });
});

describe('layoutTemplateSlide: nothing written over anything else', () => {
  const box = (t) => { const w = t.text.length * t.size * 0.56; const x = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x; return { x, y: t.y - t.size * 0.6, w, h: t.size * 1.2 }; };
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  it('leaves out grid labels under the direction-of-attack box', () => {
    const s = slide();
    const attack = byRole(s, 'attack-box')[0];
    for (const t of byRole(s, 'grid-label')) assert.ok(!overlaps(box(t), attack), t.text);
  });

  it('never writes weapon names over each other where several units carry the same weapon side by side', () => {
    const units = [-100, 0, 100].map((x, i) => ({ id: `u${i}`, sidc: INF, label: `${i}`, x, y: 0, facing: 0, weapons: [{ name: 'T-72 gun', role: 'direct', maxRange: 2500, arc: 60 }], hvt: false }));
    const model = { ...MODEL, coas: [{ ...MODEL.coas[0], template: { units, graphics: [] } }] };
    const s = layoutTemplateSlide({ model, play: 'tc-1', marking: MARKING, dtg: 'x', symbols: [SYMBOL, SYMBOL, SYMBOL] });
    const labels = byRole(s, 'graphic-label');
    assert.ok(labels.length >= 1);
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!overlaps(box(labels[i]), box(labels[j])));
  });
});
