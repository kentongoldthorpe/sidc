// Epic 3 backlog B-2: the snap rule (points, then angle, then grid).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { snapPoint, roundTo, ANGLE_STEPS, gridSpacing } from '../../src/domain/snap.js';

const near = (actual, expected, eps = 1e-9) => {
  assert.ok(Math.abs(actual.x - expected.x) < eps && Math.abs(actual.y - expected.y) < eps, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
};
const grid100 = (p) => ({ x: roundTo(p.x, 100), y: roundTo(p.y, 100) });

describe('snapPoint', () => {
  it('leaves the cursor alone when nothing is on', () => {
    assert.deepEqual(snapPoint({ x: 13, y: 27 }), { x: 13, y: 27, snap: null });
  });

  it('snaps to the nearest point within the tolerance, and says which', () => {
    const targets = [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 22, y: 4 }];
    assert.deepEqual(snapPoint({ x: 20, y: 1 }, { targets }), { x: 18, y: 0, snap: 'point', target: 1 });
    assert.equal(snapPoint({ x: 50, y: 50 }, { targets }).snap, null, 'nothing within 10 px');
    assert.equal(snapPoint({ x: 50, y: 50 }, { targets, tolerance: 80 }).target, 2);
  });

  it('rounds the direction from the previous point to the angle step, keeping the distance', () => {
    const from = { x: 100, y: 100 };
    const s = snapPoint({ x: 200, y: 108 }, { from, angleStep: 45 });
    assert.equal(s.snap, 'angle');
    near(s, { x: 100 + Math.hypot(100, 8), y: 100 });
    const diag = snapPoint({ x: 170, y: 180 }, { from, angleStep: 45 });
    near(diag, { x: 100 + Math.hypot(70, 80) / Math.SQRT2, y: 100 + Math.hypot(70, 80) / Math.SQRT2 });
    const fifteen = snapPoint({ x: 200, y: 125 }, { from, angleStep: 15 });
    assert.ok(Math.abs(Math.atan2(fifteen.y - 100, fifteen.x - 100) * 180 / Math.PI - 15) < 1e-9);
    assert.deepEqual(ANGLE_STEPS, [15, 45, 90]);
  });

  it('needs a previous point to snap the angle; a zero-length segment is left alone', () => {
    assert.equal(snapPoint({ x: 5, y: 5 }, { angleStep: 45 }).snap, null);
    assert.equal(snapPoint({ x: 5, y: 5 }, { angleStep: 45, from: { x: 5, y: 5 } }).snap, null);
  });

  it('snaps to the grid\'s nearest intersection', () => {
    assert.deepEqual(snapPoint({ x: 149, y: -51 }, { grid: grid100 }), { x: 100, y: -100, snap: 'grid' });
  });

  it('prefers a point to the angle, and the angle to the grid', () => {
    const targets = [{ x: 205, y: 140 }];
    const from = { x: 100, y: 100 };
    assert.equal(snapPoint({ x: 200, y: 140 }, { targets, from, angleStep: 45, grid: grid100 }).snap, 'point');
    assert.equal(snapPoint({ x: 260, y: 110 }, { targets, from, angleStep: 45, grid: grid100 }).snap, 'angle');
    assert.equal(snapPoint({ x: 260, y: 110 }, { targets, grid: grid100 }).snap, 'grid');
  });

  it('ignores a grid that gives no intersection', () => {
    assert.equal(snapPoint({ x: 1, y: 1 }, { grid: () => null }).snap, null);
    assert.equal(snapPoint({ x: 1, y: 1 }, { grid: () => ({ x: NaN, y: 0 }) }).snap, null);
  });
});

describe('gridSpacing (the template grid)', () => {
  it('follows the zoom on auto: the first spacing at least 70 px apart', () => {
    assert.deepEqual(gridSpacing('auto', 0.1), { snap: 1000, line: 1000, label: 1000 });
    assert.deepEqual(gridSpacing('auto', 1), { snap: 100, line: 100, label: 100 });
  });
  it('snaps to a chosen spacing at any zoom, drawing and labelling wider multiples when lines would crowd', () => {
    assert.deepEqual(gridSpacing(100, 0.5), { snap: 100, line: 100, label: 200 });
    assert.deepEqual(gridSpacing(100, 0.05), { snap: 100, line: 500, label: 2000 });
    assert.deepEqual(gridSpacing(500, 1), { snap: 500, line: 500, label: 500 });
    assert.deepEqual(gridSpacing(250, 0.125), { snap: 250, line: 250, label: 1000 }, 'never 1,250 m (it would read 1.3 km)');
    for (const z of [0.0005, 0.001, 0.0045, 0.006, 0.01, 0.05, 0.2]) for (const chosen of [50, 100, 250, 500, 2500]) {
      const g = gridSpacing(chosen, z);
      assert.ok(g.line % chosen === 0 && g.label % g.line === 0, JSON.stringify({ chosen, z, g }));
    }
  });
  it('takes the slide\'s own minimum spacings', () => {
    assert.deepEqual(gridSpacing(250, 0.2, { minLine: 100, minLabel: 100 }), { snap: 250, line: 500, label: 500 });
  });
});
