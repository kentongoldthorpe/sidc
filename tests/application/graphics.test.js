// Lines, areas and range rings ("graphics"): graphic.add, graphic.update, graphic.remove, and how
// COAs carry them (create, get, duplicate). Tested only through envelopes at the boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';

const PL = [{ lat: 34, lng: -118 }, { lat: 34.2, lng: -117.8 }];
const OBJ = [{ lat: 34, lng: -118 }, { lat: 34.1, lng: -118 }, { lat: 34.1, lng: -117.9 }];

async function setup() {
  const h = createHarness();
  const coa = okValue(await h.dispatch('coa.create', { name: 'Envelopment' }));
  h.takeEvents();
  return { h, coaId: coa.id, revision: 1 };
}
const add = (s, fields, revision = s.revision) => s.h.dispatch('graphic.add', { coaId: s.coaId, expectedRevision: revision, ...fields });
const stored = async (s) => okValue(await s.h.query('coa.get', { coaId: s.coaId }));

describe('graphic.add', () => {
  it('adds a phase line with defaults (friendly, no label, side colour), bumps the revision and emits graphic.added', async () => {
    const s = await setup();
    const value = okValue(await add(s, { kind: 'phaseLine', points: PL }));
    assert.equal(value.coaId, s.coaId);
    assert.equal(value.revision, 2);
    assert.deepEqual(value.graphic, { id: value.graphic.id, kind: 'phaseLine', side: 'friendly', label: '', points: PL });
    assert.match(value.graphic.id, /\S/);
    const events = s.h.takeEvents();
    assert.deepEqual(events.map((e) => e.type), ['graphic.added']);
    assert.deepEqual(events[0].payload, value);
    assert.deepEqual((await stored(s)).graphics, [value.graphic]);
  });

  it('adds an area with a label, side and colour override; labels and colours are normalised', async () => {
    const s = await setup();
    const { graphic } = okValue(await add(s, { kind: 'objective', points: OBJ, label: '  OBJ IRON ', side: 'hostile', color: '#AABBCC' }));
    assert.deepEqual({ ...graphic, id: undefined }, { id: undefined, kind: 'objective', side: 'hostile', label: 'OBJ IRON', color: '#aabbcc', points: OBJ });
  });

  it('adds a range ring with a centre and a radius in metres', async () => {
    const s = await setup();
    const { graphic } = okValue(await add(s, { kind: 'rangeRing', center: { lat: 34, lng: -118 }, radius: 15000, label: '155mm' }));
    assert.deepEqual({ ...graphic, id: undefined }, { id: undefined, kind: 'rangeRing', side: 'friendly', label: '155mm', center: { lat: 34, lng: -118 }, radius: 15000 });
  });

  it('accepts every line and area kind', async () => {
    const s = await setup();
    let revision = 1;
    for (const kind of ['phaseLine', 'boundary', 'axisOfAdvance', 'route', 'line']) okValue(await add(s, { kind, points: PL }, revision++));
    for (const kind of ['objective', 'assemblyArea', 'engagementArea', 'area']) okValue(await add(s, { kind, points: OBJ }, revision++));
    assert.equal((await stored(s)).graphics.length, 9);
  });

  it('keeps a line continuous across the 180° meridian, and wraps its first point', async () => {
    const s = await setup();
    const { graphic } = okValue(await add(s, { kind: 'route', points: [{ lat: 0, lng: 190 }, { lat: 0, lng: 179 }, { lat: 1, lng: -179 }] }));
    assert.deepEqual(graphic.points.map((p) => p.lng), [-170, -181, -179]);
  });

  const invalid = [
    ['an unknown kind', { kind: 'trench', points: PL }, ['kind']],
    ['a missing kind', { points: PL }, ['kind']],
    ['a line with one point', { kind: 'phaseLine', points: PL.slice(0, 1) }, ['points']],
    ['an area with two points', { kind: 'objective', points: PL }, ['points']],
    ['points that are not a list', { kind: 'route', points: 'here' }, ['points']],
    ['a bad point', { kind: 'route', points: [PL[0], { lat: 95, lng: 1 }, { lat: 1, lng: 'x' }] }, ['points[1].lat', 'points[2].lng']],
    ['too many points', { kind: 'route', points: Array.from({ length: 501 }, (_, i) => ({ lat: 0, lng: i / 100 })) }, ['points']],
    ['a centre on a line', { kind: 'route', points: PL, center: PL[0] }, ['center']],
    ['points on a range ring', { kind: 'rangeRing', center: PL[0], radius: 10, points: PL }, ['points']],
    ['a ring without centre and radius', { kind: 'rangeRing' }, ['center', 'radius']],
    ['a zero radius', { kind: 'rangeRing', center: PL[0], radius: 0 }, ['radius']],
    ['a radius beyond 5000 km', { kind: 'rangeRing', center: PL[0], radius: 5_000_001 }, ['radius']],
    ['an unknown side', { kind: 'route', points: PL, side: 'blue' }, ['side']],
    ['a colour that is not #rrggbb', { kind: 'route', points: PL, color: 'red' }, ['color']],
    ['a label over 40 characters', { kind: 'route', points: PL, label: 'x'.repeat(41) }, ['label']],
  ];
  for (const [what, fields, expected] of invalid) {
    it(`refuses ${what} with VALIDATION_FAILED and changes nothing`, async () => {
      const s = await setup();
      const error = errorOf(await add(s, fields), 'VALIDATION_FAILED');
      assert.deepEqual(problemFields(error).sort(), [...expected].sort());
      assert.deepEqual(s.h.takeEvents(), []);
      assert.equal((await stored(s)).revision, 1);
    });
  }

  it('is CONFLICT for a stale revision, and NOT_FOUND for an unknown COA', async () => {
    const s = await setup();
    errorOf(await add(s, { kind: 'route', points: PL }, 7), 'CONFLICT');
    errorOf(await s.h.dispatch('graphic.add', { coaId: 'coa-404', expectedRevision: 1, kind: 'route', points: PL }), 'NOT_FOUND');
  });
});

describe('graphic.update', () => {
  async function withGraphics() {
    const s = await setup();
    const line = okValue(await add(s, { kind: 'phaseLine', points: PL, label: 'PL GOLD', color: '#112233' })).graphic;
    const ring = okValue(await add(s, { kind: 'rangeRing', center: PL[0], radius: 1000 }, 2)).graphic;
    s.h.takeEvents();
    return { ...s, line, ring, revision: 3 };
  }
  const update = (s, fields, revision = s.revision) => s.h.dispatch('graphic.update', { coaId: s.coaId, expectedRevision: revision, ...fields });

  it('changes label, side, kind (within lines), points, and removes the colour override with null', async () => {
    const s = await withGraphics();
    const points = [...PL, { lat: 34.3, lng: -117.7 }];
    const value = okValue(await update(s, { graphicId: s.line.id, label: 'PL BLUE', side: 'hostile', kind: 'boundary', points, color: null }));
    assert.equal(value.revision, 4);
    assert.deepEqual(value.graphic, { id: s.line.id, kind: 'boundary', side: 'hostile', label: 'PL BLUE', points });
    assert.deepEqual(value.changed, ['kind', 'side', 'color', 'label', 'points']);
    const [event] = s.h.takeEvents();
    assert.equal(event.type, 'graphic.updated');
    assert.deepEqual(event.payload, value);
  });

  it('moves and resizes a range ring', async () => {
    const s = await withGraphics();
    const { graphic, changed } = okValue(await update(s, { graphicId: s.ring.id, center: { lat: 1, lng: 2 }, radius: 2500 }));
    assert.deepEqual([graphic.center, graphic.radius, changed], [{ lat: 1, lng: 2 }, 2500, ['center', 'radius']]);
  });

  it('a change to the same values is a no-op: no save, no event, same revision', async () => {
    const s = await withGraphics();
    const value = okValue(await update(s, { graphicId: s.line.id, label: ' PL GOLD ', color: '#112233', points: PL }));
    assert.equal(value.revision, 3);
    assert.deepEqual(value.changed, []);
    assert.deepEqual(s.h.takeEvents(), []);
  });

  it('refuses changing a line into an area or a ring, and geometry that does not fit the kind', async () => {
    const s = await withGraphics();
    assert.deepEqual(problemFields(errorOf(await update(s, { graphicId: s.line.id, kind: 'objective' }), 'VALIDATION_FAILED')), ['kind']);
    assert.deepEqual(problemFields(errorOf(await update(s, { graphicId: s.line.id, radius: 5 }), 'VALIDATION_FAILED')), ['radius']);
    assert.deepEqual(problemFields(errorOf(await update(s, { graphicId: s.ring.id, points: PL }), 'VALIDATION_FAILED')), ['points']);
    assert.deepEqual(problemFields(errorOf(await update(s, { graphicId: s.line.id, points: PL.slice(1) }), 'VALIDATION_FAILED')), ['points']);
  });

  it('is NOT_FOUND for an unknown graphic and CONFLICT for a stale revision', async () => {
    const s = await withGraphics();
    assert.deepEqual(errorOf(await update(s, { graphicId: 'gfx-404', label: 'x' }), 'NOT_FOUND').details, { coaId: s.coaId, graphicId: 'gfx-404' });
    errorOf(await update(s, { graphicId: s.line.id, label: 'x' }, 2), 'CONFLICT');
  });
});

describe('graphic.remove', () => {
  it('removes one graphic and emits graphic.removed; unknown ids are NOT_FOUND', async () => {
    const s = await setup();
    const a = okValue(await add(s, { kind: 'route', points: PL })).graphic;
    const b = okValue(await add(s, { kind: 'route', points: PL }, 2)).graphic;
    s.h.takeEvents();
    const value = okValue(await s.h.dispatch('graphic.remove', { coaId: s.coaId, expectedRevision: 3, graphicId: a.id }));
    assert.deepEqual(value, { coaId: s.coaId, revision: 4, graphicId: a.id });
    assert.deepEqual(s.h.takeEvents().map((e) => [e.type, e.payload]), [['graphic.removed', value]]);
    assert.deepEqual((await stored(s)).graphics.map((g) => g.id), [b.id]);
    errorOf(await s.h.dispatch('graphic.remove', { coaId: s.coaId, expectedRevision: 4, graphicId: a.id }), 'NOT_FOUND');
  });
});

describe('COAs carry their graphics', () => {
  it('a new COA has no graphics', async () => {
    const s = await setup();
    assert.deepEqual((await stored(s)).graphics, []);
  });

  it('coa.duplicate copies graphics with fresh ids', async () => {
    const s = await setup();
    const g = okValue(await add(s, { kind: 'objective', points: OBJ, label: 'OBJ' })).graphic;
    const copy = okValue(await s.h.dispatch('coa.duplicate', { coaId: s.coaId }));
    assert.equal(copy.graphics.length, 1);
    assert.notEqual(copy.graphics[0].id, g.id);
    assert.deepEqual({ ...copy.graphics[0], id: g.id }, g);
  });
});
