// Epic 4 W-5: the weather slide layout.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutWeatherSlides, RATING_COLORS, dayText } from '../../../src/adapters/export/weather-slide.js';
import { SLIDE_SIZES } from '../../../src/adapters/export/slide-layout.js';

const MARKING = { text: 'UNCLASSIFIED', color: '#007a33' };
const day = (d, n) => `2026-11-${String(d).padStart(2, '0')}`;
const periods = (days) => Array.from({ length: days }, (_, i) => ['0000-1200', '1200-2400'].map((half) => ({ date: day(25 + i), half, windSpeedKt: 10 + i, ceilingFt: i === 0 ? 100000 : 800, precipitation: i === 1 ? 'freezingRain' : 'none' }))).flat();
const FORECAST = { name: 'AO IRON', area: 'River valley', timeZone: 'Z', periods: periods(2), light: [{ date: '2026-11-25', sunrise: '0629', illuminationPct: 38 }] };
const matrixFor = (f, rows = 2) => ({
  periods: f.periods.map(({ date, half }) => ({ date, half })),
  rows: Array.from({ length: rows }, (_, r) => ({ criterionId: `c${r}`, name: `System ${r}`, group: 'Aviation', example: r === 0, cells: f.periods.map((_, i) => ({ rating: ['green', 'amber', 'red', 'unknown'][(i + r) % 4], reasons: [] })) })),
});
const byRole = (s, role) => s.items.filter((i) => i.role === role);
const texts = (s, role) => byRole(s, role).map((i) => i.text);

describe('layoutWeatherSlides', () => {
  it('makes one slide with the marking, the forecast name, area and period header', () => {
    const [s] = layoutWeatherSlides({ forecast: FORECAST, matrix: matrixFor(FORECAST), marking: MARKING, dtg: '250800ZNOV26' });
    assert.deepEqual([s.width, s.height], SLIDE_SIZES['16:9']);
    assert.deepEqual(texts(s, 'banner-text'), ['UNCLASSIFIED', 'UNCLASSIFIED']);
    assert.equal(texts(s, 'title')[0], 'Weather: AO IRON');
    assert.match(texts(s, 'subtitle')[0], /^River valley · Times Z/);
    assert.deepEqual(texts(s, 'day'), ['25 NOV 26', '26 NOV 26']);
    assert.deepEqual(texts(s, 'period'), ['0000–1200', '1200–2400', '0000–1200', '1200–2400']);
  });

  it('draws the effects matrix as coloured G / A / R / ? cells, examples starred with a reminder', () => {
    const [s] = layoutWeatherSlides({ forecast: FORECAST, matrix: matrixFor(FORECAST), marking: MARKING, dtg: 'x' });
    assert.deepEqual(texts(s, 'rating'), ['G', 'A', 'R', '?', 'A', 'R', '?', 'G']);
    assert.equal(byRole(s, 'rating-green')[0].fill, RATING_COLORS.green);
    assert.ok(texts(s, 'row-label').includes('* System 0 (Aviation)'));
    assert.match(texts(s, 'examples-note')[0], /^\* Example critical values/);
    assert.deepEqual(texts(s, 'legend-label'), ['Favourable', 'Marginal', 'Unfavourable', 'No data']);
  });

  it('shows only forecast factors with data, in words and UNL; light data across each day', () => {
    const [s] = layoutWeatherSlides({ forecast: FORECAST, matrix: matrixFor(FORECAST), marking: MARKING, dtg: 'x' });
    assert.deepEqual(texts(s, 'group'), ['Weather effects', 'Forecast', 'Light data']);
    const labels = texts(s, 'row-label');
    assert.ok(labels.includes('Wind (kt)') && labels.includes('Ceiling (ft)') && labels.includes('Precipitation type'));
    assert.ok(!labels.includes('Humidity (%)'), 'no data, no row');
    assert.ok(texts(s, 'value').includes('UNL') && texts(s, 'value').includes('Freezing rain'));
    assert.deepEqual(texts(s, 'light'), ['0629', '', '38', '']);
    assert.ok(labels.includes('Sunrise') && !labels.includes('Moonset'));
  });

  it('makes a slide per three days, numbered', () => {
    const f = { ...FORECAST, periods: periods(4) };
    const slides = layoutWeatherSlides({ forecast: f, matrix: matrixFor(f), marking: MARKING, dtg: 'x' });
    assert.deepEqual(slides.map((s) => s.title), ['Weather: AO IRON (1 of 2)', 'Weather: AO IRON (2 of 2)']);
    assert.deepEqual(texts(slides[1], 'day'), ['28 NOV 26']);
    assert.deepEqual(texts(slides[1], 'rating').length, 2 * 2);
  });

  it('keeps everything on the slide: with many critical values it says how many are left out', () => {
    const slides = layoutWeatherSlides({ forecast: FORECAST, matrix: matrixFor(FORECAST, 40), marking: MARKING, dtg: 'x' });
    const [s] = slides;
    const bottom = s.height - 36;
    const chrome = new Set(['background', 'banner-top', 'banner-bottom', 'banner-text']);
    const over = s.items.filter((i) => !chrome.has(i.role) && Math.max((i.y ?? 0) + (i.h ?? 0), i.y1 ?? 0, i.y2 ?? 0) > bottom + 1);
    assert.deepEqual(over.map((i) => i.role), [], 'nothing over the bottom banner');
    assert.match(texts(s, 'more')[0], /^… and \d+ more \(see the app\)$/);
  });

  it('shows every row when they fit, with no "more" line (seven critical values and every factor)', () => {
    const full = { ...FORECAST, periods: FORECAST.periods.map((p) => ({ ...p, temperatureMaxC: 9, temperatureMinC: 2, windGustKt: 20, windDirectionDeg: 270, visibilityKm: 8, cloudCoverPct: 40, precipitationMm: 1, humidityPct: 70 })),
      light: ['2026-11-25', '2026-11-26'].map((date) => ({ date, bmnt: '0601', sunrise: '0629', sunset: '1648', eent: '1716', moonrise: '1302', moonset: '0012', illuminationPct: 38 })) };
    const [s] = layoutWeatherSlides({ forecast: full, matrix: matrixFor(full, 7), marking: MARKING, dtg: 'x' });
    assert.equal(byRole(s, 'more').length, 0);
    assert.equal(texts(s, 'rating').length, 7 * 4);
  });

  it('says when there is nothing to show, and fits 4:3', () => {
    const [s] = layoutWeatherSlides({ forecast: { ...FORECAST, periods: [], light: [] }, matrix: null, marking: MARKING, dtg: 'x', aspect: '4:3' });
    assert.deepEqual([s.width, s.height], SLIDE_SIZES['4:3']);
    assert.equal(texts(s, 'empty')[0], 'No periods in this forecast yet.');
    assert.equal(dayText('2026-01-05'), '05 JAN 26');
  });
});
