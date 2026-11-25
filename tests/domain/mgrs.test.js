// G-1: MGRS and UTM. Reference values from pyproj 3.8 (UTM) and the mgrs package (MGRS),
// computed independently of this code.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toUtm, fromUtm, toMgrs, parseMgrs, zoneOf, bandOf, gridZones, squareOf, mgrsGridLines, nearestMgrsIntersection, gridLineLabel, mgrsOf, mgrsAgrees } from '../../src/domain/mgrs.js';

const REFERENCE = [
  {lat: 38.8895, lng: -77.0352, zone: 18, e: 323486.737, n: 4306483.048, mgrs: "18SUJ2348606483"},
  {lat: 0.0, lng: 0.0, zone: 31, e: 166021.443, n: 0.0, mgrs: "31NAA6602100000"},
  {lat: 0.0, lng: 3.0, zone: 31, e: 500000.0, n: 0.0, mgrs: "31NEA0000000000"},
  {lat: -33.8688, lng: 151.2093, zone: 56, e: 334368.634, n: 6250948.345, mgrs: "56HLH3436850948"},
  {lat: 51.5007, lng: -0.1246, zone: 30, e: 699567.54, n: 5709427.563, mgrs: "30UXC9956709427"},
  {lat: 60.0, lng: 5.0, zone: 32, e: 276979.926, n: 6658157.202, mgrs: "32VKM7697958157"},
  {lat: 78.2232, lng: 15.6267, zone: 33, e: 514278.715, n: 8683355.469, mgrs: "33XWG1427883355"},
  {lat: -79.9, lng: -170.5, zone: 2, e: 509788.655, n: 1129533.628, mgrs: "02CNS0978829533"},
  {lat: 83.9, lng: 40.0, zone: 37, e: 511863.269, n: 9317033.097, mgrs: "37XEP1186317033"},
  {lat: 0.5, lng: 179.99, zone: 60, e: 832851.662, n: 55340.879, mgrs: "60NZF3285155340"},
  {lat: -0.0001, lng: -0.0001, zone: 30, e: 833967.414, n: 9999988.932, mgrs: "30MZE3396799988"},
  {lat: 64.1, lng: -21.9, zone: 27, e: 456137.554, n: 7108467.417, mgrs: "27WVM5613708467"},
  {lat: 35.0, lng: 138.0, zone: 54, e: 226201.904, n: 3877156.692, mgrs: "54STD2620177156"},
  {lat: -54.8, lng: -68.3, zone: 19, e: 545000.053, n: 3927239.381, mgrs: "19FEV4500027239"},
  {lat: 56.0, lng: 3.0, zone: 32, e: 126049.971, n: 6222336.335, mgrs: "32VJH2604922336"},
  {lat: 72.0, lng: 8.9, zone: 31, e: 703202.509, n: 7998893.257, mgrs: "31XGV0320298893"},
  {lat: 47.999, lng: 6.0, zone: 32, e: 276219.756, n: 5320544.659, mgrs: "32TKU7621920544"},
  {lat: 34.05, lng: -118.25, zone: 11, e: 384629.445, n: 3768404.621, mgrs: "11SLT8462968404"},
  {lat: -12.5, lng: 170.25, zone: 59, e: 418507.121, n: 8618040.898, mgrs: "59LMG1850718040"},
  {lat: 25.2, lng: 55.27, zone: 40, e: 325692.854, n: 2788214.44, mgrs: "40RCN2569288214"},
  {lat: -1.29, lng: 36.82, zone: 37, e: 257422.78, n: 9857312.068, mgrs: "37MBU5742257312"},
  {lat: 71.0, lng: -156.8, zone: 4, e: 579924.779, n: 7878847.83, mgrs: "04WED7992478847"},
  {lat: 5.0, lng: -0.5, zone: 30, e: 777223.093, n: 553191.675, mgrs: "30NYL7722353191"}
];

describe('toUtm and toMgrs against reference values', () => {
  for (const r of REFERENCE) {
    it(`${r.lat}, ${r.lng} → ${r.mgrs}`, () => {
      const u = toUtm(r);
      assert.equal(u.zone, r.zone);
      assert.ok(Math.abs(u.easting - r.e) < 0.002, `easting ${u.easting} vs ${r.e}`);
      assert.ok(Math.abs(u.northing - r.n) < 0.002, `northing ${u.northing} vs ${r.n}`);
      assert.equal(toMgrs(r).replace(/ /g, '').padStart(r.mgrs.length, '0'), r.mgrs, 'the reference writes zones with a leading zero');
    });
  }
});

describe('fromUtm and parseMgrs', () => {
  it('round-trips every reference point to well under a millimetre', () => {
    for (const r of REFERENCE) {
      const back = fromUtm(toUtm(r));
      assert.ok(Math.abs(back.lat - r.lat) < 1e-8 && Math.abs(back.lng - r.lng) < 1e-8, JSON.stringify([r, back])); // 1e-8° ≈ 1 mm
    }
  });

  it('reads a reference, with or without spaces, as the centre of the square it names', () => {
    const one = parseMgrs('18SUJ2348606483');
    const spaced = parseMgrs(' 18s uj 23486 06483 ');
    assert.deepEqual(one, spaced);
    assert.equal(one.precision, 1);
    assert.equal(toMgrs(one), '18S UJ 23486 06483');
    const km = parseMgrs('18S UJ 23 06');
    assert.equal(km.precision, 1000);
    assert.equal(toMgrs(km, 2), '18S UJ 23 06');
    assert.equal(toMgrs(km), '18S UJ 23500 06500', 'the centre of the 1 km square');
    assert.equal(parseMgrs('18SUJ').precision, 100000);
  });

  it('reads every reference back to within its 1 m square (both hemispheres, every band, the 2,000 km row cycle)', () => {
    for (const r of REFERENCE) {
      const p = parseMgrs(r.mgrs);
      assert.ok(!p.problems, `${r.mgrs}: ${JSON.stringify(p.problems)}`);
      const a = toUtm(r);
      const b = toUtm(p);
      const metres = a.zone === b.zone ? Math.hypot(a.easting - b.easting, a.northing - b.northing) : Math.hypot((p.lat - r.lat) * 111320, (p.lng - r.lng) * 111320 * Math.cos((r.lat * Math.PI) / 180));
      assert.ok(metres < 1.5, `${r.mgrs}: ${metres} m away`);
    }
  });

  it('names what is wrong with a reference', () => {
    assert.match(parseMgrs('hello').problems[0].reason, /MGRS reference/);
    assert.match(parseMgrs('18SUJ23406').problems[0].reason, /same number of digits/);
    assert.match(parseMgrs('18SUJ234 06').problems[0].reason, /same number of digits/);
    assert.match(parseMgrs('61SUJ').problems[0].reason, /zone/);
    assert.match(parseMgrs('18SAJ').problems[0].reason, /column A/);
    assert.match(parseMgrs(42).problems[0].reason, /text/);
  });
});

describe('zones, bands and squares', () => {
  it('uses the Norway and Svalbard exceptions', () => {
    assert.equal(zoneOf(60, 5), 32);
    assert.equal(zoneOf(60, 2.9), 31);
    assert.equal(zoneOf(78, 8.9), 31);
    assert.equal(zoneOf(78, 9), 33);
    assert.equal(zoneOf(78, 40), 37);
    assert.equal(zoneOf(0, 179.99), 60);
    assert.equal(zoneOf(0, -180), 1);
  });
  it('has bands from C to X, X up to 84°N, nothing at the poles', () => {
    assert.deepEqual([bandOf(-80), bandOf(-72.1), bandOf(0), bandOf(83.9), bandOf(84)], ['C', 'C', 'N', 'X', 'X']);
    assert.equal(bandOf(-80.1), null);
    assert.equal(bandOf(85), null);
    assert.equal(toMgrs({ lat: 86, lng: 0 }), null);
  });
  it('names 100 km squares', () => assert.equal(squareOf(18, 323486, 4306483), 'UJ'));
  it('lists the grid zone cells in a box, with the exceptions', () => {
    const here = gridZones(30, -79, 45, -73).map((c) => `${c.zone}${c.band}`).sort();
    assert.deepEqual(here, ['17R', '17S', '17T', '18R', '18S', '18T']);
    const norway = gridZones(57, 0, 63, 12).filter((c) => c.band === 'V');
    assert.deepEqual(norway.map((c) => [c.zone, c.west, c.east]), [[31, 0, 3], [32, 3, 12]]);
    const svalbard = gridZones(73, 0, 80, 42).map((c) => c.zone);
    assert.deepEqual(svalbard, [31, 33, 35, 37]);
    assert.deepEqual(gridZones(0, 179, 1, 181).map((c) => [c.zone, c.west, c.east]), [[60, 174, 180], [1, 180, 186]]);
  });
});

describe('mgrsGridLines', () => {
  const box = { south: 38.85, west: -77.1, north: 38.93, east: -76.98 }; // central Washington
  it('draws 1 km easting and northing lines that lie on their values, inside the box', async () => {
    const { lines, zones } = mgrsGridLines(box, 1000);
    assert.deepEqual(zones.map((z) => `${z.zone}${z.band}`), ['18S']);
    const es = lines.filter((l) => l.axis === 'e');
    const ns = lines.filter((l) => l.axis === 'n');
    assert.ok(es.length >= 9 && es.length <= 13, `${es.length} easting lines`);
    assert.ok(ns.length >= 8 && ns.length <= 11, `${ns.length} northing lines`);
    for (const l of lines) {
      for (const p of l.points) {
        assert.ok(p.lat >= box.south - 1e-6 && p.lat <= box.north + 1e-6 && p.lng >= box.west - 1e-6 && p.lng <= box.east + 1e-6);
        const u = toUtm(p);
        assert.ok(Math.abs((l.axis === 'e' ? u.easting : u.northing) - l.value) < 0.01, `${l.axis} ${l.value}: ${JSON.stringify(u)}`);
      }
      assert.equal(l.value % 1000, 0);
    }
    assert.equal(gridLineLabel(324000, 1000), '24');
    assert.equal(gridLineLabel(4306500, 100), '065');
  });

  it('cuts lines at a zone boundary, so each zone has its own grid', () => {
    const { lines, zones } = mgrsGridLines({ south: 40, west: -78.3, north: 40.2, east: -77.7 }, 10000);
    assert.deepEqual(zones.map((z) => z.zone), [17, 18]);
    for (const l of lines) {
      const west = l.zone === 17 ? -84 : -78;
      assert.ok(l.points.every((p) => p.lng >= west - 1e-6 && p.lng <= west + 6 + 1e-6), `zone ${l.zone}`);
    }
    assert.ok(lines.some((l) => l.zone === 17) && lines.some((l) => l.zone === 18));
  });

  it('names the 100 km squares whose centres are in the box, and gives only zones when the spacing is null', () => {
    const { squares } = mgrsGridLines({ south: 37, west: -79, north: 41, east: -75 }, 100000);
    assert.ok(squares.some((s) => s.zone === 18 && s.id === 'UJ'), squares.map((s) => s.id).join());
    const zonesOnly = mgrsGridLines({ south: 0, west: 0, north: 20, east: 20 }, null);
    assert.equal(zonesOnly.lines.length, 0);
    assert.ok(zonesOnly.zones.length >= 4);
  });

  it('gives up rather than drawing a smear of lines', () => {
    assert.equal(mgrsGridLines({ south: 30, west: -80, north: 45, east: -70 }, 100).lines.length, 0);
  });

  it('works for a copy of the world east of the antimeridian', () => {
    const { lines } = mgrsGridLines({ south: 38.85, west: 282.9, north: 38.93, east: 283.02 }, 1000);
    assert.ok(lines.length > 10 && lines.every((l) => l.points.every((p) => p.lng > 282.8 && p.lng < 283.1)));
  });
});

describe('nearestMgrsIntersection', () => {
  it('moves a position to the nearest grid crossing in its zone', () => {
    const p = nearestMgrsIntersection({ lat: 38.8895, lng: -77.0352 }, 1000);
    const u = toUtm(p);
    assert.ok(Math.abs(u.easting - 323000) < 0.01 && Math.abs(u.northing - 4306000) < 0.01, JSON.stringify(u));
    assert.equal(nearestMgrsIntersection({ lat: 86, lng: 0 }, 1000), null);
  });
});

describe('mgrsOf and mgrsAgrees (E6-1)', () => {
  it('shows a typed grid back as typed, and any other position to 1 m', () => {
    for (const text of ['18S UJ 2348 0648', '18S UJ 234 064', '18S UJ 23486 06483']) assert.equal(mgrsOf(parseMgrs(text)), text);
    assert.equal(mgrsOf({ lat: 38.8895, lng: -77.0352 }), '18S UJ 23486 06483');
    assert.equal(mgrsOf({ lat: 88, lng: 0 }), null);
  });
  it('checks that a position lies in the square a reference names', () => {
    const p = { lat: 38.8895, lng: -77.0352 };
    assert.equal(mgrsAgrees(p, '18S UJ 2348 0648'), true);
    assert.equal(mgrsAgrees(p, '18SUJ2348606483'), true);
    assert.equal(mgrsAgrees(p, '18S UJ 2384 0648'), false, 'transposed digits');
    assert.equal(mgrsAgrees(p, '18S UJ 2348 0649'), false, 'one square off');
    assert.equal(mgrsAgrees(p, 'nonsense'), null);
  });
});
