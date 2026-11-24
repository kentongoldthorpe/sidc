// Weather (Epic 4, D35–D37): forecasts with 0000–1200 / 1200–2400 periods and light data, critical
// values, and the weather effects matrix. Stored in the open project's "weather-forecasts" and
// "weather-criteria" collections.
import { defineMessage, checkId, checkRevision, validationFailed } from '../message-definition.js';
import {
  createForecast, updateForecast, setPeriod, removePeriod, setLight, removeLight, importWeather, readForecast,
  createCriterion, updateCriterion, readCriterion, effectsMatrix, EXAMPLE_CRITERIA,
} from '../../domain/weather.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const FORECASTS = 'weather-forecasts';
const CRITERIA = 'weather-criteria';
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function asForecastError(result, forecastId) {
  const { code, message, details } = result.error;
  if (code === ErrorCode.NOT_FOUND && details?.collection) return err(code, `Forecast ${forecastId} not found`, { forecastId });
  if (code === ErrorCode.CONFLICT) return err(code, 'This forecast was changed elsewhere; reload and try again', { forecastId, expectedRevision: details.expectedRevision, actualRevision: details.actualRevision });
  return err(code, message, details);
}
async function loadForecast(documents, forecastId) {
  const got = await documents.get(FORECASTS, forecastId);
  if (!got.ok) return asForecastError(got, forecastId);
  const forecast = readForecast(got.value);
  return forecast ? ok(forecast) : err(ErrorCode.STORAGE_UNAVAILABLE, `The stored forecast ${forecastId} is not valid`, { forecastId });
}

/** load → revision check → change → save (when something changed) → emit. */
async function mutate({ documentRepository, ctx, forecastId, expectedRevision, change }) {
  const problems = [...checkId('forecastId', forecastId), ...checkRevision('expectedRevision', expectedRevision)];
  if (problems.length) return validationFailed('Invalid weather payload', problems);
  const loaded = await loadForecast(documentRepository, forecastId);
  if (!loaded.ok) return loaded;
  if (loaded.value.revision !== expectedRevision) {
    return err(ErrorCode.CONFLICT, 'This forecast was changed elsewhere; reload and try again', { forecastId, expectedRevision, actualRevision: loaded.value.revision });
  }
  const changed = change(loaded.value);
  if (!changed.ok) return changed;
  const { forecast, events } = changed.value;
  if (events.length === 0) return ok(forecast);
  const saved = await documentRepository.save(FORECASTS, forecast, { expectedRevision });
  if (!saved.ok) return asForecastError(saved, forecastId);
  events.forEach((e) => ctx.emit(e));
  return ok(forecast);
}

const now = (clock) => ({ now: clock.now() });

/** weather.create { name, area?, timeZone? (default "Z") } → ok(Forecast); emits weather.created. */
export const createForecastMessage = defineMessage({
  kind: 'command', type: 'weather.create', v: 1, required: ['name'], optional: ['area', 'timeZone'],
  async handle({ payload, ctx, ports: { documentRepository, ids, clock } }) {
    const created = createForecast({ id: ids.next('wx'), ...payload }, now(clock));
    if (!created.ok) return created;
    const saved = await documentRepository.save(FORECASTS, created.value.forecast, { expectedRevision: 0 });
    if (!saved.ok) return asForecastError(saved, created.value.forecast.id);
    created.value.events.forEach((e) => ctx.emit(e));
    return ok(created.value.forecast);
  },
});

/** weather.update { forecastId, expectedRevision, name?, area?, timeZone? } → ok(Forecast). */
export const updateForecastMessage = defineMessage({
  kind: 'command', type: 'weather.update', v: 1, required: ['forecastId', 'expectedRevision'], optional: ['name', 'area', 'timeZone'],
  handle: ({ payload: { forecastId, expectedRevision, ...changes }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, forecastId, expectedRevision, change: (f) => updateForecast(f, changes, now(clock)) }),
});

/** weather.set-period { forecastId, expectedRevision, date, half, values } (the form): merges; null removes a value. */
export const setPeriodMessage = defineMessage({
  kind: 'command', type: 'weather.set-period', v: 1, required: ['forecastId', 'expectedRevision', 'date', 'half', 'values'],
  handle: ({ payload: { forecastId, expectedRevision, date, half, values }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, forecastId, expectedRevision, change: (f) => setPeriod(f, { date, half, values }, now(clock)) }),
});

/** weather.remove-period { forecastId, expectedRevision, date, half }. */
export const removePeriodMessage = defineMessage({
  kind: 'command', type: 'weather.remove-period', v: 1, required: ['forecastId', 'expectedRevision', 'date', 'half'],
  handle: ({ payload: { forecastId, expectedRevision, date, half }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, forecastId, expectedRevision, change: (f) => removePeriod(f, { date, half }, now(clock)) }),
});

/** weather.set-light { forecastId, expectedRevision, date, values }. */
export const setLightMessage = defineMessage({
  kind: 'command', type: 'weather.set-light', v: 1, required: ['forecastId', 'expectedRevision', 'date', 'values'],
  handle: ({ payload: { forecastId, expectedRevision, date, values }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, forecastId, expectedRevision, change: (f) => setLight(f, { date, values }, now(clock)) }),
});

/** weather.remove-light { forecastId, expectedRevision, date }. */
export const removeLightMessage = defineMessage({
  kind: 'command', type: 'weather.remove-light', v: 1, required: ['forecastId', 'expectedRevision', 'date'],
  handle: ({ payload: { forecastId, expectedRevision, date }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, forecastId, expectedRevision, change: (f) => removeLight(f, { date }, now(clock)) }),
});

/** weather.import { forecastId, expectedRevision, periods?, light?, mode?: merge | replace } (CSV files are read by the adapter). */
export const importWeatherMessage = defineMessage({
  kind: 'command', type: 'weather.import', v: 1, required: ['forecastId', 'expectedRevision'], optional: ['periods', 'light', 'mode'],
  handle: ({ payload: { forecastId, expectedRevision, periods, light, mode }, ctx, ports: { documentRepository, clock } }) =>
    mutate({ documentRepository, ctx, forecastId, expectedRevision, change: (f) => importWeather(f, { periods, light, mode }, now(clock)) }),
});

/** weather.delete { forecastId, expectedRevision } → ok({ forecastId }); emits weather.deleted. */
export const deleteForecastMessage = defineMessage({
  kind: 'command', type: 'weather.delete', v: 1, required: ['forecastId', 'expectedRevision'],
  async handle({ payload: { forecastId, expectedRevision }, ctx, ports: { documentRepository } }) {
    const problems = [...checkId('forecastId', forecastId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid weather.delete payload', problems);
    const removed = await documentRepository.remove(FORECASTS, forecastId, { expectedRevision });
    if (!removed.ok) return asForecastError(removed, forecastId);
    ctx.emit({ type: 'weather.deleted', v: 1, payload: { forecastId } });
    return ok({ forecastId });
  },
});

/** weather.list {} → ok([{ id, name, area, revision, periodCount, firstDate, lastDate }]) by name. */
export const listForecastsMessage = defineMessage({
  kind: 'query', type: 'weather.list', v: 1,
  async handle({ ports: { documentRepository } }) {
    const listed = await documentRepository.list(FORECASTS);
    if (!listed.ok) return listed;
    return ok(listed.value.map(readForecast).filter(Boolean).sort(byName).map((f) => ({
      id: f.id, name: f.name, area: f.area, revision: f.revision, periodCount: f.periods.length,
      firstDate: f.periods[0]?.date ?? null, lastDate: f.periods.at(-1)?.date ?? null,
    })));
  },
});

/** weather.get { forecastId } → ok(Forecast). */
export const getForecastMessage = defineMessage({
  kind: 'query', type: 'weather.get', v: 1, required: ['forecastId'],
  handle: ({ payload: { forecastId }, ports: { documentRepository } }) => loadForecast(documentRepository, forecastId),
});

async function listCriteria(documents) {
  const listed = await documents.list(CRITERIA);
  return listed.ok ? ok(listed.value.map(readCriterion).filter(Boolean).sort((a, b) => a.group.localeCompare(b.group) || byName(a, b))) : listed;
}

/** weather.matrix { forecastId } → ok({ periods, rows }): every critical value rated per period (D36). */
export const matrixMessage = defineMessage({
  kind: 'query', type: 'weather.matrix', v: 1, required: ['forecastId'],
  async handle({ payload: { forecastId }, ports: { documentRepository } }) {
    const [forecast, criteria] = await Promise.all([loadForecast(documentRepository, forecastId), listCriteria(documentRepository)]);
    if (!forecast.ok) return forecast;
    if (!criteria.ok) return criteria;
    return ok(effectsMatrix(forecast.value, criteria.value));
  },
});

function asCriterionError(result, criterionId) {
  const { code, message, details } = result.error;
  if (code === ErrorCode.NOT_FOUND) return err(code, `Critical values ${criterionId} not found`, { criterionId });
  if (code === ErrorCode.CONFLICT) return err(code, 'These critical values were changed elsewhere; reload and try again', { criterionId, expectedRevision: details.expectedRevision, actualRevision: details.actualRevision });
  return err(code, message, details);
}

/** weather-criterion.create { name, group?, rules? } → ok(Criterion). */
export const createCriterionMessage = defineMessage({
  kind: 'command', type: 'weather-criterion.create', v: 1, required: ['name'], optional: ['group', 'rules'],
  async handle({ payload, ctx, ports: { documentRepository, ids } }) {
    const created = createCriterion({ id: ids.next('wc'), ...payload });
    if (!created.ok) return created;
    const saved = await documentRepository.save(CRITERIA, created.value.criterion, { expectedRevision: 0 });
    if (!saved.ok) return asCriterionError(saved, created.value.criterion.id);
    created.value.events.forEach((e) => ctx.emit(e));
    return ok(created.value.criterion);
  },
});

/** weather-criterion.update { criterionId, expectedRevision, name?, group?, rules? }: an edited example stops being marked as one. */
export const updateCriterionMessage = defineMessage({
  kind: 'command', type: 'weather-criterion.update', v: 1, required: ['criterionId', 'expectedRevision'], optional: ['name', 'group', 'rules'],
  async handle({ payload: { criterionId, expectedRevision, ...changes }, ctx, ports: { documentRepository } }) {
    const problems = [...checkId('criterionId', criterionId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid weather-criterion.update payload', problems);
    const got = await documentRepository.get(CRITERIA, criterionId);
    if (!got.ok) return asCriterionError(got, criterionId);
    const current = readCriterion(got.value);
    if (!current) return err(ErrorCode.STORAGE_UNAVAILABLE, `The stored critical values ${criterionId} are not valid`, { criterionId });
    if (current.revision !== expectedRevision) return err(ErrorCode.CONFLICT, 'These critical values were changed elsewhere; reload and try again', { criterionId, expectedRevision, actualRevision: current.revision });
    const updated = updateCriterion(current, changes);
    if (!updated.ok) return updated;
    if (!updated.value.events.length) return ok(updated.value.criterion);
    const saved = await documentRepository.save(CRITERIA, updated.value.criterion, { expectedRevision });
    if (!saved.ok) return asCriterionError(saved, criterionId);
    updated.value.events.forEach((e) => ctx.emit(e));
    return ok(updated.value.criterion);
  },
});

/** weather-criterion.delete { criterionId, expectedRevision }. */
export const deleteCriterionMessage = defineMessage({
  kind: 'command', type: 'weather-criterion.delete', v: 1, required: ['criterionId', 'expectedRevision'],
  async handle({ payload: { criterionId, expectedRevision }, ctx, ports: { documentRepository } }) {
    const problems = [...checkId('criterionId', criterionId), ...checkRevision('expectedRevision', expectedRevision)];
    if (problems.length) return validationFailed('Invalid weather-criterion.delete payload', problems);
    const removed = await documentRepository.remove(CRITERIA, criterionId, { expectedRevision });
    if (!removed.ok) return asCriterionError(removed, criterionId);
    ctx.emit({ type: 'weather-criterion.deleted', v: 1, payload: { criterionId } });
    return ok({ criterionId });
  },
});

/** weather-criterion.list {} → ok(Criterion[]) by group, then name. */
export const listCriteriaMessage = defineMessage({
  kind: 'query', type: 'weather-criterion.list', v: 1,
  handle: ({ ports: { documentRepository } }) => listCriteria(documentRepository),
});

/**
 * weather-criterion.add-examples {} → ok({ criteria }): adds the starter critical values (D36),
 * marked as examples, skipping names already used. Never done without being asked.
 */
export const addExamplesMessage = defineMessage({
  kind: 'command', type: 'weather-criterion.add-examples', v: 1,
  async handle({ ctx, ports: { documentRepository, ids } }) {
    const existing = await listCriteria(documentRepository);
    if (!existing.ok) return existing;
    const taken = new Set(existing.value.map((c) => c.name));
    const criteria = EXAMPLE_CRITERIA.filter((c) => !taken.has(c.name)).map((c) => createCriterion({ id: ids.next('wc'), ...c, example: true }).value.criterion);
    for (const c of criteria) {
      const saved = await documentRepository.save(CRITERIA, c, { expectedRevision: 0 });
      if (!saved.ok) return asCriterionError(saved, c.id);
    }
    criteria.forEach((criterion) => ctx.emit({ type: 'weather-criterion.created', v: 1, payload: { criterion } }));
    return ok({ criteria });
  },
});

export const WEATHER_MESSAGES = Object.freeze([
  createForecastMessage, updateForecastMessage, setPeriodMessage, removePeriodMessage, setLightMessage, removeLightMessage,
  importWeatherMessage, deleteForecastMessage, listForecastsMessage, getForecastMessage, matrixMessage,
  createCriterionMessage, updateCriterionMessage, deleteCriterionMessage, listCriteriaMessage, addExamplesMessage,
]);
