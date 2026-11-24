// Weather board (driving adapter, Epic 4): the selected forecast in the main area. The weather
// effects matrix, the forecast table (one column per 0000–1200 / 1200–2400 period), the light data,
// and forms to type a period or a day in (D37).
import { el, describeError } from './dom.js';
import { FACTORS, HALVES, PRECIPITATION_TYPES, LIGHT_FIELDS } from '../../../domain/weather.js';

const RATING_TEXT = Object.freeze({ green: 'G', amber: 'A', red: 'R', unknown: '?' });
const RATING_NAME = Object.freeze({ green: 'Favourable', amber: 'Marginal', red: 'Unfavourable', unknown: 'No data' });
const LIGHT_NAMES = Object.freeze({ bmnt: 'BMNT', sunrise: 'Sunrise', sunset: 'Sunset', eent: 'EENT', moonrise: 'Moonrise', moonset: 'Moonset', illuminationPct: 'Illum %' });
const HALF_TEXT = Object.freeze({ '0000-1200': '0000–1200', '1200-2400': '1200–2400' });
const PRECIP_TEXT = Object.freeze({ none: 'None', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', sleet: 'Sleet', freezingRain: 'Freezing rain', hail: 'Hail', thunderstorm: 'Thunderstorm' });
const toNumber = (text) => { const t = text.trim().replace(',', '.'); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : text; };
const ceilingText = (v) => (v >= 100000 ? 'UNL' : String(v));

/**
 * @param {{ client: object, root: HTMLElement, forecastSelection: object }} options
 * @returns {{ ready: Promise<void>, refresh(): Promise<void>, destroy(): void }}
 */
export function mountWeatherBoard({ client, root, forecastSelection }) {
  let destroyed = false;
  let forecast = null;
  let seq = 0;

  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const body = el('div', { class: 'weather-body' });
  root.replaceChildren(el('div', { class: 'weather-board-inner' }, alert, body, status));
  const say = (text) => { status.textContent = text; alert.textContent = ''; };
  const fail = (text) => { alert.textContent = text; status.textContent = ''; };

  async function load() {
    const mine = ++seq;
    const id = forecastSelection.get();
    if (!id) { forecast = null; render(null); return; }
    const [got, matrix] = await Promise.all([client.ask('weather.get', { forecastId: id }), client.ask('weather.matrix', { forecastId: id })]);
    if (destroyed || mine !== seq) return;
    if (!got.ok) { forecast = null; render(null); if (got.error.code !== 'NOT_FOUND') fail(describeError(got.error)); return; }
    forecast = got.value;
    render(matrix.ok ? matrix.value : null);
  }

  const periodHead = (periods) => {
    const byDate = [];
    for (const p of periods) { const last = byDate.at(-1); if (last?.date === p.date) last.n += 1; else byDate.push({ date: p.date, n: 1 }); }
    return [
      el('tr', {}, el('th', { attrs: { scope: 'col', rowspan: 2 }, text: '' }), ...byDate.map((d) => el('th', { attrs: { scope: 'colgroup', colspan: d.n }, text: d.date }))),
      el('tr', {}, ...periods.map((p) => el('th', { attrs: { scope: 'col' } },
        el('button', { class: 'link', attrs: { type: 'button', title: 'Edit this period' }, text: HALF_TEXT[p.half], on: { click: () => editPeriod(p.date, p.half) } })))),
    ];
  };

  function render(matrix) {
    if (!forecast) {
      body.replaceChildren(el('p', { class: 'placeholder', text: 'Select or create a forecast in the Forecasts section.' }));
      return;
    }
    const f = forecast;
    const sections = [el('header', { class: 'weather-head' },
      el('h2', { text: f.name }),
      el('p', { class: 'hint', text: `${f.area ? `${f.area} · ` : ''}Periods 0000–1200 and 1200–2400, times in ${f.timeZone}` }))];

    // Weather effects matrix.
    if (matrix && matrix.rows.length && matrix.periods.length) {
      sections.push(el('section', { class: 'weather-section', dataset: { effectsMatrix: '' } },
        el('h3', { text: 'Weather effects matrix' }),
        el('div', { class: 'table-scroll' }, el('table', { class: 'weather-table matrix' },
          el('thead', {}, ...periodHead(matrix.periods)),
          el('tbody', {}, ...matrix.rows.map((r) => el('tr', { dataset: { criterionId: r.criterionId } },
            el('th', { attrs: { scope: 'row' } }, r.name, r.group ? el('span', { class: 'system-meta', text: ` ${r.group}` }) : null, r.example ? el('span', { class: 'example-badge', text: 'Example' }) : null),
            ...r.cells.map((c) => el('td', { class: `rating rating-${c.rating}`, dataset: { rating: c.rating }, attrs: { title: `${RATING_NAME[c.rating]}: ${c.reasons.join('; ')}` } },
              el('span', { attrs: { 'aria-hidden': 'true' }, text: RATING_TEXT[c.rating] }), el('span', { class: 'visually-hidden', text: `${RATING_NAME[c.rating]}. ${c.reasons.join('; ')}` })))))))),
        el('p', { class: 'hint', text: 'G favourable · A marginal · R unfavourable · ? no data. Hover a cell for the reasons.' })));
    } else if (matrix && !matrix.rows.length) {
      sections.push(el('p', { class: 'hint', text: 'Add critical values (Critical values section) to see the weather effects matrix.' }));
    }

    // Forecast table: factors down, periods across.
    if (f.periods.length) {
      const factorRows = Object.entries(FACTORS).filter(([key]) => f.periods.some((p) => p[key] !== undefined)).map(([key, def]) =>
        el('tr', {}, el('th', { attrs: { scope: 'row' }, text: `${def.label} (${def.unit})` }), ...f.periods.map((p) => el('td', { text: p[key] === undefined ? '' : key === 'ceilingFt' ? ceilingText(p[key]) : String(p[key]) }))));
      const extra = [];
      if (f.periods.some((p) => p.precipitation)) extra.push(el('tr', {}, el('th', { attrs: { scope: 'row' }, text: 'Precipitation type' }), ...f.periods.map((p) => el('td', { text: p.precipitation ? PRECIP_TEXT[p.precipitation] : '' }))));
      if (f.periods.some((p) => p.notes)) extra.push(el('tr', {}, el('th', { attrs: { scope: 'row' }, text: 'Notes' }), ...f.periods.map((p) => el('td', { class: 'notes', text: p.notes ?? '' }))));
      sections.push(el('section', { class: 'weather-section', dataset: { forecastTable: '' } },
        el('h3', { text: 'Forecast' }),
        el('div', { class: 'table-scroll' }, el('table', { class: 'weather-table' }, el('thead', {}, ...periodHead(f.periods)), el('tbody', {}, ...factorRows, ...extra)))));
    } else {
      sections.push(el('p', { class: 'placeholder', text: 'No periods yet: import a CSV (Forecasts section) or add a period below.' }));
    }

    // Light data: one row per day.
    if (f.light.length) {
      sections.push(el('section', { class: 'weather-section', dataset: { lightTable: '' } },
        el('h3', { text: 'Light data' }),
        el('div', { class: 'table-scroll' }, el('table', { class: 'weather-table' },
          el('thead', {}, el('tr', {}, el('th', { attrs: { scope: 'col' }, text: 'Date' }), ...LIGHT_FIELDS.map((k) => el('th', { attrs: { scope: 'col' }, text: LIGHT_NAMES[k] })))),
          el('tbody', {}, ...f.light.map((l) => el('tr', {},
            el('th', { attrs: { scope: 'row' } }, el('button', { class: 'link', attrs: { type: 'button', title: 'Edit this day' }, text: l.date, on: { click: () => editLight(l.date) } })),
            ...LIGHT_FIELDS.map((k) => el('td', { text: l[k] === undefined ? '' : String(l[k]) })))))))));
    }

    sections.push(periodForm, lightForm.element);
    body.replaceChildren(...sections);
  }

  // ---- the period form ----
  const pDate = el('input', { attrs: { type: 'date', name: 'period-date', 'aria-label': 'Date' } });
  const pHalf = el('select', { attrs: { name: 'period-half', 'aria-label': 'Period' } }, ...HALVES.map((h) => el('option', { attrs: { value: h }, text: HALF_TEXT[h] })));
  const pInputs = Object.fromEntries(Object.entries(FACTORS).map(([key, def]) => [key, el('input', { attrs: { name: `period-${key}`, inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${def.label} (${def.unit})` } })]));
  const pPrecip = el('select', { attrs: { name: 'period-precipitation', 'aria-label': 'Precipitation type' } }, el('option', { attrs: { value: '' }, text: '—' }), ...PRECIPITATION_TYPES.map((t) => el('option', { attrs: { value: t }, text: PRECIP_TEXT[t] })));
  const pNotes = el('input', { attrs: { name: 'period-notes', autocomplete: 'off', maxlength: 200, 'aria-label': 'Notes' } });
  const pErrors = el('ul', { class: 'import-problems' });
  const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
  const periodForm = el('details', { class: 'weather-section weather-form', dataset: { periodForm: '' } },
    el('summary', { text: 'Add or edit a period' }),
    el('div', { class: 'stack' },
      el('div', { class: 'position' }, field('Date', pDate), field('Period', pHalf)),
      el('div', { class: 'weather-grid' }, ...Object.entries(FACTORS).map(([key, def]) => field(`${def.label} (${def.unit})${key === 'ceilingFt' ? ', 100000 = UNL' : ''}`, pInputs[key])), field('Precipitation type', pPrecip)),
      field('Notes', pNotes),
      pErrors,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save period', on: { click: onSavePeriod } }),
        el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete period', on: { click: onDeletePeriod } }))));
  [pDate, pHalf].forEach((c) => c.addEventListener('change', () => fillPeriod(pDate.value, pHalf.value)));

  function fillPeriod(date, half) {
    const p = forecast?.periods.find((x) => x.date === date && x.half === half);
    for (const [key, input] of Object.entries(pInputs)) input.value = p?.[key] === undefined ? '' : String(p[key]);
    pPrecip.value = p?.precipitation ?? '';
    pNotes.value = p?.notes ?? '';
  }
  function editPeriod(date, half) {
    pDate.value = date; pHalf.value = half;
    fillPeriod(date, half);
    periodForm.open = true;
    periodForm.scrollIntoView?.({ block: 'nearest' });
  }
  async function latest() {
    const got = await client.ask('weather.get', { forecastId: forecast.id });
    if (!got.ok) { fail(describeError(got.error)); return null; }
    return got.value;
  }
  async function onSavePeriod() {
    if (!forecast) return;
    pErrors.replaceChildren();
    // An empty box clears that value: the form shows the whole period.
    const values = { ...Object.fromEntries(Object.entries(pInputs).map(([k, input]) => [k, toNumber(input.value)])), precipitation: pPrecip.value || null, notes: pNotes.value.trim() || null };
    const f = await latest();
    if (!f) return;
    const result = await client.send('weather.set-period', { forecastId: f.id, expectedRevision: f.revision, date: pDate.value, half: pHalf.value, values });
    if (destroyed) return;
    if (!result.ok) { pErrors.replaceChildren(...(result.error.details?.problems ?? [{ field: '', reason: describeError(result.error) }]).map((p) => el('li', { text: `${p.field.replace(/^values\./, '')}: ${p.reason}` }))); return; }
    say(`Saved ${pDate.value} ${HALF_TEXT[pHalf.value]}.`);
  }
  async function onDeletePeriod() {
    const f = await latest();
    if (!f) return;
    const result = await client.send('weather.remove-period', { forecastId: f.id, expectedRevision: f.revision, date: pDate.value, half: pHalf.value });
    if (!destroyed) (result.ok ? say(`Deleted ${pDate.value} ${HALF_TEXT[pHalf.value]}.`) : fail(describeError(result.error)));
  }

  // ---- the light-data form ----
  const lightForm = (() => {
    const date = el('input', { attrs: { type: 'date', name: 'light-date', 'aria-label': 'Date' } });
    const inputs = Object.fromEntries(LIGHT_FIELDS.map((k) => [k, el('input', { attrs: { name: `light-${k}`, autocomplete: 'off', inputmode: 'numeric', placeholder: k === 'illuminationPct' ? '0–100' : 'HHMM', 'aria-label': LIGHT_NAMES[k] } })]));
    const errors = el('ul', { class: 'import-problems' });
    const fill = (d) => { const l = forecast?.light.find((x) => x.date === d); for (const [k, input] of Object.entries(inputs)) input.value = l?.[k] === undefined ? '' : String(l[k]); };
    date.addEventListener('change', () => fill(date.value));
    const element = el('details', { class: 'weather-section weather-form', dataset: { lightForm: '' } },
      el('summary', { text: 'Add or edit light data' }),
      el('div', { class: 'stack' }, field('Date', date),
        el('div', { class: 'weather-grid' }, ...LIGHT_FIELDS.map((k) => field(LIGHT_NAMES[k], inputs[k]))),
        errors,
        el('div', { class: 'actions' },
          el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save light data', on: { click: save } }),
          el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete day', on: { click: remove } }))));
    async function save() {
      if (!forecast) return;
      errors.replaceChildren();
      const values = Object.fromEntries(Object.entries(inputs).map(([k, input]) => {
        const t = input.value.trim().replace(':', '');
        return [k, t === '' ? null : k === 'illuminationPct' ? toNumber(t) : t.padStart(4, '0')];
      }));
      const f = await latest();
      if (!f) return;
      const result = await client.send('weather.set-light', { forecastId: f.id, expectedRevision: f.revision, date: date.value, values });
      if (destroyed) return;
      if (!result.ok) { errors.replaceChildren(...(result.error.details?.problems ?? [{ field: '', reason: describeError(result.error) }]).map((p) => el('li', { text: `${p.field.replace(/^values\./, '')}: ${p.reason}` }))); return; }
      say(`Saved light data for ${date.value}.`);
    }
    async function remove() {
      const f = await latest();
      if (!f) return;
      const result = await client.send('weather.remove-light', { forecastId: f.id, expectedRevision: f.revision, date: date.value });
      if (!destroyed) (result.ok ? say(`Deleted light data for ${date.value}.`) : fail(describeError(result.error)));
    }
    return { element, edit(d) { date.value = d; fill(d); element.open = true; } };
  })();
  const editLight = (d) => lightForm.edit(d);

  const offs = [client.subscribe('weather.*', () => { load(); }), client.subscribe('weather-criterion.*', () => { load(); }), forecastSelection.subscribe(() => load())];
  return { ready: load(), refresh: load, destroy() { destroyed = true; offs.forEach((off) => off()); } };
}
