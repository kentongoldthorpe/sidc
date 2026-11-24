// Template slide export (T-7): the play shown (formation or a threat COA) → a PNG, with the
// project's classification marking and slide shape, and today's DTG.
import { layoutTemplateSlide, playOf } from '../../export/template-slide.js';
import { paintSlide, canvasToPng } from '../../export/paint-slide.js';
import { formatDtg, slideFileName } from '../../export/slide-layout.js';
import { describeError } from './dom.js';

const SYMBOL_SIZE = 40; // on a 1080-pixel-high slide

/** @returns {Promise<{ ok: true, fileName: string } | { ok: false, message: string }>} */
export async function exportTemplateSlide({ client, model, play, saveFile, doc, now = () => new Date().toISOString() }) {
  const shown = playOf(model, play);
  if (!shown) return { ok: false, message: 'That play no longer exists.' };
  const settings = await client.ask('settings.get');
  if (!settings.ok) return { ok: false, message: describeError(settings.error) };
  const aspect = settings.value.frame?.aspect ?? '16:9';
  const size = Math.round(SYMBOL_SIZE * ((aspect === '16:9' ? 1080 : 1200) / 1080));
  const previews = await Promise.all(shown.template.units.map((u) => client.ask('symbol.preview', { sidc: u.sidc, label: u.label, modifiers: {}, size })));
  const failed = previews.find((r) => !r.ok);
  if (failed) return { ok: false, message: describeError(failed.error) };
  const dtg = formatDtg(now());
  const slide = layoutTemplateSlide({ model, play, aspect, marking: settings.value.marking, dtg, symbols: previews.map((r) => r.value) });
  const fileName = slideFileName(shown.title, dtg);
  await saveFile(await canvasToPng(await paintSlide(slide, doc)), fileName);
  return { ok: true, fileName };
}
