// Epic 4 W-3: the weather CSV files (docs/WEATHER-IMPORT.md) → rows for weather.import.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWeatherCsv, readDate, readHalf } from '../../../src/adapters/files/weather-csv.js';
import { createHarness, okValue, errorOf } from '../../support/app-harness.js';

const example = (name) => readFileSync(new URL(`../../../docs/weather/examples/${name}`, import.meta.url), 'utf8');
const value = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };

describe('readWeatherCsv', () => {
  it('reads a forecast file: one row per period, UNL ceiling, precipitation words', () => {
    const { kind, periods } = value(readWeatherCsv(example('forecast.csv')));
    assert.equal(kind, 'periods');
    assert.equal(periods.length, 4);
    assert.deepEqual(periods[0], { date: '2026-11-25', half: '0000-1200', temperatureMaxC: 9, temperatureMinC: 2, windSpeedKt: 8, windGustKt: 12, windDirectionDeg: 270, visibilityKm: 10, ceilingFt: 100000, cloudCoverPct: 20, precipitation: 'none', precipitationMm: 0, humidityPct: 70 });
    assert.equal(periods[2].precipitation, 'thunderstorm');
    assert.equal(periods[1].notes, 'Front arrives late afternoon');
  });

  it('converts US units and reads military dates and AM/PM periods', () => {
    const { periods } = value(readWeatherCsv(example('forecast-us-units.csv')));
    assert.deepEqual(periods[1], { date: '2026-11-25', half: '1200-2400', temperatureMaxC: 12.8, temperatureMinC: 6.1, windSpeedKt: 18.2, windGustKt: 27.8, visibilityKm: 6.44, ceilingFt: 2500, cloudCoverPct: 62.5, precipitation: 'rain', precipitationMm: 3.8 });
  });

  it('reads a light-data file (HHMM or HH:MM)', () => {
    const { kind, light } = value(readWeatherCsv(example('light.csv')));
    assert.equal(kind, 'light');
    assert.deepEqual(light[0], { date: '2026-11-25', bmnt: '0601', sunrise: '0629', sunset: '1648', eent: '1716', moonrise: '1302', moonset: '0012', illuminationPct: 38 });
    assert.equal(value(readWeatherCsv('date,sunrise\n2026-11-25,6:29\n')).light[0].sunrise, '0629');
  });

  it('refuses unknown or doubled columns and files that are not weather', () => {
    const problems = (text) => readWeatherCsv(text).error.details.problems.map((p) => p.field);
    assert.deepEqual(problems('date,period,wind_kt,wind_mph,colour\n'), ['column colour', 'column wind_mph']);
    assert.deepEqual(problems('coa,sidc\nA,1\n'), ['row 1']);
  });

  it('every example imports through the app, and core problems point at row and column', async () => {
    const h = createHarness();
    const f = okValue(await h.dispatch('weather.create', { name: 'AO' }));
    let rev = 1;
    for (const name of ['forecast.csv', 'forecast-us-units.csv', 'light.csv']) {
      const { periods, light } = value(readWeatherCsv(example(name)));
      rev = okValue(await h.dispatch('weather.import', { forecastId: f.id, expectedRevision: rev, ...(periods ? { periods } : {}), ...(light ? { light } : {}) })).revision;
    }
    const bad = value(readWeatherCsv('date,period,wind_kt\n2026-11-25,AM,fast\n2026-13-40,PM,5\n'));
    const e = errorOf(await h.dispatch('weather.import', { forecastId: f.id, expectedRevision: rev, periods: bad.periods }), 'VALIDATION_FAILED');
    assert.deepEqual(e.details.problems.map((p) => bad.where(p.field)), ['row 2, column wind_kt', 'row 3, column date']);
  });
});

describe('readDate and readHalf', () => {
  it('reads common ways of writing a date and a period', () => {
    assert.deepEqual(['2026-11-25', '25NOV26', '25 nov 2026', '5JAN27'].map(readDate), ['2026-11-25', '2026-11-25', '2026-11-25', '2027-01-05']);
    assert.deepEqual(['0000-1200', 'AM', '1', '1200-2400', 'pm', '2', '1200Z-2400Z'].map(readHalf), ['0000-1200', '0000-1200', '0000-1200', '1200-2400', '1200-2400', '1200-2400', '1200-2400']);
  });
});
