// Weather slide export (Epic 4 W-5): the forecast → PNG slides (three days each), with the
// project's classification marking and slide shape, and today's DTG.
import { layoutWeatherSlides } from '../../export/weather-slide.js';
import { paintSlide, canvasToPng } from '../../export/paint-slide.js';
import { formatDtg, slideFileName } from '../../export/slide-layout.js';
import { describeError } from './dom.js';

/** @returns {Promise<{ ok: true, fileNames: string[] } | { ok: false, message: string }>} */
export async function exportWeatherSlides({ client, forecastId, saveFile, doc, now = () => new Date().toISOString() }) {
  const [settings, forecast, matrix] = await Promise.all([
    client.ask('settings.get'), client.ask('weather.get', { forecastId }), client.ask('weather.matrix', { forecastId }),
  ]);
  const failed = [settings, forecast, matrix].find((r) => !r.ok);
  if (failed) return { ok: false, message: describeError(failed.error) };
  const dtg = formatDtg(now());
  const slides = layoutWeatherSlides({ forecast: forecast.value, matrix: matrix.value, aspect: settings.value.frame?.aspect ?? '16:9', marking: settings.value.marking, dtg });
  const fileNames = [];
  for (const [i, slide] of slides.entries()) {
    const name = slideFileName(`${forecast.value.name} weather${slides.length > 1 ? ` ${i + 1}` : ''}`, dtg);
    await saveFile(await canvasToPng(await paintSlide(slide, doc)), name);
    fileNames.push(name);
  }
  return { ok: true, fileNames };
}
