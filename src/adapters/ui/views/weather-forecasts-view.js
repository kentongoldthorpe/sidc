// Forecasts section (driving adapter, Epic 4): the project's forecasts for its area of operations.
// Create, select, import a CSV (docs/WEATHER-IMPORT.md) and delete. The selected forecast is shown on
// the weather board.
import { el, describeError } from './dom.js';
import { readWeatherCsv } from '../../files/weather-csv.js';

/**
 * @param {{ client: object, root: HTMLElement, forecastSelection: object, summary?: HTMLElement|null }} options
 * @returns {{ ready: Promise<void>, refresh(): Promise<void>, destroy(): void }}
 */
export function mountWeatherForecastsView({ client, root, forecastSelection, summary = null }) {
  let destroyed = false;
  let forecasts = [];
  let seq = 0;

  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const name = el('input', { attrs: { name: 'forecast-name', autocomplete: 'off', maxlength: 80, placeholder: 'e.g. AO IRON, 25–27 NOV', 'aria-label': 'New forecast name' } });
  const area = el('input', { attrs: { name: 'forecast-area', autocomplete: 'off', maxlength: 120, placeholder: 'Area (optional)', 'aria-label': 'Area of the new forecast' } });
  const form = el('form', { class: 'stack', dataset: { newForecast: '' }, attrs: { novalidate: true }, on: { submit: onCreate } },
    el('div', { class: 'row new-coa-row' }, name, el('button', { class: 'primary', attrs: { type: 'submit' }, text: 'Create' })), area);
  const empty = el('p', { class: 'placeholder', text: 'No forecasts yet. Create one, then import a CSV or type the periods in.' });
  const list = el('ul', { class: 'system-items', attrs: { 'aria-label': 'Forecasts' } });
  const mode = el('select', { attrs: { name: 'import-mode', 'aria-label': 'Import mode' } },
    el('option', { attrs: { value: 'merge' }, text: 'Merge' }), el('option', { attrs: { value: 'replace' }, text: 'Replace all' }));
  const fileInput = el('input', { attrs: { type: 'file', hidden: true, accept: '.csv,text/csv', 'aria-label': 'Import weather from a CSV file', tabindex: '-1' }, on: { change: onImportFile } });
  const problems = el('ul', { class: 'import-problems' });
  const selectedTools = el('fieldset', { class: 'group', dataset: { forecastTools: '' } }, el('legend', { text: 'Selected forecast' }),
    el('div', { class: 'row new-coa-row' }, mode, el('button', { attrs: { type: 'button' }, text: 'Import CSV…', on: { click: () => fileInput.click() } }), fileInput),
    el('p', { class: 'hint', text: 'A forecast file (one row per 0000–1200 or 1200–2400 period) or a light-data file (one row per day). See docs/WEATHER-IMPORT.md.' }),
    problems,
    el('div', { class: 'actions' }, el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete forecast', on: { click: askDelete } })));
  const confirmText = el('p', {});
  const dialog = el('dialog', { class: 'confirm', attrs: { 'aria-label': 'Confirm delete' } }, confirmText,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onConfirmDelete } })));
  root.replaceChildren(el('div', { class: 'stack' }, alert, form, empty, list, selectedTools, status, dialog));

  const say = (text) => { status.textContent = text; alert.textContent = ''; };
  const fail = (text) => { alert.textContent = text; status.textContent = ''; };
  const days = (f) => (f.firstDate ? (f.firstDate === f.lastDate ? f.firstDate : `${f.firstDate} to ${f.lastDate}`) : 'no periods yet');

  function render() {
    empty.hidden = forecasts.length > 0;
    selectedTools.hidden = !forecasts.some((f) => f.id === forecastSelection.get());
    if (summary) summary.textContent = forecasts.length ? String(forecasts.length) : '';
    list.replaceChildren(...forecasts.map((f) => el('li', { dataset: { forecastId: f.id } },
      el('button', { class: 'list-row system-select', attrs: { type: 'button', 'aria-current': forecastSelection.get() === f.id ? 'true' : null }, on: { click: () => forecastSelection.set(f.id) } },
        el('span', { class: 'system-name', text: f.name }),
        el('span', { class: 'system-meta', text: `${f.area ? `${f.area} · ` : ''}${f.periodCount} period${f.periodCount === 1 ? '' : 's'} · ${days(f)}` })))));
  }

  async function load() {
    const mine = ++seq;
    const listed = await client.ask('weather.list');
    if (destroyed || mine !== seq) return;
    if (!listed.ok) { fail(describeError(listed.error)); return; }
    forecasts = listed.value;
    if (forecastSelection.get() === null && forecasts.length) forecastSelection.set(forecasts[0].id);
    else if (forecastSelection.get() !== null && !forecasts.some((f) => f.id === forecastSelection.get())) forecastSelection.set(forecasts[0]?.id ?? null);
    render();
  }

  async function onCreate(event) {
    event.preventDefault();
    const fields = { name: name.value, ...(area.value.trim() ? { area: area.value } : {}) };
    const result = await client.send('weather.create', fields);
    if (destroyed) return;
    if (!result.ok) { fail(describeError(result.error)); return; }
    name.value = ''; area.value = '';
    say(`Created ${result.value.name}.`);
    await load();
    forecastSelection.set(result.value.id);
  }

  async function onImportFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    problems.replaceChildren();
    if (!file) return;
    const read = readWeatherCsv(await file.text());
    if (!read.ok) { showProblems(file.name, read.error.details.problems.map((p) => `${p.field}: ${p.reason}`)); return; }
    const latest = await client.ask('weather.get', { forecastId: forecastSelection.get() });
    if (!latest.ok) { fail(describeError(latest.error)); return; }
    const result = await client.send('weather.import', {
      forecastId: latest.value.id, expectedRevision: latest.value.revision, mode: mode.value,
      ...(read.value.periods ? { periods: read.value.periods } : { light: read.value.light }),
    });
    if (destroyed) return;
    if (!result.ok) { showProblems(file.name, (result.error.details?.problems ?? [{ field: '', reason: describeError(result.error) }]).map((p) => `${read.value.where(p.field)}: ${p.reason}`)); return; }
    const n = read.value.periods?.length ?? read.value.light.length;
    say(`Imported ${n} ${read.value.periods ? `period${n === 1 ? '' : 's'}` : `day${n === 1 ? '' : 's'} of light data`} from ${file.name}.`);
  }

  function showProblems(fileName, lines) {
    fail(`${fileName} was not imported: ${lines.length} problem${lines.length === 1 ? '' : 's'}.`);
    problems.replaceChildren(...lines.slice(0, 20).map((text) => el('li', { text })), ...(lines.length > 20 ? [el('li', { text: `… and ${lines.length - 20} more` })] : []));
  }

  function askDelete() {
    const f = forecasts.find((x) => x.id === forecastSelection.get());
    if (!f) return;
    confirmText.textContent = `Delete the forecast ${f.name} and all its periods and light data?`;
    dialog.showModal();
  }
  async function onConfirmDelete() {
    dialog.close();
    const latest = await client.ask('weather.get', { forecastId: forecastSelection.get() });
    if (!latest.ok) { fail(describeError(latest.error)); return; }
    const result = await client.send('weather.delete', { forecastId: latest.value.id, expectedRevision: latest.value.revision });
    if (destroyed) return;
    if (result.ok) say(`Deleted ${latest.value.name}.`); else fail(describeError(result.error));
  }

  const offs = [client.subscribe('weather.*', () => { load(); }), forecastSelection.subscribe(render)];
  return { ready: load(), refresh: load, destroy() { destroyed = true; offs.forEach((off) => off()); if (dialog.open) dialog.close(); } };
}
