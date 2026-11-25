// Epic 4 Weather workspace: forecasts (create, CSV import), critical values (examples, editing) and
// the board (effects matrix, forecast and light tables, form entry).
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { mountWeatherForecastsView } from '../../src/adapters/ui/views/weather-forecasts-view.js';
import { mountWeatherCriteriaView } from '../../src/adapters/ui/views/weather-criteria-view.js';
import { mountWeatherBoard } from '../../src/adapters/ui/views/weather-board.js';
import { createSelection } from '../../src/adapters/ui/selection.js';

let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const field = (root, name) => root.querySelector(`[name="${name}"]`);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
const chooseFile = (input, text, name) => {
  const files = new DataTransfer();
  files.items.add(new File([text], name, { type: 'text/csv' }));
  input.files = files.files;
  input.dispatchEvent(new Event('change'));
};
const FORECAST_CSV = 'date,period,wind_kt,ceiling_ft,precip,notes\n2026-11-25,0000-1200,10,3000,none,\n2026-11-25,1200-2400,42,800,rain,Front\n';

async function workspace() {
  const fixture = createTestApp();
  const host = sandbox();
  const panel = document.createElement('div');
  const criteriaEl = document.createElement('div');
  const board = document.createElement('div');
  host.append(panel, criteriaEl, board);
  const forecastSelection = createSelection(null);
  const saved = [];
  const views = [
    mountWeatherForecastsView({ client: fixture.client, root: panel, forecastSelection, saveFile: async (blob, name) => { saved.push({ blob, name }); } }),
    mountWeatherCriteriaView({ client: fixture.client, root: criteriaEl }),
    mountWeatherBoard({ client: fixture.client, root: board, forecastSelection }),
  ];
  cleanups.push(() => { views.forEach((v) => v.destroy()); host.remove(); });
  await Promise.all(views.map((v) => v.ready));
  return { ...fixture, saved, panel, criteriaEl, board, forecastSelection };
}
async function createForecast(s, name = 'AO IRON') {
  type(field(s.panel, 'forecast-name'), name);
  s.panel.querySelector('[data-new-forecast]').requestSubmit();
  await waitFor(() => s.forecastSelection.get() !== null && s.board.querySelector('.weather-head'));
}

describe('Weather workspace', () => {
  it('creates a forecast, imports a CSV, and shows it as a table of periods', async () => {
    const s = await workspace();
    await createForecast(s);
    assert.match(s.board.textContent, /AO IRON/);
    chooseFile(s.panel.querySelector('input[type="file"]'), FORECAST_CSV, 'forecast.csv');
    await waitFor(() => s.board.querySelector('[data-forecast-table]'));
    const table = s.board.querySelector('[data-forecast-table]');
    assert.deepEqual(texts(table, 'thead tr:last-child th'), ['0000–1200', '1200–2400']);
    assert.match(table.textContent, /Wind \(kt\)\s*1042/);
    assert.match(table.textContent, /Rain/);
    await waitFor(() => /2 periods/.test(s.panel.textContent));
  });

  it('lists every problem in a CSV by row and column, and imports nothing', async () => {
    const s = await workspace();
    await createForecast(s);
    chooseFile(s.panel.querySelector('input[type="file"]'), 'date,period,wind_kt\n2026-11-25,AM,fast\n2026-02-30,PM,5\n', 'bad.csv');
    await waitFor(() => /not imported/.test(s.panel.textContent));
    assert.deepEqual(texts(s.panel, '.import-problems li'), ['row 2, column wind_kt: must be a number from 0 to 250 kt', 'row 3, column date: must be a date YYYY-MM-DD']);
  });

  it('rates the forecast against the example critical values, with the reasons on each cell', async () => {
    const s = await workspace();
    await createForecast(s);
    chooseFile(s.panel.querySelector('input[type="file"]'), FORECAST_CSV, 'forecast.csv');
    await waitFor(() => s.board.querySelector('[data-forecast-table]'));
    s.criteriaEl.querySelector('[data-add-examples]').click();
    await waitFor(() => s.board.querySelector('[data-effects-matrix]'));
    const rotary = [...s.board.querySelectorAll('[data-effects-matrix] tbody tr')].find((tr) => /Rotary-wing aviation/.test(tr.textContent));
    assert.deepEqual([...rotary.querySelectorAll('td')].map((td) => td.dataset.rating), ['green', 'red']);
    assert.match(rotary.querySelectorAll('td')[1].title, /Wind 42 kt ≥ 40 kt/);
    assert.ok(s.criteriaEl.querySelector('.example-badge'), 'the starter values are marked as examples');
  });

  it('types a period in with the form, and edits it from the table', async () => {
    const s = await workspace();
    await createForecast(s);
    s.board.querySelector('[data-period-form] summary').click();
    field(s.board, 'period-date').value = '2026-11-26';
    choose(field(s.board, 'period-half'), '1200-2400');
    type(field(s.board, 'period-windSpeedKt'), '12');
    type(field(s.board, 'period-visibilityKm'), '8');
    choose(field(s.board, 'period-precipitation'), 'snow');
    button(s.board, 'Save period').click();
    await waitFor(() => s.board.querySelector('[data-forecast-table]'));
    const f = (await s.client.ask('weather.get', { forecastId: s.forecastSelection.get() })).value;
    assert.deepEqual(f.periods, [{ date: '2026-11-26', half: '1200-2400', windSpeedKt: 12, visibilityKm: 8, precipitation: 'snow' }]);
    button(s.board.querySelector('[data-forecast-table]'), '1200–2400').click();
    assert.equal(field(s.board, 'period-windSpeedKt').value, '12');
    type(field(s.board, 'period-visibilityKm'), '');
    button(s.board, 'Save period').click();
    await waitFor(async () => (await s.client.ask('weather.get', { forecastId: s.forecastSelection.get() })).value.periods[0].visibilityKm === undefined);
  });

  it('types light data in for a day', async () => {
    const s = await workspace();
    await createForecast(s);
    s.board.querySelector('[data-light-form] summary').click();
    field(s.board, 'light-date').value = '2026-11-26';
    field(s.board, 'light-date').dispatchEvent(new Event('change'));
    type(field(s.board, 'light-sunrise'), '06:30');
    type(field(s.board, 'light-illuminationPct'), '40');
    button(s.board, 'Save light data').click();
    await waitFor(() => s.board.querySelector('[data-light-table]'));
    assert.match(s.board.querySelector('[data-light-table]').textContent, /2026-11-26.*0630.*40/);
  });

  it('edits critical values: an edited example becomes the user\'s own', async () => {
    const s = await workspace();
    s.criteriaEl.querySelector('[data-add-examples]').click();
    await waitFor(() => s.criteriaEl.querySelector('[data-criterion-id] button'));
    const row = [...s.criteriaEl.querySelectorAll('[data-criterion-id]')].find((li) => /Small UAS/.test(li.textContent));
    row.querySelector('button').click();
    const first = s.criteriaEl.querySelector('[data-rule] [name="rule-red"]');
    type(first, '28');
    button(s.criteriaEl, 'Save').click();
    await waitFor(async () => (await s.client.ask('weather-criterion.list')).value.find((c) => c.name === 'Small UAS').rules[0].red === 28);
    assert.equal((await s.client.ask('weather-criterion.list')).value.find((c) => c.name === 'Small UAS').example, false);
  });

  it('exports the forecast and light data as CSV that imports again, the matrix as CSV, and all as JSON (X-4)', async () => {
    const s = await workspace();
    await createForecast(s);
    chooseFile(s.panel.querySelector('input[type="file"]'), FORECAST_CSV, 'forecast.csv');
    await waitFor(() => /2 periods/.test(s.panel.textContent));
    for (const label of ['Forecast CSV', 'Light data CSV', 'Effects matrix CSV', 'All as JSON']) button(s.panel, label).click();
    await waitFor(() => s.saved.length === 4);
    const names = ['ao-iron-forecast.csv', 'ao-iron-light-data.csv', 'ao-iron-effects-matrix.csv', 'ao-iron-weather.json'];
    assert.deepEqual(s.saved.map((f) => f.name.replace(/_.*\./, '.')).sort(), [...names].sort());
    const [forecast, light, matrix, json] = await Promise.all(names.map((n) => s.saved.find((f) => f.name.replace(/_.*\./, '.') === n).blob.text()));
    assert.match(forecast, /^\uFEFF?# UNCLASSIFIED/);
    assert.match(forecast, /2026-11-25,1200-2400,.*42/);
    assert.match(light, /^\uFEFF?# UNCLASSIFIED[^\n]*\r?\ndate,bmnt/);
    assert.match(matrix, /operation_or_system,group,example,2026-11-25 0000-1200,2026-11-25 1200-2400,reasons/);
    assert.equal(JSON.parse(json).format, 'coa-builder/weather');
    // The forecast file goes back in unchanged.
    type(field(s.panel, 'forecast-name'), 'Copy');
    s.panel.querySelector('[data-new-forecast]').requestSubmit();
    await waitFor(async () => (await s.client.ask('weather.list')).value.length === 2 && s.panel.textContent.includes('Copy'));
    const copy = (await s.client.ask('weather.list')).value.find((f) => f.name === 'Copy');
    await waitFor(() => s.forecastSelection.get() === copy.id);
    chooseFile(s.panel.querySelector('input[type="file"]'), forecast, 'ao-iron-forecast.csv');
    await waitFor(async () => (await s.client.ask('weather.get', { forecastId: copy.id })).value.periods.length === 2);
    const [a, b] = await Promise.all((await s.client.ask('weather.list')).value.map((f) => s.client.ask('weather.get', { forecastId: f.id })));
    assert.deepEqual(a.value.periods, b.value.periods);
  });

  it('exports the forecast as PNG slides with the marking, one per three days (W-5)', async () => {
    const s = await workspace();
    await createForecast(s);
    const days = ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];
    const csv = `date,period,wind_kt,ceiling_ft\n${days.flatMap((d) => [`${d},0000-1200,10,UNL`, `${d},1200-2400,40,800`]).join('\n')}\n`;
    chooseFile(s.panel.querySelector('input[type="file"]'), csv, 'forecast.csv');
    await waitFor(() => /8 periods/.test(s.panel.textContent));
    button(s.panel, 'Slide (PNG)').click();
    await waitFor(() => s.saved.length === 2, { timeout: 8000 });
    assert.deepEqual(s.saved.map((f) => f.name.replace(/_.*/, '')), ['ao-iron-weather-1', 'ao-iron-weather-2']);
    for (const f of s.saved) {
      const bytes = new Uint8Array(await f.blob.arrayBuffer());
      assert.deepEqual([...bytes.slice(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
      const view = new DataView(bytes.buffer);
      assert.deepEqual([view.getUint32(16), view.getUint32(20)], [1920, 1080]);
    }
    await waitFor(() => /Exported ao-iron-weather-1_.*\.png, ao-iron-weather-2_.*\.png\./.test(s.panel.textContent));
  });
});
