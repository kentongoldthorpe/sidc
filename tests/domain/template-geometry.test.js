// Template geometry (Epic 3): pure maths on template space (metres; +y = direction of attack,
// bearings clockwise from +y). Reason for testing directly: these numbers ARE the feature (fields of
// fire and coverage drawn to scale), and the canvas and map placement both rely on them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pointAt, sectorOutline, coverageOf, formationExtent } from '../../src/domain/template-geometry.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe('pointAt', () => {
  it('measures bearings clockwise from the direction of attack (+y)', () => {
    const o = { x: 100, y: 200 };
    const p0 = pointAt(o, 0, 1000); const p90 = pointAt(o, 90, 1000); const p180 = pointAt(o, 180, 1000);
    assert.ok(near(p0.x, 100) && near(p0.y, 1200));
    assert.ok(near(p90.x, 1100) && near(p90.y, 200));
    assert.ok(near(p180.x, 100) && near(p180.y, -800));
  });
});

describe('sectorOutline', () => {
  it('is a wedge from the centre, centred on the bearing, with points on the arc at the radius', () => {
    const c = { x: 0, y: 0 };
    const pts = sectorOutline(c, { radius: 2500, bearing: 0, arc: 60 });
    assert.deepEqual(pts[0], c, 'starts at the centre');
    const rim = pts.slice(1);
    assert.ok(rim.length >= 8);
    for (const p of rim) assert.ok(near(Math.hypot(p.x, p.y), 2500, 1e-6));
    const angles = rim.map((p) => (Math.atan2(p.x, p.y) * 180) / Math.PI);
    assert.ok(near(Math.min(...angles), -30, 1e-6) && near(Math.max(...angles), 30, 1e-6), angles.join());
  });

  it('with a minimum range is a band: outer arc out, inner arc back', () => {
    const pts = sectorOutline({ x: 0, y: 0 }, { radius: 2500, minRadius: 500, bearing: 90, arc: 40 });
    const radii = pts.map((p) => Math.hypot(p.x, p.y));
    assert.ok(radii.every((r) => near(r, 2500) || near(r, 500)));
    assert.ok(radii.some((r) => near(r, 500)) && !pts.some((p) => near(p.x, 0) && near(p.y, 0)), 'no point at the centre');
    assert.ok(pts.every((p) => p.x > 0), 'all to the east (bearing 90)');
  });
});

describe('coverageOf', () => {
  const ad = { id: 's1', name: 'SA-15', role: 'airDefence', maxRange: 12000, arc: 360 };
  const gun = { id: 's2', name: 'T-72 gun', role: 'direct', maxRange: 2500, minRange: 100, arc: 60 };
  it('gives a ring for an all-round system and a sector along the unit\'s facing for an arc', () => {
    const unit = { x: 1000, y: 0, facing: 90, systems: ['s1', 's2', 'missing'] };
    const shapes = coverageOf(unit, new Map([['s1', ad], ['s2', gun]]));
    assert.equal(shapes.length, 2, 'unknown systems are skipped');
    assert.deepEqual(shapes[0], { kind: 'ring', system: ad, center: { x: 1000, y: 0 }, radius: 12000, minRadius: 0 });
    assert.equal(shapes[1].kind, 'sector');
    assert.equal(shapes[1].system, gun);
    assert.ok(shapes[1].points.slice(1).every((p) => p.x > 1000), 'the gun points east, the way the unit faces');
  });
});

describe('formationExtent', () => {
  it('measures frontage (across, x) and depth (along, y) of the units', () => {
    const units = [{ x: -800, y: 0 }, { x: 800, y: 200 }, { x: 0, y: -4000 }];
    assert.deepEqual(formationExtent(units), { frontage: 1600, depth: 4200 });
  });
  it('is zero for one unit or none', () => {
    assert.deepEqual(formationExtent([{ x: 5, y: 5 }]), { frontage: 0, depth: 0 });
    assert.deepEqual(formationExtent([]), { frontage: 0, depth: 0 });
  });
});
