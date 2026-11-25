// E6-1: MGRS wherever a position goes in (messages, JSON and CSV imports); stored as lat/lng.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { readImportFile } from '../../src/adapters/files/import-file.js';
import { writeCoaData } from '../../src/adapters/files/coa-data.js';
import { parseMgrs, mgrsOf } from '../../src/domain/mgrs.js';

const INF = '10031000001211000000';
const GRID = '18S UJ 2348 0648';
const centre = () => { const { lat, lng } = parseMgrs(GRID); return { lat, lng }; };

async function setup() {
  const h = createHarness();
  const coa = okValue(await h.dispatch('coa.create', { name: 'COA 1' }));
  return { h, coaId: coa.id };
}

describe('positions given as MGRS', () => {
  it('symbol.add and symbol.move take { mgrs }, stored as the centre of the square, shown back as typed', async () => {
    const s = await setup();
    const { symbol } = okValue(await s.h.dispatch('symbol.add', { coaId: s.coaId, expectedRevision: 1, sidc: INF, position: { mgrs: '18SUJ23480648' } }));
    assert.deepEqual(symbol.position, centre());
    assert.equal(mgrsOf(symbol.position), GRID);
    const moved = okValue(await s.h.dispatch('symbol.move', { coaId: s.coaId, expectedRevision: 2, symbolId: symbol.id, position: { mgrs: '18S UJ 2350 0650' } }));
    assert.equal(mgrsOf(moved.symbol.position), '18S UJ 2350 0650');
  });

  it('says what is wrong with a reference, and refuses MGRS mixed with lat/lng in one position', async () => {
    const s = await setup();
    const bad = errorOf(await s.h.dispatch('symbol.add', { coaId: s.coaId, expectedRevision: 1, sidc: INF, position: { mgrs: '18S UJ 2348 064' } }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(bad), ['position.mgrs']);
    assert.match(bad.details.problems[0].reason, /same number of digits/);
    const mixed = errorOf(await s.h.dispatch('symbol.add', { coaId: s.coaId, expectedRevision: 1, sidc: INF, position: { mgrs: GRID, lat: 1 } }), 'VALIDATION_FAILED');
    assert.match(mixed.details.problems[0].reason, /either \{ lat, lng \} or \{ mgrs \}/);
  });

  it('lines take MGRS points (mixed with lat/lng if wanted), rings an MGRS centre, a placement an MGRS anchor', async () => {
    const s = await setup();
    const line = okValue(await s.h.dispatch('graphic.add', { coaId: s.coaId, expectedRevision: 1, kind: 'phaseLine', points: [{ mgrs: GRID }, { lat: 38.9, lng: -77 }] })).graphic;
    assert.deepEqual(line.points[0], centre());
    const ring = okValue(await s.h.dispatch('graphic.add', { coaId: s.coaId, expectedRevision: 2, kind: 'rangeRing', center: { mgrs: GRID }, radius: 1000 })).graphic;
    assert.deepEqual(ring.center, centre());
    const m = okValue(await s.h.dispatch('threat-model.create', { name: 'MRB' }));
    const placed = okValue(await s.h.dispatch('threat-coa.place', { modelId: m.id, play: 'formation', anchor: { mgrs: GRID }, bearing: 0, positions: 'start' }));
    const coa = okValue(await s.h.query('coa.get', { coaId: placed.coaId ?? placed.id ?? placed.coa?.id }));
    assert.deepEqual(coa.source.anchor, centre());
  });
});

describe('importing MGRS (coa.import, CSV)', () => {
  const doc = (unit) => ({ format: 'coa-builder/import', version: 1, coas: [{ name: 'A', units: [{ sidc: INF, ...unit }] }] });

  it('takes a unit with mgrs instead of lat and lng', async () => {
    const h = createHarness();
    const { coas } = okValue(await h.dispatch('coa.import', { document: doc({ mgrs: GRID, label: 'A' }) }));
    const coa = okValue(await h.query('coa.get', { coaId: coas[0].id }));
    assert.deepEqual(coa.symbols[0].position, centre());
  });

  it('takes both when they agree (lat/lng kept, as the more precise), and refuses them when they do not', async () => {
    const h = createHarness();
    const p = { lat: 38.8895, lng: -77.0352 };
    okValue(await h.dispatch('coa.import', { document: doc({ ...p, mgrs: GRID }) }));
    const wrong = errorOf(await h.dispatch('coa.import', { document: doc({ ...p, mgrs: '18S UJ 2384 0648' }) }), 'IMPORT_INVALID');
    assert.deepEqual(problemFields(wrong), ['coas[0].units[0].mgrs']);
    assert.match(wrong.details.problems[0].reason, /does not match lat 38.8895, lng -77.0352/);
    const unreadable = errorOf(await h.dispatch('coa.import', { document: doc({ ...p, mgrs: 'UJ 2348' }) }), 'IMPORT_INVALID');
    assert.deepEqual(problemFields(unreadable), ['coas[0].units[0].mgrs']);
    const none = errorOf(await h.dispatch('coa.import', { document: doc({ mgrs: '18S UJ 234' }) }), 'IMPORT_INVALID');
    assert.deepEqual(problemFields(none), ['coas[0].units[0].mgrs']);
  });

  it('reads a CSV with an mgrs column instead of lat and lng, naming the row and column of a bad grid', async () => {
    const ok = readImportFile('coa,sidc,mgrs,label\nPlan A,' + INF + ',18S UJ 2348 0648,1-22 IN\n');
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    const h = createHarness();
    const { coas } = okValue(await h.dispatch('coa.import', { document: ok.value.document }));
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coas[0].id })).symbols[0].position, centre());
    const bad = readImportFile('coa,sidc,mgrs\nPlan A,' + INF + ',18S UJ 2348 064\n');
    const e = errorOf(await createHarness().dispatch('coa.import', { document: bad.value.document }), 'IMPORT_INVALID');
    assert.equal(bad.value.where(e.details.problems[0].field), 'row 2, column mgrs');
    const neither = readImportFile('coa,sidc,label\nPlan A,' + INF + ',x\n');
    assert.deepEqual(neither.error.details.problems.map((p) => p.field), ['column lat', 'column lng']);
    assert.match(neither.error.details.problems[0].reason, /or give an mgrs column/);
  });

  it('round-trips our CSV export, which has lat, lng and mgrs', async () => {
    const h = createHarness();
    const coa = okValue(await h.dispatch('coa.create', { name: 'A' }));
    okValue(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INF, position: { lat: 38.8895, lng: -77.0352 }, label: 'A' }));
    const csv = writeCoaData('csv', [okValue(await h.query('coa.get', { coaId: coa.id }))]);
    assert.match(csv, /38\.8895,-77\.0352,18S UJ 23486 06483,A/);
    const read = readImportFile(csv);
    okValue(await createHarness().dispatch('coa.import', { document: read.value.document }));
  });
});
