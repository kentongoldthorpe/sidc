// Weather CSV import (Epic 4, D37; docs/WEATHER-IMPORT.md): a forecast file (one row per period) or
// a light-data file (one row per day) → the rows weather.import takes. Units are named in the
// column headers and converted here: °F → °C, mph and km/h → kt, m and statute miles → km, m → ft,
// oktas → %, inches → mm. The core checks every value; problems here are only about reading the file.
import { readCsv, undefuse, writeCsv } from './csv.js';
import { headerLine } from '../../domain/export-header.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
/** column → [field, convert(number) → value] */
const NUMBER_COLUMNS = Object.freeze({
  temp_max_c: ['temperatureMaxC', (v) => v], temp_max_f: ['temperatureMaxC', (v) => round(((v - 32) * 5) / 9, 1)],
  temp_min_c: ['temperatureMinC', (v) => v], temp_min_f: ['temperatureMinC', (v) => round(((v - 32) * 5) / 9, 1)],
  wind_kt: ['windSpeedKt', (v) => v], wind_mph: ['windSpeedKt', (v) => round(v * 0.868976, 1)], wind_kmh: ['windSpeedKt', (v) => round(v * 0.539957, 1)],
  gust_kt: ['windGustKt', (v) => v], gust_mph: ['windGustKt', (v) => round(v * 0.868976, 1)], gust_kmh: ['windGustKt', (v) => round(v * 0.539957, 1)],
  wind_dir: ['windDirectionDeg', (v) => v],
  vis_km: ['visibilityKm', (v) => v], vis_m: ['visibilityKm', (v) => round(v / 1000, 3)], vis_sm: ['visibilityKm', (v) => round(v * 1.609344, 2)],
  ceiling_ft: ['ceilingFt', (v) => v], ceiling_m: ['ceilingFt', (v) => Math.round(v * 3.28084)],
  cloud_pct: ['cloudCoverPct', (v) => v], cloud_oktas: ['cloudCoverPct', (v) => round(v * 12.5, 1)],
  precip_mm: ['precipitationMm', (v) => v], precip_in: ['precipitationMm', (v) => round(v * 25.4, 1)],
  humidity_pct: ['humidityPct', (v) => v],
});
const TEXT_COLUMNS = Object.freeze({ precip: 'precipitation', notes: 'notes' });
const LIGHT_TIME_COLUMNS = Object.freeze(['bmnt', 'sunrise', 'sunset', 'eent', 'moonrise', 'moonset']);
const UNLIMITED = 100000; // "UNL": no ceiling
const PRECIP_WORDS = Object.freeze({ '': 'none', none: 'none', nil: 'none', drizzle: 'drizzle', rain: 'rain', showers: 'rain', snow: 'snow', sleet: 'sleet', 'freezing rain': 'freezingRain', freezingrain: 'freezingRain', fzra: 'freezingRain', hail: 'hail', thunderstorm: 'thunderstorm', thunderstorms: 'thunderstorm', ts: 'thunderstorm', tsra: 'thunderstorm' });
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;

/** "2026-11-25" or "25NOV26" / "25 NOV 2026" → "2026-11-25" (checked later by the core), else the text as given. */
export function readDate(text) {
  const t = text.trim().toUpperCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\s*([A-Z]{3})\s*(\d{2}|\d{4})$/.exec(t);
  if (m && MONTHS.includes(m[2])) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return text.trim();
}
/** "0000-1200", "AM", "1", "0000" … → "0000-1200"; "1200-2400", "PM", "2", "1200" → "1200-2400". */
export function readHalf(text) {
  const t = text.trim().toUpperCase().replace(/\s|Z/g, '');
  if (['0000-1200', '00-12', 'AM', '1', '0000', '00'].includes(t)) return '0000-1200';
  if (['1200-2400', '12-24', 'PM', '2', '1200', '12', '1200-0000'].includes(t)) return '1200-2400';
  return text.trim();
}
/** "0612" or "06:12" → "0612"; "--" or "" → no value. */
const readTime = (text) => { const t = text.trim(); if (t === '' || /^-+$/.test(t) || /^none$/i.test(t)) return undefined; return /^\d{1,2}:\d{2}$/.test(t) ? t.replace(':', '').padStart(4, '0') : t; };

const invalid = (problems) => err(ErrorCode.IMPORT_INVALID, 'The weather CSV file has problems', { problems });

/**
 * @param {string} text a CSV file
 * @returns {import('../../shared/result.js').Result<{ kind: 'periods'|'light', periods?: object[], light?: object[], where: (field: string) => string }>}
 *   where() turns a core problem field (periods[3].windSpeedKt) into "row 5, column wind_mph".
 */
export function readWeatherCsv(text) {
  const parsed = readCsv(text);
  if (!parsed.ok) return invalid([{ field: `row ${parsed.line}`, reason: parsed.reason }]);
  const [head, ...rows] = parsed.rows;
  const header = (head?.cells ?? []).map((h) => h.trim().toLowerCase());
  const kind = header.includes('period') ? 'periods' : LIGHT_TIME_COLUMNS.some((c) => header.includes(c)) || header.includes('illum_pct') ? 'light' : null;
  if (!kind) return invalid([{ field: 'row 1', reason: 'is not a weather header: a forecast file needs date and period columns; a light-data file needs date and light columns (see docs/WEATHER-IMPORT.md)' }]);
  const known = kind === 'periods' ? ['date', 'period', ...Object.keys(NUMBER_COLUMNS), ...Object.keys(TEXT_COLUMNS)] : ['date', ...LIGHT_TIME_COLUMNS, 'illum_pct'];
  const problems = [];
  if (!header.includes('date')) problems.push({ field: 'column date', reason: 'is required in the header row' });
  header.forEach((h, i) => {
    if (!known.includes(h)) problems.push({ field: `column ${h || i + 1}`, reason: 'is not a known column (see docs/WEATHER-IMPORT.md)' });
    else if (header.indexOf(h) !== i) problems.push({ field: `column ${h}`, reason: 'appears more than once' });
  });
  const fields = header.map((h) => (kind === 'periods' ? NUMBER_COLUMNS[h]?.[0] ?? TEXT_COLUMNS[h] : h));
  fields.forEach((f, i) => { if (f && fields.indexOf(f) !== i) problems.push({ field: `column ${header[i]}`, reason: `gives ${f} again (use one unit per value)` }); });
  if (problems.length) return invalid(problems);

  const lines = [];
  const out = [];
  for (const { line, cells } of rows) {
    if (cells.length > header.length) { problems.push({ field: `row ${line}`, reason: `has ${cells.length} cells but the header has ${header.length}` }); continue; }
    const row = {};
    header.forEach((column, i) => {
      const cell = undefuse((cells[i] ?? '').trim());
      if (column === 'date') { row.date = readDate(cell); return; }
      if (column === 'period') { row.half = readHalf(cell); return; }
      if (kind === 'light') {
        if (column === 'illum_pct') { if (cell !== '') row.illuminationPct = NUMBER.test(cell.replace('%', '')) ? Number(cell.replace('%', '')) : cell; }
        else { const t = readTime(cell); if (t !== undefined) row[column] = t; }
        return;
      }
      if (column in TEXT_COLUMNS) {
        if (column === 'precip') row.precipitation = PRECIP_WORDS[cell.toLowerCase()] ?? cell;
        else if (cell !== '') row.notes = cell;
        return;
      }
      if (cell === '') return;
      const [field, convert] = NUMBER_COLUMNS[column];
      if (field === 'ceilingFt' && /^(unl|unlimited|none|clr|skc)$/i.test(cell)) { row.ceilingFt = UNLIMITED; return; }
      row[field] = NUMBER.test(cell) ? convert(Number(cell)) : cell;
    });
    lines.push(line);
    out.push(row);
  }
  if (problems.length) return invalid(problems);
  if (out.length === 0) return invalid([{ field: 'row 2', reason: 'no rows after the header' }]);
  const columnOf = (field) => header[fields.indexOf(field === 'half' ? 'period' : field)] ?? (field === 'half' ? 'period' : field);
  const where = (problemField) => {
    const m = /^(?:periods|light)\[(\d+)\](?:\.(\w+))?/.exec(problemField);
    if (!m) return problemField;
    return m[2] ? `row ${lines[Number(m[1])]}, column ${columnOf(m[2])}` : `row ${lines[Number(m[1])]}`;
  };
  return ok({ kind, ...(kind === 'periods' ? { periods: out } : { light: out }), where });
}

// ---- writing (Epic 5 X-4): the same columns the import reads, so the files round-trip ----


export const FORECAST_CSV_COLUMNS = Object.freeze(['date', 'period', 'temp_max_c', 'temp_min_c', 'wind_kt', 'gust_kt', 'wind_dir', 'vis_km', 'ceiling_ft', 'cloud_pct', 'precip', 'precip_mm', 'humidity_pct', 'notes']);
const FORECAST_FIELDS = Object.freeze({ temp_max_c: 'temperatureMaxC', temp_min_c: 'temperatureMinC', wind_kt: 'windSpeedKt', gust_kt: 'windGustKt', wind_dir: 'windDirectionDeg', vis_km: 'visibilityKm', ceiling_ft: 'ceilingFt', cloud_pct: 'cloudCoverPct', precip: 'precipitation', precip_mm: 'precipitationMm', humidity_pct: 'humidityPct', notes: 'notes' });
export const LIGHT_CSV_COLUMNS = Object.freeze(['date', 'bmnt', 'sunrise', 'sunset', 'eent', 'moonrise', 'moonset', 'illum_pct']);
const PRECIP_OUT = Object.freeze({ freezingRain: 'freezing rain' });

const marked = (csv, header) => {
  if (!header) return csv;
  const bom = csv.startsWith('\uFEFF') ? '\uFEFF' : '';
  return `${bom}${headerLine(header)}\r\n${csv.slice(bom.length)}`;
};

/** A forecast's periods, in the import columns (ceiling 100000 written as UNL). */
export function writeForecastCsv(forecast, header = null) {
  const rows = forecast.periods.map((p) => FORECAST_CSV_COLUMNS.map((col) => {
    if (col === 'date') return p.date;
    if (col === 'period') return p.half;
    const v = p[FORECAST_FIELDS[col]];
    if (v === undefined) return '';
    if (col === 'ceiling_ft' && v >= UNLIMITED) return 'UNL';
    if (col === 'precip') return PRECIP_OUT[v] ?? v;
    return v;
  }));
  return marked(writeCsv(FORECAST_CSV_COLUMNS, rows), header);
}

/** A forecast's light data, in the import columns. */
export function writeLightCsv(forecast, header = null) {
  const rows = forecast.light.map((l) => [l.date, l.bmnt ?? '', l.sunrise ?? '', l.sunset ?? '', l.eent ?? '', l.moonrise ?? '', l.moonset ?? '', l.illuminationPct ?? '']);
  return marked(writeCsv(LIGHT_CSV_COLUMNS, rows), header);
}

/** The weather effects matrix: one row per critical value, one column per period (G, A, R or ?), then the reasons. */
export function writeMatrixCsv(matrix, header = null) {
  const LETTER = { green: 'G', amber: 'A', red: 'R', unknown: '?' };
  const columns = ['operation_or_system', 'group', 'example', ...matrix.periods.map((p) => `${p.date} ${p.half}`), 'reasons'];
  const rows = matrix.rows.map((r) => [r.name, r.group, r.example, ...r.cells.map((c) => LETTER[c.rating]),
    r.cells.map((c, i) => (c.rating === 'amber' || c.rating === 'red' ? `${matrix.periods[i].date} ${matrix.periods[i].half}: ${c.reasons.filter((x) => !/no data/.test(x)).join('; ')}` : '')).filter(Boolean).join(' | ')]);
  return marked(writeCsv(columns, rows), header);
}
