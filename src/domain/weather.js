// Weather (Epic 4, IPB/IPOE step 2: environmental effects), decisions D35–D37.
//
//   Forecast  { id, revision, name, area, timeZone, createdAt, updatedAt,
//               periods: Period[]  (sorted by date, then half),
//               light:   Light[]   (sorted by date) }
//   Period    { date: "YYYY-MM-DD", half: "0000-1200" | "1200-2400", ...factors (any may be missing) }
//   Light     { date, bmnt?, sunrise?, sunset?, eent?, moonrise?, moonset? ("HHMM"), illuminationPct? }
//   Criterion { id, revision, name, group, example, rules: Rule[] }  (critical values)
//   Rule      { factor, amber?, red? }   numbers, or lists of precipitation types for "precipitation"
//
// A period is rated against a criterion: each rule gives green, amber or red (or unknown without
// the data); the worst wins. Factors where lower is worse (visibility, ceiling, minimum temperature,
// illumination) are rated "at or below"; the others "at or above".
import { deepFreeze } from '../shared/freeze.js';
import { isObject } from '../shared/values.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { jsonEqual } from './map-symbol.js';

export const HALVES = Object.freeze(['0000-1200', '1200-2400']);
export const PRECIPITATION_TYPES = Object.freeze(['none', 'drizzle', 'rain', 'snow', 'sleet', 'freezingRain', 'hail', 'thunderstorm']);
export const RATINGS = Object.freeze(['green', 'amber', 'red', 'unknown']);
export const NAME_MAX = 80;
export const AREA_MAX = 120;
export const NOTES_MAX = 200;
export const MAX_PERIODS = 400;
export const MAX_RULES = 20;

/** The numeric factors of a period: label, unit, limits, and which way is worse. */
export const FACTORS = Object.freeze({
  temperatureMaxC: { label: 'Max temperature', unit: '°C', min: -80, max: 70, worse: 'higher' },
  temperatureMinC: { label: 'Min temperature', unit: '°C', min: -80, max: 70, worse: 'lower' },
  windSpeedKt: { label: 'Wind', unit: 'kt', min: 0, max: 250, worse: 'higher' },
  windGustKt: { label: 'Gusts', unit: 'kt', min: 0, max: 250, worse: 'higher' },
  windDirectionDeg: { label: 'Wind from', unit: '°', min: 0, max: 359.999, worse: null },
  visibilityKm: { label: 'Visibility', unit: 'km', min: 0, max: 200, worse: 'lower' },
  ceilingFt: { label: 'Ceiling', unit: 'ft', min: 0, max: 100000, worse: 'lower' },
  cloudCoverPct: { label: 'Cloud cover', unit: '%', min: 0, max: 100, worse: 'higher' },
  precipitationMm: { label: 'Precipitation', unit: 'mm', min: 0, max: 1000, worse: 'higher' },
  humidityPct: { label: 'Humidity', unit: '%', min: 0, max: 100, worse: 'higher' },
});
/** Factors a rule can use: the numeric ones that have a worse direction, illumination and precipitation type. */
export const RULE_FACTORS = Object.freeze([...Object.keys(FACTORS).filter((f) => FACTORS[f].worse), 'illuminationPct', 'precipitation']);
const RULE_WORSE = Object.freeze({ ...Object.fromEntries(Object.entries(FACTORS).map(([k, v]) => [k, v.worse])), illuminationPct: 'lower' });
export const FACTOR_LABELS = Object.freeze({ ...Object.fromEntries(Object.entries(FACTORS).map(([k, v]) => [k, v.label])), illuminationPct: 'Illumination', precipitation: 'Precipitation type' });
export const FACTOR_UNITS = Object.freeze({ ...Object.fromEntries(Object.entries(FACTORS).map(([k, v]) => [k, v.unit])), illuminationPct: '%', precipitation: '' });

const LIGHT_TIMES = Object.freeze(['bmnt', 'sunrise', 'sunset', 'eent', 'moonrise', 'moonset']);
export const LIGHT_FIELDS = Object.freeze([...LIGHT_TIMES, 'illuminationPct']);
const PERIOD_FIELDS = Object.freeze([...Object.keys(FACTORS), 'precipitation', 'notes']);

const invalid = (problems) => err(ErrorCode.VALIDATION_FAILED, 'The weather data is not valid', { problems });
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const where = (at, field) => (at ? `${at}.${field}` : field);

/** "YYYY-MM-DD", a real calendar date. */
export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return days !== undefined && d >= 1 && d <= days;
}
/** "HHMM", 0000 to 2359 (2400 is allowed too, for the end of a day). */
export const isTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3])[0-5]\d$|^2400$/.test(value);

function checkText(field, value, max, required = false) {
  if (typeof value !== 'string') return [{ field, reason: 'must be text' }];
  if (required && value.trim() === '') return [{ field, reason: 'must not be blank' }];
  if (value.trim().length > max) return [{ field, reason: `must be at most ${max} characters` }];
  return [];
}

/** The forecast's own fields (name, area, timeZone), whichever are present. */
export function checkForecastFields(fields) {
  const problems = [];
  if ('name' in fields) problems.push(...checkText('name', fields.name, NAME_MAX, true));
  if ('area' in fields) problems.push(...checkText('area', fields.area, AREA_MAX));
  if ('timeZone' in fields) problems.push(...checkText('timeZone', fields.timeZone, 12, true));
  return problems;
}

/**
 * One period's values (all optional; null clears one). @returns {{ problems, value }} value holds the
 * values given, normalised; null stays null (it removes the value on an update).
 */
export function parsePeriodValues(raw, at = 'values') {
  if (!isObject(raw)) return { problems: [{ field: at, reason: 'must be an object of weather values' }], value: {} };
  const problems = Object.keys(raw).filter((k) => !PERIOD_FIELDS.includes(k)).map((k) => ({ field: where(at, k), reason: 'unknown field' }));
  const value = {};
  for (const [key, rule] of Object.entries(FACTORS)) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v === null) value[key] = null;
    else if (isNumber(v) && v >= rule.min && v <= rule.max) value[key] = v;
    else problems.push({ field: where(at, key), reason: `must be a number from ${rule.min} to ${rule.max} ${rule.unit}` });
  }
  if ('precipitation' in raw) {
    if (raw.precipitation === null || PRECIPITATION_TYPES.includes(raw.precipitation)) value.precipitation = raw.precipitation;
    else problems.push({ field: where(at, 'precipitation'), reason: `must be one of ${PRECIPITATION_TYPES.join(', ')}` });
  }
  if ('notes' in raw) {
    if (raw.notes === null) value.notes = null;
    else { const p = checkText(where(at, 'notes'), raw.notes, NOTES_MAX); if (p.length) problems.push(...p); else value.notes = raw.notes.trim(); }
  }
  if (isNumber(value.temperatureMinC) && isNumber(value.temperatureMaxC) && value.temperatureMinC > value.temperatureMaxC) {
    problems.push({ field: where(at, 'temperatureMinC'), reason: 'must not be above the maximum temperature' });
  }
  if (isNumber(value.windGustKt) && isNumber(value.windSpeedKt) && value.windGustKt < value.windSpeedKt) {
    problems.push({ field: where(at, 'windGustKt'), reason: 'must not be below the wind speed' });
  }
  return { problems, value };
}

/** One day's light data. */
export function parseLightValues(raw, at = 'values') {
  if (!isObject(raw)) return { problems: [{ field: at, reason: 'must be an object of light data' }], value: {} };
  const problems = Object.keys(raw).filter((k) => !LIGHT_FIELDS.includes(k)).map((k) => ({ field: where(at, k), reason: 'unknown field' }));
  const value = {};
  for (const key of LIGHT_TIMES) {
    if (!(key in raw)) continue;
    if (raw[key] === null || isTime(raw[key])) value[key] = raw[key];
    else problems.push({ field: where(at, key), reason: 'must be a time HHMM, 0000 to 2359' });
  }
  if ('illuminationPct' in raw) {
    const v = raw.illuminationPct;
    if (v === null || (isNumber(v) && v >= 0 && v <= 100)) value.illuminationPct = v;
    else problems.push({ field: where(at, 'illuminationPct'), reason: 'must be a number from 0 to 100 %' });
  }
  return { problems, value };
}

const byPeriod = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : HALVES.indexOf(a.half) - HALVES.indexOf(b.half));
const withoutNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
const touch = (forecast, changes, now) => deepFreeze({ ...forecast, ...changes, revision: forecast.revision + 1, updatedAt: now });
const updated = (forecast, changed) => [{ type: 'weather.updated', v: 1, payload: { forecast, changed } }];

/** A new forecast. → { forecast, events: [weather.created] } */
export function createForecast({ id, name, area = '', timeZone = 'Z' }, { now }) {
  const problems = checkForecastFields({ name, area, timeZone });
  if (problems.length) return invalid(problems);
  const forecast = deepFreeze({ id, revision: 1, name: name.trim(), area: area.trim(), timeZone: timeZone.trim(), createdAt: now, updatedAt: now, periods: [], light: [] });
  return ok({ forecast, events: [{ type: 'weather.created', v: 1, payload: { forecast } }] });
}

/** Rename, set the area or time zone. No events when nothing changes. */
export function updateForecast(forecast, changes, { now }) {
  const problems = checkForecastFields(changes);
  if (problems.length) return invalid(problems);
  const next = Object.fromEntries(['name', 'area', 'timeZone'].filter((k) => k in changes).map((k) => [k, changes[k].trim()]).filter(([k, v]) => v !== forecast[k]));
  if (Object.keys(next).length === 0) return ok({ forecast, events: [] });
  const f = touch(forecast, next, now);
  return ok({ forecast: f, events: updated(f, Object.keys(next)) });
}

function checkKey(date, half, at) {
  return [
    ...(isDate(date) ? [] : [{ field: where(at, 'date'), reason: 'must be a date YYYY-MM-DD' }]),
    ...(half === undefined || HALVES.includes(half) ? [] : [{ field: where(at, 'half'), reason: `must be ${HALVES.join(' or ')}` }]),
  ];
}

/** Set one period's values (the form): merged into what is there; null removes a value. */
export function setPeriod(forecast, { date, half, values }, { now }) {
  const problems = checkKey(date, half ?? null, ''); // a period needs its half
  const parsed = parsePeriodValues(values);
  problems.push(...parsed.problems);
  if (problems.length) return invalid(problems);
  const existing = forecast.periods.find((p) => p.date === date && p.half === half);
  const merged = withoutNulls({ ...(existing ?? {}), ...parsed.value, date, half });
  if (existing && jsonEqual(merged, existing)) return ok({ forecast, events: [] });
  if (!existing && forecast.periods.length >= MAX_PERIODS) return invalid([{ field: 'date', reason: `a forecast holds at most ${MAX_PERIODS} periods` }]);
  const periods = [...forecast.periods.filter((p) => p !== existing), merged].sort(byPeriod);
  const f = touch(forecast, { periods }, now);
  return ok({ forecast: f, events: updated(f, ['periods']) });
}

export function removePeriod(forecast, { date, half }, { now }) {
  const existing = forecast.periods.find((p) => p.date === date && p.half === half);
  if (!existing) return err(ErrorCode.NOT_FOUND, `No ${half} period on ${date}`, { forecastId: forecast.id, date, half });
  const f = touch(forecast, { periods: forecast.periods.filter((p) => p !== existing) }, now);
  return ok({ forecast: f, events: updated(f, ['periods']) });
}

/** Set one day's light data (merged; null removes a value). */
export function setLight(forecast, { date, values }, { now }) {
  const problems = checkKey(date, undefined, '');
  const parsed = parseLightValues(values);
  problems.push(...parsed.problems);
  if (problems.length) return invalid(problems);
  const existing = forecast.light.find((l) => l.date === date);
  const merged = withoutNulls({ ...(existing ?? {}), ...parsed.value, date });
  if (existing && jsonEqual(merged, existing)) return ok({ forecast, events: [] });
  const light = [...forecast.light.filter((l) => l !== existing), merged].sort((a, b) => (a.date < b.date ? -1 : 1));
  const f = touch(forecast, { light }, now);
  return ok({ forecast: f, events: updated(f, ['light']) });
}

export function removeLight(forecast, { date }, { now }) {
  const existing = forecast.light.find((l) => l.date === date);
  if (!existing) return err(ErrorCode.NOT_FOUND, `No light data on ${date}`, { forecastId: forecast.id, date });
  const f = touch(forecast, { light: forecast.light.filter((l) => l !== existing) }, now);
  return ok({ forecast: f, events: updated(f, ['light']) });
}

/**
 * Many rows at once (an import): periods [{ date, half, ...values }] and light [{ date, ...values }].
 * mode "merge" adds to and overwrites what is there; "replace" starts from nothing. All or nothing:
 * every problem is listed under periods[i] / light[i].
 */
export function importWeather(forecast, { periods = [], light = [], mode = 'merge' }, { now }) {
  const problems = [];
  if (!['merge', 'replace'].includes(mode)) problems.push({ field: 'mode', reason: 'must be merge or replace' });
  if (!Array.isArray(periods)) problems.push({ field: 'periods', reason: 'must be a list' });
  if (!Array.isArray(light)) problems.push({ field: 'light', reason: 'must be a list' });
  if (problems.length) return invalid(problems);
  const seen = new Set();
  const rows = periods.map((raw, i) => {
    const at = `periods[${i}]`;
    if (!isObject(raw)) { problems.push({ field: at, reason: 'must be an object' }); return null; }
    const { date, half, ...values } = raw;
    const found = [...checkKey(date, half, at), ...(half === undefined ? [{ field: `${at}.half`, reason: `must be ${HALVES.join(' or ')}` }] : [])];
    const key = `${date}|${half}`;
    if (!found.length && seen.has(key)) found.push({ field: `${at}.half`, reason: `${date} ${half} is given twice` });
    seen.add(key);
    const parsed = parsePeriodValues(values, at);
    problems.push(...found, ...parsed.problems);
    return found.length || parsed.problems.length ? null : withoutNulls({ ...parsed.value, date, half });
  });
  const seenDays = new Set();
  const days = light.map((raw, i) => {
    const at = `light[${i}]`;
    if (!isObject(raw)) { problems.push({ field: at, reason: 'must be an object' }); return null; }
    const { date, ...values } = raw;
    const found = checkKey(date, undefined, at);
    if (!found.length && seenDays.has(date)) found.push({ field: `${at}.date`, reason: `${date} is given twice` });
    seenDays.add(date);
    const parsed = parseLightValues(values, at);
    problems.push(...found, ...parsed.problems);
    return found.length || parsed.problems.length ? null : withoutNulls({ ...parsed.value, date });
  });
  if (problems.length) return invalid(problems);
  const keep = (list, isNew) => (mode === 'replace' ? [] : list.filter((x) => !isNew(x)));
  const nextPeriods = [...keep(forecast.periods, (p) => seen.has(`${p.date}|${p.half}`)), ...rows].sort(byPeriod);
  const nextLight = [...keep(forecast.light, (l) => seenDays.has(l.date)), ...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (nextPeriods.length > MAX_PERIODS) return invalid([{ field: 'periods', reason: `a forecast holds at most ${MAX_PERIODS} periods` }]);
  const f = touch(forecast, { periods: nextPeriods, light: nextLight }, now);
  return ok({ forecast: f, events: updated(f, ['periods', 'light']) });
}

/** A stored document as a forecast, or null when it is not a valid one. */
export function readForecast(doc) {
  if (!isObject(doc) || typeof doc.id !== 'string' || !Number.isInteger(doc.revision) || doc.revision < 1) return null;
  if (checkForecastFields({ name: doc.name, area: doc.area ?? '', timeZone: doc.timeZone ?? 'Z' }).length) return null;
  if (!Array.isArray(doc.periods) || !Array.isArray(doc.light)) return null;
  const imported = importWeather({ ...doc, periods: [], light: [] }, { periods: doc.periods, light: doc.light, mode: 'replace' }, { now: doc.updatedAt });
  if (!imported.ok) return null;
  return deepFreeze({ ...imported.value.forecast, revision: doc.revision, createdAt: doc.createdAt, updatedAt: doc.updatedAt });
}

// ---- critical values (D36) ----

export const CRITERION_NAME_MAX = 60;
export const GROUP_MAX = 40;

function parseRule(raw, at) {
  if (!isObject(raw)) return { problems: [{ field: at, reason: 'must be an object { factor, amber?, red? }' }] };
  const problems = Object.keys(raw).filter((k) => !['factor', 'amber', 'red'].includes(k)).map((k) => ({ field: `${at}.${k}`, reason: 'unknown field' }));
  if (!RULE_FACTORS.includes(raw.factor)) return { problems: [...problems, { field: `${at}.factor`, reason: `must be one of ${RULE_FACTORS.join(', ')}` }] };
  if (raw.amber === undefined && raw.red === undefined) problems.push({ field: at, reason: 'needs an amber or a red value' });
  if (raw.factor === 'precipitation') {
    for (const level of ['amber', 'red']) {
      if (raw[level] === undefined) continue;
      if (!Array.isArray(raw[level]) || raw[level].some((t) => !PRECIPITATION_TYPES.includes(t) || t === 'none')) problems.push({ field: `${at}.${level}`, reason: 'must be a list of precipitation types' });
    }
  } else {
    for (const level of ['amber', 'red']) if (raw[level] !== undefined && !isNumber(raw[level])) problems.push({ field: `${at}.${level}`, reason: 'must be a number' });
    if (isNumber(raw.amber) && isNumber(raw.red)) {
      const lowerWorse = RULE_WORSE[raw.factor] === 'lower';
      if (lowerWorse ? raw.red > raw.amber : raw.red < raw.amber) problems.push({ field: `${at}.red`, reason: lowerWorse ? 'must be at or below the amber value (lower is worse)' : 'must be at or above the amber value (higher is worse)' });
    }
  }
  if (problems.length) return { problems };
  return { problems: [], value: { factor: raw.factor, ...(raw.amber === undefined ? {} : { amber: Array.isArray(raw.amber) ? [...raw.amber] : raw.amber }), ...(raw.red === undefined ? {} : { red: Array.isArray(raw.red) ? [...raw.red] : raw.red }) } };
}

/** Criterion fields, whichever are present. */
export function parseCriterionFields(fields) {
  const problems = Object.keys(fields).filter((k) => !['name', 'group', 'rules', 'example'].includes(k)).map((k) => ({ field: k, reason: 'unknown field' }));
  const value = {};
  if ('name' in fields) { const p = checkText('name', fields.name, CRITERION_NAME_MAX, true); if (p.length) problems.push(...p); else value.name = fields.name.trim(); }
  if ('group' in fields) { const p = checkText('group', fields.group, GROUP_MAX); if (p.length) problems.push(...p); else value.group = fields.group.trim(); }
  if ('example' in fields) { if (typeof fields.example === 'boolean') value.example = fields.example; else problems.push({ field: 'example', reason: 'must be true or false' }); }
  if ('rules' in fields) {
    if (!Array.isArray(fields.rules) || fields.rules.length > MAX_RULES) problems.push({ field: 'rules', reason: `must be a list of at most ${MAX_RULES} rules` });
    else {
      const rules = fields.rules.map((r, i) => parseRule(r, `rules[${i}]`));
      rules.forEach((r) => problems.push(...r.problems));
      value.rules = rules.map((r) => r.value);
    }
  }
  return { problems, value };
}

export function createCriterion({ id, ...fields }) {
  const { problems, value } = parseCriterionFields(fields);
  if (!('name' in fields)) problems.push({ field: 'name', reason: 'is required' });
  if (problems.length) return invalid(problems);
  const criterion = deepFreeze({ id, revision: 1, group: '', example: false, rules: [], ...value });
  return ok({ criterion, events: [{ type: 'weather-criterion.created', v: 1, payload: { criterion } }] });
}

export function updateCriterion(criterion, changes) {
  const { problems, value } = parseCriterionFields(changes);
  if (problems.length) return invalid(problems);
  const changed = Object.keys(value).filter((k) => !jsonEqual(value[k], criterion[k]));
  if (!changed.length) return ok({ criterion, events: [] });
  // An edited example is the user's own: it is no longer marked as an example.
  const next = deepFreeze({ ...criterion, ...value, ...(!('example' in changes) && criterion.example ? { example: false } : {}), revision: criterion.revision + 1 });
  return ok({ criterion: next, events: [{ type: 'weather-criterion.updated', v: 1, payload: { criterion: next, changed } }] });
}

export function readCriterion(doc) {
  if (!isObject(doc) || typeof doc.id !== 'string' || !Number.isInteger(doc.revision) || doc.revision < 1) return null;
  const { id, revision, ...fields } = doc;
  const created = createCriterion({ id, ...fields });
  return created.ok ? deepFreeze({ ...created.value.criterion, revision }) : null;
}

/**
 * Starter critical values (D36): EXAMPLES only, to show how the matrix works and to edit. They are
 * not doctrine: check every value against the unit's references and the systems it actually has.
 */
export const EXAMPLE_CRITERIA = Object.freeze([
  { name: 'Rotary-wing aviation', group: 'Aviation', rules: [{ factor: 'ceilingFt', amber: 1000, red: 500 }, { factor: 'visibilityKm', amber: 5, red: 1.6 }, { factor: 'windSpeedKt', amber: 30, red: 40 }, { factor: 'windGustKt', amber: 35, red: 45 }, { factor: 'precipitation', amber: ['snow', 'sleet'], red: ['freezingRain', 'hail', 'thunderstorm'] }] },
  { name: 'Small UAS', group: 'ISR', rules: [{ factor: 'windSpeedKt', amber: 15, red: 25 }, { factor: 'windGustKt', amber: 20, red: 30 }, { factor: 'ceilingFt', amber: 1500, red: 800 }, { factor: 'precipitation', amber: ['drizzle', 'rain', 'snow'], red: ['freezingRain', 'hail', 'thunderstorm'] }] },
  { name: 'Airborne / air assault', group: 'Aviation', rules: [{ factor: 'windSpeedKt', amber: 13, red: 18 }, { factor: 'ceilingFt', amber: 1500, red: 1000 }, { factor: 'visibilityKm', amber: 5, red: 3 }] },
  { name: 'Ground mobility (cross-country)', group: 'Maneuver', rules: [{ factor: 'precipitationMm', amber: 10, red: 25 }, { factor: 'precipitation', amber: ['snow', 'sleet'], red: ['freezingRain'] }] },
  { name: 'Thermal sights', group: 'Fires and sensors', rules: [{ factor: 'precipitation', amber: ['drizzle', 'rain', 'snow'], red: ['thunderstorm'] }, { factor: 'humidityPct', amber: 85, red: 95 }, { factor: 'visibilityKm', amber: 3, red: 1 }] },
  { name: 'Night vision devices', group: 'Fires and sensors', rules: [{ factor: 'illuminationPct', amber: 25, red: 10 }, { factor: 'cloudCoverPct', amber: 75, red: 90 }] },
  { name: 'Personnel (heat and cold)', group: 'Sustainment', rules: [{ factor: 'temperatureMaxC', amber: 32, red: 38 }, { factor: 'temperatureMinC', amber: -10, red: -20 }] },
]);

// ---- ratings and the effects matrix ----

const RANK = Object.freeze({ green: 0, unknown: 1, amber: 2, red: 3 });
const fmt = (factor, v) => (factor === 'precipitation' ? v : `${v}${FACTOR_UNITS[factor] ? ` ${FACTOR_UNITS[factor]}` : ''}`);

/** One rule against one period (with that day's light). → { rating, reason } */
export function rateRule(rule, period, light) {
  const value = rule.factor === 'illuminationPct' ? light?.illuminationPct : period[rule.factor];
  const label = FACTOR_LABELS[rule.factor];
  if (value === undefined || value === null) return { rating: 'unknown', reason: `${label}: no data` };
  if (rule.factor === 'precipitation') {
    if (rule.red?.includes(value)) return { rating: 'red', reason: `${label}: ${value}` };
    if (rule.amber?.includes(value)) return { rating: 'amber', reason: `${label}: ${value}` };
    return { rating: 'green', reason: `${label}: ${value}` };
  }
  const lowerWorse = RULE_WORSE[rule.factor] === 'lower';
  const beyond = (limit) => limit !== undefined && (lowerWorse ? value <= limit : value >= limit);
  const sign = lowerWorse ? '≤' : '≥';
  if (beyond(rule.red)) return { rating: 'red', reason: `${label} ${fmt(rule.factor, value)} ${sign} ${fmt(rule.factor, rule.red)}` };
  if (beyond(rule.amber)) return { rating: 'amber', reason: `${label} ${fmt(rule.factor, value)} ${sign} ${fmt(rule.factor, rule.amber)}` };
  return { rating: 'green', reason: `${label} ${fmt(rule.factor, value)}` };
}

/**
 * A criterion against a period: the worst rule wins; unknown only when no rule could be rated
 * (green with some unknowns is reported as green, with the unknowns among the reasons).
 * → { rating, reasons: string[] } (reasons for amber/red first)
 */
export function ratePeriod(criterion, period, light) {
  if (!criterion.rules.length) return { rating: 'unknown', reasons: ['No critical values set'] };
  const rated = criterion.rules.map((r) => rateRule(r, period, light));
  const known = rated.filter((r) => r.rating !== 'unknown');
  const rating = known.length ? known.reduce((w, r) => (RANK[r.rating] > RANK[w] ? r.rating : w), 'green') : 'unknown';
  const reasons = [...rated.filter((r) => r.rating === 'red'), ...rated.filter((r) => r.rating === 'amber'), ...rated.filter((r) => r.rating === 'unknown')].map((r) => r.reason);
  return { rating, reasons };
}

/**
 * The weather effects matrix: one row per criterion (by group, then name), one cell per period.
 * → { periods: [{ date, half }], rows: [{ criterionId, name, group, example, cells: [{ rating, reasons }] }] }
 */
export function effectsMatrix(forecast, criteria) {
  const lightOn = new Map(forecast.light.map((l) => [l.date, l]));
  const sorted = [...criteria].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return {
    periods: forecast.periods.map(({ date, half }) => ({ date, half })),
    rows: sorted.map((c) => ({
      criterionId: c.id, name: c.name, group: c.group, example: c.example,
      cells: forecast.periods.map((p) => ratePeriod(c, p, lightOn.get(p.date))),
    })),
  };
}
