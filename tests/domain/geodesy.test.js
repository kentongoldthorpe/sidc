// Geodesy on a sphere (Epic 3): destination points, bearings and sector outlines on the map, shared
// by the map, the slides and placement of templates. Reason for testing directly: distances and
// angles on the ground are the feature (they must match what Leaflet measures: radius 6 371 000 m).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { destination, initialBearing, distance, sectorOutlineGeo, EARTH_RADIUS } from '../../src/domain/geodesy.js';

const near = (a, b, eps) => Math.abs(a - b) < eps;

describe('destination / distance / initialBearing', () => {
  it('uses Leaflet\'s earth radius', () => assert.equal(EARTH_RADIUS, 6371000));

  it('goes the right distance in the right direction, and back again', () => {
    const start = { lat: 34.05, lng: -118.25 };
    for (const bearing of [0, 45, 90, 135, 200, 315]) {
      const p = destination(start, bearing, 12000);
      assert.ok(near(distance(start, p), 12000, 0.01), `distance at ${bearing}`);
      assert.ok(near(initialBearing(start, p), bearing, 1e-6), `bearing ${initialBearing(start, p)} vs ${bearing}`);
    }
  });

  it('north is +lat, east is +lng', () => {
    const o = { lat: 10, lng: 20 };
    assert.ok(destination(o, 0, 1000).lat > 10);
    assert.ok(destination(o, 90, 1000).lng > 20);
  });

  it('a degree of latitude is about 111.2 km', () => {
    assert.ok(near(distance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 111195, 1));
  });

  it('gives bearings in [0, 360)', () => {
    assert.ok(near(initialBearing({ lat: 0, lng: 0 }, { lat: -1, lng: -0.0000001 }), 180, 1e-3));
    const west = initialBearing({ lat: 0, lng: 0 }, { lat: 0, lng: -1 });
    assert.ok(near(west, 270, 1e-9) && west < 360);
  });
});

describe('sectorOutlineGeo', () => {
  it('is a wedge from the centre whose rim is at the radius, within the arc', () => {
    const c = { lat: 34, lng: -118 };
    const pts = sectorOutlineGeo(c, { radius: 2500, bearing: 90, arc: 60 });
    assert.deepEqual(pts[0], c);
    for (const p of pts.slice(1)) {
      assert.ok(near(distance(c, p), 2500, 0.01));
      const b = initialBearing(c, p);
      assert.ok(b >= 60 - 1e-6 && b <= 120 + 1e-6, String(b));
    }
  });

  it('with a minimum range is a band, and with 360° a full ring', () => {
    const c = { lat: 0, lng: 0 };
    const band = sectorOutlineGeo(c, { radius: 2500, minRadius: 800, bearing: 0, arc: 90 });
    assert.ok(band.every((p) => near(distance(c, p), 2500, 0.01) || near(distance(c, p), 800, 0.01)));
    const ring = sectorOutlineGeo(c, { radius: 1000, bearing: 0, arc: 360 });
    assert.ok(ring.every((p) => near(distance(c, p), 1000, 0.01)), 'no centre point for a full circle');
  });
});
