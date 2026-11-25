// Epic 5 X-4: threat models and weather leave the app in documented files.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness, okValue, errorOf } from '../support/app-harness.js';
import { readWeatherCsv, writeForecastCsv, writeLightCsv, writeMatrixCsv } from '../../src/adapters/files/weather-csv.js';

const INF = '10061000001211000000';
async function withModel(h = createHarness()) {
  let m = okValue(await h.dispatch('threat-model.create', { name: 'MRB attack', description: 'Forward detachment leads' }));
  m = okValue(await h.dispatch('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: {
    units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0, hvt: true, weapons: [{ name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 }] }],
    graphics: [{ id: 'g1', kind: 'axisOfAdvance', label: 'AXIS', points: [{ x: 0, y: -2000 }, { x: 0, y: 7000 }] }] } }));
  m = okValue(await h.dispatch('threat-coa.add', { modelId: m.id, expectedRevision: m.revision, name: 'COA 1', rank: 'mostLikely' }));
  m = okValue(await h.dispatch('threat-coa.update', { modelId: m.id, expectedRevision: m.revision, coaId: m.coas[0].id, statement: { who: 'MRB(-)' }, endState: 'Crossings held' }));
  return { h, m };
}

describe('threat-model.export and threat-model.import', () => {
  it('exports a threat model as one file, with the marking, in template metres', async () => {
    const { h, m } = await withModel();
    const doc = okValue(await h.query('threat-model.export', { modelId: m.id }));
    assert.deepEqual([doc.format, doc.version, doc.header.format, doc.header.classification], ['coa-builder/threat-model', 1, 'coa-builder/threat-model', 'UNCLASSIFIED']);
    assert.deepEqual(Object.keys(doc.model), ['name', 'description', 'formation', 'coas']);
    assert.deepEqual(doc.model.formation.units[0], m.formation.units[0]);
    assert.equal(doc.model.coas[0].statement.who, 'MRB(-)');
  });

  it('imports it as a new model elsewhere, keeping everything; a name already used gets (2)', async () => {
    const { h, m } = await withModel();
    const doc = okValue(await h.query('threat-model.export', { modelId: m.id }));
    const other = createHarness();
    const a = okValue(await other.dispatch('threat-model.import', { document: doc }));
    const strip = ({ id, revision, createdAt, updatedAt, ...rest }) => rest;
    assert.deepEqual(strip(a), strip(m));
    const b = okValue(await other.dispatch('threat-model.import', { document: doc }));
    assert.equal(b.name, 'MRB attack (2)');
    assert.deepEqual(other.takeEvents().map((e) => e.type), ['threat-model.created', 'threat-model.created']);
  });

  it('lists every problem in a file by path, and stores nothing', async () => {
    const { h, m } = await withModel();
    const doc = okValue(await h.query('threat-model.export', { modelId: m.id }));
    const bad = JSON.parse(JSON.stringify(doc));
    bad.model.formation.units[0].x = 'far';
    bad.model.coas[0].rank = 'best';
    bad.model.extra = 1;
    const e = errorOf(await createHarness().dispatch('threat-model.import', { document: bad }), 'IMPORT_INVALID');
    assert.deepEqual(e.details.problems.map((p) => p.field).sort(), ['model.coas[0].rank', 'model.extra', 'model.formation.units[0].x']);
    errorOf(await h.dispatch('threat-model.import', { document: { format: 'coa-builder/project', version: 1 } }), 'IMPORT_INVALID');
    assert.deepEqual(errorOf(await h.dispatch('threat-model.import', { document: { ...doc, version: 2 } }), 'UNSUPPORTED_VERSION').details, { found: 2, supported: [1] });
  });

  it('the schema in docs lists exactly the fields of the file', async () => {
    const schema = JSON.parse(readFileSync(new URL('../../docs/threat-model/threat-model.schema.json', import.meta.url), 'utf8'));
    const { h, m } = await withModel();
    const doc = okValue(await h.query('threat-model.export', { modelId: m.id }));
    assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(doc).sort());
    assert.deepEqual(Object.keys(schema.$defs.model.properties).sort(), Object.keys(doc.model).sort());
  });
});

describe('weather out: weather.export and the CSV files', () => {
  async function withWeather() {
    const h = createHarness();
    const f = okValue(await h.dispatch('weather.create', { name: 'AO IRON' }));
    okValue(await h.dispatch('weather.import', { forecastId: f.id, expectedRevision: 1, periods: [
      { date: '2026-11-25', half: '0000-1200', windSpeedKt: 10, ceilingFt: 100000, precipitation: 'none' },
      { date: '2026-11-25', half: '1200-2400', windSpeedKt: 42, ceilingFt: 800, precipitation: 'freezingRain', notes: 'Icing, "severe"' },
    ], light: [{ date: '2026-11-25', sunrise: '0629', illuminationPct: 38 }] }));
    okValue(await h.dispatch('weather-criterion.create', { name: 'Rotary wing', group: 'Aviation', rules: [{ factor: 'windSpeedKt', amber: 30, red: 40 }] }));
    return { h, f };
  }

  it('exports the forecast, critical values and effects matrix as one JSON document with the marking', async () => {
    const { h, f } = await withWeather();
    const doc = okValue(await h.query('weather.export', { forecastId: f.id }));
    assert.deepEqual([doc.format, doc.header.format, doc.forecast.name, doc.forecast.periods.length, doc.criteria[0].name], ['coa-builder/weather', 'coa-builder/weather', 'AO IRON', 2, 'Rotary wing']);
    assert.deepEqual(doc.matrix.rows[0].cells.map((c) => c.rating), ['green', 'red']);
  });

  it('writes the forecast and light data as CSV in the import format, so they import again unchanged', async () => {
    const { h, f } = await withWeather();
    const forecast = okValue(await h.query('weather.get', { forecastId: f.id }));
    const header = okValue(await h.query('export.header', { format: 'coa-builder/weather-csv' }));
    const periods = readWeatherCsv(writeForecastCsv(forecast, header));
    assert.equal(periods.ok, true, JSON.stringify(periods.error));
    const light = readWeatherCsv(writeLightCsv(forecast, header));
    const again = createHarness();
    const g = okValue(await again.dispatch('weather.create', { name: 'Copy' }));
    const copy = okValue(await again.dispatch('weather.import', { forecastId: g.id, expectedRevision: 1, periods: periods.value.periods, light: light.value.light }));
    assert.deepEqual(copy.periods, forecast.periods);
    assert.deepEqual(copy.light, forecast.light);
    assert.match(writeForecastCsv(forecast, header), /^﻿# UNCLASSIFIED \/\/ Default/);
  });

  it('writes the effects matrix as CSV: G, A, R or ? per period, and the reasons', async () => {
    const { h, f } = await withWeather();
    const matrix = okValue(await h.query('weather.matrix', { forecastId: f.id }));
    const lines = writeMatrixCsv(matrix).slice(1).trim().split('\r\n');
    assert.equal(lines[0], 'operation_or_system,group,example,2026-11-25 0000-1200,2026-11-25 1200-2400,reasons');
    assert.equal(lines[1], 'Rotary wing,Aviation,false,G,R,2026-11-25 1200-2400: Wind 42 kt ≥ 40 kt');
  });
});

describe('docs/THREAT-MODEL-FORMAT.md', () => {
  it('its example imports as written', async () => {
    const text = readFileSync(new URL('../../docs/THREAT-MODEL-FORMAT.md', import.meta.url), 'utf8');
    const doc = JSON.parse(text.match(/```json\n([\s\S]*?)```/)[1]);
    const m = okValue(await createHarness().dispatch('threat-model.import', { document: doc }));
    assert.deepEqual([m.name, m.formation.units.length, m.coas[0].rank, m.coas[0].template.units[0].end], ['MRB in the attack', 2, 'mostLikely', { x: -2500, y: 6000 }]);
  });
});
