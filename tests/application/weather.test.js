// Epic 4 Weather (D35–D37): forecasts in 0000–1200 / 1200–2400 periods, light data, critical values
// and the weather effects matrix. Tested at the boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { InMemoryDocumentRepository } from '../../src/adapters/persistence/in-memory-document-repository.js';

async function withForecast() {
  const h = createHarness();
  const f = okValue(await h.dispatch('weather.create', { name: 'AO IRON', area: 'Valley north of the river' }));
  h.takeEvents();
  return { h, f };
}
const AM = '0000-1200';
const PM = '1200-2400';

describe('weather.create / update / list / get / delete', () => {
  it('creates a forecast (time zone Z by default) and publishes weather.created', async () => {
    const h = createHarness();
    const f = okValue(await h.dispatch('weather.create', { name: ' AO IRON ' }));
    assert.deepEqual([f.name, f.area, f.timeZone, f.periods, f.light, f.revision], ['AO IRON', '', 'Z', [], [], 1]);
    assert.deepEqual(h.takeEvents().map((e) => e.type), ['weather.created']);
    assert.deepEqual(okValue(await h.query('weather.list')).map((x) => [x.name, x.periodCount]), [['AO IRON', 0]]);
    assert.deepEqual(problemFields(errorOf(await h.dispatch('weather.create', { name: ' ' }), 'VALIDATION_FAILED')), ['name']);
  });

  it('renames, and deletes', async () => {
    const { h, f } = await withForecast();
    const u = okValue(await h.dispatch('weather.update', { forecastId: f.id, expectedRevision: 1, name: 'AO STEEL', timeZone: 'C' }));
    assert.deepEqual([u.name, u.timeZone, u.revision], ['AO STEEL', 'C', 2]);
    errorOf(await h.dispatch('weather.update', { forecastId: f.id, expectedRevision: 1, name: 'Late' }), 'CONFLICT');
    okValue(await h.dispatch('weather.delete', { forecastId: f.id, expectedRevision: 2 }));
    assert.deepEqual(okValue(await h.query('weather.list')), []);
    assert.deepEqual(errorOf(await h.query('weather.get', { forecastId: f.id }), 'NOT_FOUND').details, { forecastId: f.id });
  });
});

describe('weather.set-period (the form) and weather.set-light', () => {
  it('sets a period\'s values, merges later edits, removes a value with null, and keeps periods in order', async () => {
    const { h, f } = await withForecast();
    okValue(await h.dispatch('weather.set-period', { forecastId: f.id, expectedRevision: 1, date: '2026-11-25', half: PM, values: { temperatureMaxC: 12, windSpeedKt: 15, precipitation: 'rain', notes: 'Front passes' } }));
    okValue(await h.dispatch('weather.set-period', { forecastId: f.id, expectedRevision: 2, date: '2026-11-25', half: AM, values: { visibilityKm: 2 } }));
    const g = okValue(await h.dispatch('weather.set-period', { forecastId: f.id, expectedRevision: 3, date: '2026-11-25', half: PM, values: { windSpeedKt: 20, notes: null } }));
    assert.deepEqual(g.periods, [
      { date: '2026-11-25', half: AM, visibilityKm: 2 },
      { date: '2026-11-25', half: PM, temperatureMaxC: 12, windSpeedKt: 20, precipitation: 'rain' },
    ]);
  });

  it('checks every value and names each problem', async () => {
    const { h, f } = await withForecast();
    const e = errorOf(await h.dispatch('weather.set-period', { forecastId: f.id, expectedRevision: 1, date: '2026-02-30', half: '0600-1800', values: { windSpeedKt: -1, precipitation: 'frogs', temperatureMinC: 20, temperatureMaxC: 10, snowDepth: 3 } }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(e).sort(), ['date', 'half', 'values.precipitation', 'values.snowDepth', 'values.temperatureMinC', 'values.windSpeedKt']);
  });

  it('sets light data per day (times HHMM, illumination %), and removes a period or a day', async () => {
    const { h, f } = await withForecast();
    let g = okValue(await h.dispatch('weather.set-light', { forecastId: f.id, expectedRevision: 1, date: '2026-11-25', values: { bmnt: '0612', sunrise: '0640', sunset: '1702', eent: '1730', moonrise: '1915', moonset: '0830', illuminationPct: 42 } }));
    assert.deepEqual(g.light, [{ date: '2026-11-25', bmnt: '0612', sunrise: '0640', sunset: '1702', eent: '1730', moonrise: '1915', moonset: '0830', illuminationPct: 42 }]);
    assert.deepEqual(problemFields(errorOf(await h.dispatch('weather.set-light', { forecastId: f.id, expectedRevision: 2, date: '2026-11-26', values: { sunrise: '6:40', illuminationPct: 120 } }), 'VALIDATION_FAILED')).sort(), ['values.illuminationPct', 'values.sunrise']);
    g = okValue(await h.dispatch('weather.remove-light', { forecastId: f.id, expectedRevision: 2, date: '2026-11-25' }));
    assert.deepEqual(g.light, []);
    errorOf(await h.dispatch('weather.remove-period', { forecastId: f.id, expectedRevision: 3, date: '2026-11-25', half: AM }), 'NOT_FOUND');
  });
});

describe('weather.import (rows the CSV adapter reads)', () => {
  it('merges rows into the forecast, or replaces everything, all or nothing', async () => {
    const { h, f } = await withForecast();
    okValue(await h.dispatch('weather.set-period', { forecastId: f.id, expectedRevision: 1, date: '2026-11-24', half: AM, values: { windSpeedKt: 5 } }));
    let g = okValue(await h.dispatch('weather.import', { forecastId: f.id, expectedRevision: 2, periods: [
      { date: '2026-11-25', half: AM, windSpeedKt: 10 }, { date: '2026-11-25', half: PM, windSpeedKt: 25 },
    ], light: [{ date: '2026-11-25', illuminationPct: 5 }] }));
    assert.deepEqual(g.periods.map((p) => `${p.date} ${p.half}`), ['2026-11-24 0000-1200', '2026-11-25 0000-1200', '2026-11-25 1200-2400']);
    g = okValue(await h.dispatch('weather.import', { forecastId: f.id, expectedRevision: 3, mode: 'replace', periods: [{ date: '2026-11-26', half: AM, windSpeedKt: 1 }] }));
    assert.deepEqual([g.periods.length, g.light.length], [1, 0]);
    const e = errorOf(await h.dispatch('weather.import', { forecastId: f.id, expectedRevision: 4, periods: [{ date: '2026-11-27', half: AM }, { date: '2026-11-27', half: AM }, { date: 'x', half: PM, visibilityKm: 'far' }] }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(e).sort(), ['periods[1].half', 'periods[2].date', 'periods[2].visibilityKm']);
    assert.equal(okValue(await h.query('weather.get', { forecastId: f.id })).revision, 4, 'nothing changed');
  });
});

describe('critical values and the weather effects matrix (D36)', () => {
  const RW = { name: 'Rotary wing', group: 'Aviation', rules: [{ factor: 'ceilingFt', amber: 1000, red: 500 }, { factor: 'windSpeedKt', amber: 30, red: 40 }, { factor: 'precipitation', amber: ['snow'], red: ['thunderstorm'] }] };
  const NVG = { name: 'NVG', group: 'Sensors', rules: [{ factor: 'illuminationPct', amber: 25, red: 10 }] };

  it('creates critical values and refuses rules that make no sense', async () => {
    const h = createHarness();
    const c = okValue(await h.dispatch('weather-criterion.create', RW));
    assert.deepEqual({ ...c, id: 0 }, { id: 0, revision: 1, example: false, ...RW });
    const e = errorOf(await h.dispatch('weather-criterion.create', { name: 'Bad', rules: [{ factor: 'ceilingFt', amber: 500, red: 1000 }, { factor: 'mood' }, { factor: 'windSpeedKt' }, { factor: 'precipitation', red: ['frogs'] }] }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(e).sort(), ['rules[0].red', 'rules[1].factor', 'rules[2]', 'rules[3].red']);
  });

  it('rates each criterion per period: the worst rule wins, with the reasons; no data is unknown', async () => {
    const { h, f } = await withForecast();
    okValue(await h.dispatch('weather-criterion.create', RW));
    okValue(await h.dispatch('weather-criterion.create', NVG));
    okValue(await h.dispatch('weather.import', { forecastId: f.id, expectedRevision: 1, periods: [
      { date: '2026-11-25', half: AM, ceilingFt: 3000, windSpeedKt: 10, precipitation: 'none' },
      { date: '2026-11-25', half: PM, ceilingFt: 800, windSpeedKt: 42, precipitation: 'rain' },
      { date: '2026-11-26', half: AM, ceilingFt: 2000 },
    ], light: [{ date: '2026-11-25', illuminationPct: 8 }] }));
    const m = okValue(await h.query('weather.matrix', { forecastId: f.id }));
    assert.deepEqual(m.periods, [{ date: '2026-11-25', half: AM }, { date: '2026-11-25', half: PM }, { date: '2026-11-26', half: AM }]);
    assert.deepEqual(m.rows.map((r) => [r.name, r.cells.map((c) => c.rating)]), [['Rotary wing', ['green', 'red', 'green']], ['NVG', ['red', 'red', 'unknown']]]);
    assert.deepEqual(m.rows[0].cells[1].reasons.slice(0, 2), ['Wind 42 kt ≥ 40 kt', 'Ceiling 800 ft ≤ 1000 ft']);
    assert.ok(m.rows[0].cells[2].reasons.includes('Wind: no data'));
  });

  it('adds the starter set only when asked, marked as examples; editing one makes it the user\'s own', async () => {
    const h = createHarness();
    assert.deepEqual(okValue(await h.query('weather-criterion.list')), []);
    const { criteria } = okValue(await h.dispatch('weather-criterion.add-examples', {}));
    assert.ok(criteria.length >= 5 && criteria.every((c) => c.example));
    assert.deepEqual(okValue(await h.dispatch('weather-criterion.add-examples', {})).criteria, [], 'not twice');
    const edited = okValue(await h.dispatch('weather-criterion.update', { criterionId: criteria[0].id, expectedRevision: 1, rules: [{ factor: 'windSpeedKt', red: 35 }] }));
    assert.equal(edited.example, false);
    okValue(await h.dispatch('weather-criterion.delete', { criterionId: criteria[0].id, expectedRevision: 2 }));
  });
});

describe('weather belongs to the project', () => {
  it('stays in its project and travels in the project file', async () => {
    const { h, f } = await withForecast();
    okValue(await h.dispatch('weather.set-period', { forecastId: f.id, expectedRevision: 1, date: '2026-11-25', half: AM, values: { windSpeedKt: 5 } }));
    okValue(await h.dispatch('weather-criterion.add-examples', {}));
    const doc = okValue(await h.query('project.export'));
    assert.equal(doc.weatherForecasts.length, 1);
    const docs = new InMemoryDocumentRepository();
    const project = okValue(await createHarness({ documentRepository: docs }).dispatch('project.import', { document: doc }));
    const inside = createHarness({ documentRepository: docs, projectId: project.id });
    assert.deepEqual(okValue(await inside.query('weather.get', { forecastId: f.id })).periods, [{ date: '2026-11-25', half: AM, windSpeedKt: 5 }]);
    assert.ok(okValue(await inside.query('weather-criterion.list')).length >= 5);
    assert.deepEqual(okValue(await createHarness({ documentRepository: docs }).query('weather.list')), [], 'not in the Default project');
  });
});
