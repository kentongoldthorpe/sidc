// E6-5: registering a photo to the ground.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitTransform } from '../../src/domain/image-registration.js';

// A known ground truth: a photo of a map, rotated 12°, 2.5 m per pixel, origin at 323000 / 4306000.
const rot = (12 * Math.PI) / 180;
const affine = (x, y) => ({ e: 323000 + 2.5 * (Math.cos(rot) * x - Math.sin(rot) * y), n: 4306000 - 2.5 * (Math.sin(rot) * x + Math.cos(rot) * y) });
// A photo taken at an angle: a projective transform.
const H = [2.4, 0.3, 323000, -0.2, -2.6, 4306000, 0.00012, 0.00008];
const projective = (x, y) => { const w = H[6] * x + H[7] * y + 1; return { e: (H[0] * x + H[1] * y + H[2]) / w, n: (H[3] * x + H[4] * y + H[5]) / w }; };
const cp = (f, pts) => pts.map(([x, y]) => ({ px: { x, y }, at: f(x, y) }));

describe('fitTransform', () => {
  it('fits a flat scan from 3 points exactly (affine)', () => {
    const t = fitTransform(cp(affine, [[100, 120], [1800, 200], [900, 1300]]));
    assert.equal(t.kind, 'affine');
    assert.ok(t.rms < 1e-6);
    const g = t.apply(1500, 1000);
    const want = affine(1500, 1000);
    assert.ok(Math.hypot(g.e - want.e, g.n - want.n) < 1e-6);
  });

  it('fits a photo taken at an angle from 4 or more points (projective), to a millimetre anywhere on it', () => {
    const t = fitTransform(cp(projective, [[50, 60], [1900, 80], [1850, 1400], [80, 1350], [960, 700]]));
    assert.equal(t.kind, 'projective');
    assert.ok(t.rms < 1e-3, `rms ${t.rms}`);
    for (const [x, y] of [[0, 0], [2000, 1500], [400, 1100]]) {
      const g = t.apply(x, y);
      const want = projective(x, y);
      assert.ok(Math.hypot(g.e - want.e, g.n - want.n) < 0.01, `${x},${y}`);
    }
  });

  it('shows a bad point by its residual: one grid mistyped by 1 km stands out', () => {
    const pts = cp(projective, [[50, 60], [1900, 80], [1850, 1400], [80, 1350], [960, 700], [500, 300]]);
    pts[4].at = { e: pts[4].at.e + 1000, n: pts[4].at.n };
    const t = fitTransform(pts);
    const worst = t.residuals.indexOf(Math.max(...t.residuals));
    assert.equal(worst, 4);
    assert.ok(t.rms > 100);
  });

  it('asks for 3 points, spread out', () => {
    assert.match(fitTransform([]).problem, /at least 3/);
    assert.match(fitTransform(cp(affine, [[0, 0], [10, 10], [20, 20]])).problem, /in a line/);
  });
});
