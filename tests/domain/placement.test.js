// T-5 Placement (Epic 3): a template in metres laid on the map at an anchor and bearing. Reason for
// testing directly: preserving every distance and angle is the point of the feature.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { templateToMap, placePlay } from '../../src/domain/placement.js';
import { distance, initialBearing } from '../../src/domain/geodesy.js';

const ANCHOR = { lat: 34.05, lng: -118.25 };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

describe('templateToMap', () => {
  it('puts the reference point on the anchor, and +y along the bearing', () => {
    assert.deepEqual(templateToMap(ANCHOR, 37, { x: 0, y: 0 }), ANCHOR);
    const ahead = templateToMap(ANCHOR, 90, { x: 0, y: 5000 });
    assert.ok(near(distance(ANCHOR, ahead), 5000, 0.01));
    assert.ok(near(initialBearing(ANCHOR, ahead), 90, 1e-6), 'the direction of attack points east');
    const right = templateToMap(ANCHOR, 90, { x: 1000, y: 0 });
    assert.ok(near(initialBearing(ANCHOR, right), 180, 1e-6), '+x is to the right of the direction of attack');
  });

  it('keeps distances between template points (within 0.1 % over tens of km)', () => {
    const pts = [{ x: -900, y: 0 }, { x: 900, y: 200 }, { x: 0, y: -9000 }, { x: 12000, y: 25000 }];
    for (const bearing of [0, 45, 200]) {
      const placed = pts.map((p) => templateToMap(ANCHOR, bearing, p));
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const flat = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          const ground = distance(placed[i], placed[j]);
          assert.ok(Math.abs(ground - flat) / flat < 0.001, `${i}-${j} at ${bearing}°: ${ground} vs ${flat}`);
        }
      }
    }
  });
});

describe('placePlay', () => {
  const systems = new Map([
    ['ad', { id: 'ad', name: 'SA-15', role: 'airDefence', maxRange: 12000, arc: 360 }],
    ['gun', { id: 'gun', name: 'T-72 gun', role: 'direct', maxRange: 2500, minRange: 100, arc: 60 }],
  ]);
  const model = {
    id: 'tm-1', name: 'MRB attack', description: 'Forward detachment leads.',
    formation: { units: [], graphics: [] },
    coas: [{
      id: 'tc-1', name: 'COA 1 Penetration', rank: 'mostLikely',
      statement: { who: 'MRB(-)', what: 'attacks', when: 'at dawn', where: 'north', why: 'to seize the crossings', how: 'MRCs abreast' },
      endState: 'Crossings held',
      template: {
        units: [
          { id: 'u1', sidc: '10061000151211000000', label: '1 MRC', x: -900, y: 0, facing: 30, systems: ['gun'], hvt: false, end: { x: -900, y: 4000 } },
          { id: 'u2', sidc: '10061000151301000000', label: 'AD Bty', x: 0, y: -4500, facing: 0, systems: ['ad'], hvt: true },
        ],
        graphics: [{ id: 'g1', kind: 'axisOfAdvance', side: 'hostile', label: 'AXIS', points: [{ x: 0, y: -2000 }, { x: 0, y: 6000 }] }],
      },
    }],
  };
  const place = (positions, bearing = 0) => placePlay(model, { play: 'tc-1', anchor: ANCHOR, bearing, positions, systems });

  it('names the COA and writes the statement and end state into its description, with where it came from', () => {
    const p = place('start');
    assert.equal(p.name, 'COA 1 Penetration (SITTEMP)');
    for (const text of ['Most likely', 'WHO: MRB(-)', 'WHY: to seize the crossings', 'END STATE: Crossings held', 'MRB attack']) assert.ok(p.description.includes(text), text);
    assert.deepEqual(p.source, { threatModelId: 'tm-1', play: 'tc-1', anchor: ANCHOR, bearing: 0, positions: 'start' });
  });

  it('places units at their start or end, keeping labels and SIDCs', () => {
    const start = place('start').symbols;
    const end = place('end').symbols;
    assert.deepEqual(start.map((s) => [s.sidc, s.label]), [['10061000151211000000', '1 MRC'], ['10061000151301000000', 'AD Bty']]);
    assert.ok(near(distance(start[0].position, end[0].position), 4000, 0.5), 'the first unit moved 4 km');
    assert.deepEqual(start[1].position, end[1].position, 'a unit without a move stays');
  });

  it('turns systems into a ring (all round) or a sector along bearing + facing, at the unit', () => {
    const p = place('start', 90);
    const sector = p.graphics.find((g) => g.kind === 'sector');
    const ring = p.graphics.find((g) => g.kind === 'rangeRing');
    assert.deepEqual([sector.label, sector.radius, sector.minRadius, sector.arc, sector.bearing, sector.side], ['T-72 gun', 2500, 100, 60, 120, 'hostile']);
    assert.deepEqual(sector.center, p.symbols[0].position);
    assert.deepEqual([ring.label, ring.radius], ['SA-15', 12000]);
    assert.deepEqual(ring.center, p.symbols[1].position);
  });

  it('carries template lines over, and with "endWithMoves" adds an arrow for each move', () => {
    const p = place('endWithMoves');
    const axes = p.graphics.filter((g) => g.kind === 'axisOfAdvance');
    assert.equal(axes.length, 2, 'the template axis and one move');
    assert.equal(axes[0].label, 'AXIS');
    assert.equal(axes[0].points.length, 2);
    const move = axes[1];
    assert.deepEqual(move.points[1], p.symbols[0].position, 'the move arrow ends at the unit');
    assert.ok(near(distance(move.points[0], move.points[1]), 4000, 0.5));
  });

  it('places the formation too (no statement: the model description instead)', () => {
    const p = placePlay({ ...model, formation: model.coas[0].template }, { play: 'formation', anchor: ANCHOR, bearing: 0, positions: 'start', systems });
    assert.equal(p.name, 'MRB attack (SITTEMP)');
    assert.ok(p.description.includes('Forward detachment leads.'));
  });
});
