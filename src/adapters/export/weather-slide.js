// Weather slide (Epic 4 W-5): a forecast as PNG slides for the IPB weather brief. Pure layout, like
// slide-layout.js: the painter (paint-slide.js) draws the items.
//
// One table per slide: dates and periods across the top, then three groups of rows: the weather
// effects matrix (G / A / R / ? cells, coloured), the forecast (only factors with data) and the
// light data (one value per day, across its periods). A legend and, if example critical values are
// used, a reminder to check them. Three days (six periods) per slide; more make more slides.
import { SLIDE_SIZES, COLORS, bands, slideChrome } from './slide-layout.js';
import { FACTORS } from '../../domain/weather.js';

export const PERIODS_PER_SLIDE = 6;
export const RATING_COLORS = Object.freeze({ green: '#2e7d32', amber: '#f2b600', red: '#c62828', unknown: '#9e9e9e' });
const RATING_TEXT = Object.freeze({ green: 'G', amber: 'A', red: 'R', unknown: '?' });
const RATING_INK = Object.freeze({ green: '#ffffff', amber: '#1c1f1a', red: '#ffffff', unknown: '#ffffff' });
const HALF_TEXT = Object.freeze({ '0000-1200': '0000–1200', '1200-2400': '1200–2400' });
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const PRECIP_TEXT = Object.freeze({ none: 'None', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', sleet: 'Sleet', freezingRain: 'Freezing rain', hail: 'Hail', thunderstorm: 'Thunderstorm' });
const LIGHT_ROWS = Object.freeze([['bmnt', 'BMNT'], ['sunrise', 'Sunrise'], ['sunset', 'Sunset'], ['eent', 'EENT'], ['moonrise', 'Moonrise'], ['moonset', 'Moonset'], ['illuminationPct', 'Moon illumination (%)']]);
const FORECAST_ROWS = Object.freeze([
  'temperatureMaxC', 'temperatureMinC', 'windSpeedKt', 'windGustKt', 'windDirectionDeg', 'visibilityKm', 'ceilingFt', 'cloudCoverPct', 'precipitation', 'precipitationMm', 'humidityPct',
]);

/** "25 NOV 26" */
export const dayText = (date) => { const [y, m, d] = date.split('-'); return `${d} ${MONTHS[Number(m) - 1]} ${y.slice(2)}`; };
const valueText = (factor, v) => {
  if (v === undefined || v === null) return '';
  if (factor === 'precipitation') return PRECIP_TEXT[v] ?? String(v);
  if (factor === 'ceilingFt' && v >= 100000) return 'UNL';
  return String(v);
};
const rowLabel = (factor) => (factor === 'precipitation' ? 'Precipitation type' : `${FACTORS[factor].label} (${FACTORS[factor].unit})`);

/**
 * @param {{ forecast: object, matrix: { periods: {date, half}[], rows: object[] } | null, aspect?: string,
 *           marking: { text: string, color: string }, dtg: string, perSlide?: number }} input
 * @returns {{ width: number, height: number, title: string, items: object[] }[]} one slide per block of periods
 */
export function layoutWeatherSlides({ forecast, matrix, aspect = '16:9', marking, dtg, perSlide = PERIODS_PER_SLIDE }) {
  const periods = forecast.periods;
  const blocks = [];
  for (let i = 0; i < Math.max(1, periods.length); i += perSlide) blocks.push(periods.slice(i, i + perSlide));
  return blocks.map((block, n) => layoutOne({ forecast, matrix, aspect, marking, dtg, block, page: n + 1, pages: blocks.length }));
}

function layoutOne({ forecast, matrix, aspect, marking, dtg, block, page, pages }) {
  const [W, H] = SLIDE_SIZES[aspect] ?? SLIDE_SIZES['16:9'];
  const { k, bannerH, headerH } = bands(H);
  const title = `Weather: ${forecast.name}${pages > 1 ? ` (${page} of ${pages})` : ''}`;
  const items = slideChrome({ W, H, marking, title, dtg });
  const pad = 24 * k;
  let y = bannerH + headerH + 4 * k;
  const sub = [forecast.area, `Times ${forecast.timeZone}`, 'Periods 0000–1200 and 1200–2400'].filter(Boolean).join(' · ');
  items.push({ kind: 'text', role: 'subtitle', x: pad, y: y + 12 * k, text: sub, size: 20 * k, weight: 400, color: COLORS.muted, align: 'left', maxWidth: W - 2 * pad });
  y += 34 * k;

  if (block.length === 0) {
    items.push({ kind: 'text', role: 'empty', x: W / 2, y: H / 2, text: 'No periods in this forecast yet.', size: 28 * k, weight: 400, color: COLORS.muted, align: 'center' });
    return { width: W, height: H, title, items };
  }

  // Columns: a label column, then one per period.
  const labelW = Math.min(420 * k, W * 0.26);
  const tableX = pad;
  const tableW = W - 2 * pad;
  const colW = (tableW - labelW) / block.length;
  const colX = (i) => tableX + labelW + i * colW;

  // Rows: which ones, and how tall they can be.
  const index = new Map((matrix?.periods ?? []).map((p, i) => [`${p.date} ${p.half}`, i]));
  const matrixRows = (matrix?.rows ?? []).map((r) => ({ ...r, cells: block.map((p) => r.cells[index.get(`${p.date} ${p.half}`)] ?? { rating: 'unknown', reasons: [] }) }));
  const forecastRows = FORECAST_ROWS.filter((f) => block.some((p) => p[f] !== undefined && p[f] !== null));
  const days = [];
  for (const [i, p] of block.entries()) { const last = days.at(-1); if (last?.date === p.date) last.n += 1; else days.push({ date: p.date, first: i, n: 1 }); }
  const lightOf = new Map((forecast.light ?? []).map((l) => [l.date, l]));
  const lightRows = LIGHT_ROWS.filter(([f]) => days.some((d) => lightOf.get(d.date)?.[f] !== undefined));
  const examples = (matrix?.rows ?? []).some((r) => r.example);
  const footerH = 40 * k;
  const bottom = H - bannerH - pad - footerH;
  const headH = 2 * 34 * k;
  const groups = [matrixRows.length ? 1 : 0, forecastRows.length ? 1 : 0, lightRows.length ? 1 : 0].reduce((a, b) => a + b, 0);
  const groupH = 32 * k;
  const room = bottom - y - headH - groups * groupH;
  const wanted = matrixRows.length + forecastRows.length + lightRows.length;
  const rowH = Math.max(22 * k, Math.min(32 * k, room / Math.max(1, wanted)));
  // Every row when they fit; else as many critical values as fit with a line saying how many are left out.
  const fitsAll = wanted * rowH <= room + 1e-6;
  const others = forecastRows.length + lightRows.length;
  const fitMatrix = fitsAll ? matrixRows.length : Math.max(0, Math.min(matrixRows.length, Math.floor((room - (others + 1) * rowH) / rowH + 1e-6)));
  const hidden = matrixRows.length - fitMatrix;
  const text = Math.min(19 * k, rowH * 0.62);

  const cellText = (role, x, yy, t, opts = {}) => items.push({ kind: 'text', role, x, y: yy, text: t, size: opts.size ?? text, weight: opts.weight ?? 400, color: opts.color ?? COLORS.text, align: opts.align ?? 'center', maxWidth: opts.maxWidth });
  const hLine = (yy, strong = false) => items.push({ kind: 'line', role: 'table-rule', x1: tableX, y1: yy, x2: tableX + tableW, y2: yy, color: strong ? COLORS.muted : COLORS.grid, width: strong ? 1.5 * k : 1 });

  // Header: days (across their periods) and periods.
  for (const d of days) {
    items.push({ kind: 'rect', role: 'table-head', x: colX(d.first), y, w: colW * d.n, h: headH, fill: '#eef0ea' });
    cellText('day', colX(d.first) + (colW * d.n) / 2, y + 17 * k, dayText(d.date), { weight: 700 });
    items.push({ kind: 'line', role: 'table-rule', x1: colX(d.first), y1: y, x2: colX(d.first), y2: bottom, color: COLORS.border, width: 1.5 * k });
  }
  block.forEach((p, i) => cellText('period', colX(i) + colW / 2, y + 51 * k, HALF_TEXT[p.half], { color: COLORS.muted }));
  y += headH;
  hLine(y, true);

  const group = (name) => {
    cellText('group', tableX + 6 * k, y + groupH / 2, name, { weight: 700, align: 'left', size: 20 * k });
    y += groupH;
    hLine(y);
  };
  const label = (t, maxWidth = labelW - 12 * k) => cellText('row-label', tableX + 6 * k, y + rowH / 2, t, { align: 'left', maxWidth });

  if (matrixRows.length) {
    group('Weather effects');
    for (const r of matrixRows.slice(0, fitMatrix)) {
      label(`${r.example ? '* ' : ''}${r.name}${r.group ? ` (${r.group})` : ''}`);
      r.cells.forEach((c, i) => {
        const inset = 3 * k;
        items.push({ kind: 'rect', role: `rating-${c.rating}`, x: colX(i) + inset, y: y + inset, w: colW - 2 * inset, h: rowH - 2 * inset, fill: RATING_COLORS[c.rating] });
        cellText('rating', colX(i) + colW / 2, y + rowH / 2, RATING_TEXT[c.rating], { weight: 700, color: RATING_INK[c.rating] });
      });
      y += rowH;
      hLine(y);
    }
    if (hidden > 0) { cellText('more', tableX + 6 * k, y + rowH / 2, `… and ${hidden} more (see the app)`, { align: 'left', color: COLORS.muted }); y += rowH; hLine(y); }
  }
  if (forecastRows.length) {
    group('Forecast');
    for (const f of forecastRows) {
      label(rowLabel(f));
      block.forEach((p, i) => cellText('value', colX(i) + colW / 2, y + rowH / 2, valueText(f, p[f]), { maxWidth: colW - 8 * k }));
      y += rowH;
      hLine(y);
    }
  }
  if (lightRows.length) {
    group('Light data');
    for (const [f, name] of lightRows) {
      label(name);
      for (const d of days) cellText('light', colX(d.first) + (colW * d.n) / 2, y + rowH / 2, String(lightOf.get(d.date)?.[f] ?? ''));
      y += rowH;
      hLine(y);
    }
  }

  // Footer: the legend, and a reminder when example critical values are used.
  const fy = H - bannerH - pad - footerH / 2;
  let fx = pad;
  for (const rating of ['green', 'amber', 'red', 'unknown']) {
    items.push({ kind: 'rect', role: 'legend-swatch', x: fx, y: fy - 11 * k, w: 22 * k, h: 22 * k, fill: RATING_COLORS[rating] });
    const word = { green: 'Favourable', amber: 'Marginal', red: 'Unfavourable', unknown: 'No data' }[rating];
    cellText('legend-label', fx + 30 * k, fy, word, { align: 'left', size: 18 * k });
    fx += 30 * k + word.length * 10 * k + 28 * k;
  }
  if (examples) cellText('examples-note', W - pad, fy, '* Example critical values, not doctrine: check them against your references.', { align: 'right', size: 18 * k, color: COLORS.muted, maxWidth: W - fx - 2 * pad });
  return { width: W, height: H, title, items };
}
