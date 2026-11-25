// Overlay at map scale (Epic 6 E6-4): print the selected COA at 1:25 000, 1:50 000 or 1:100 000, in
// its UTM grid with 1 km registration crosses, to lay over the paper map and the original acetate.
// Layout: export/overlay.js; docs/OVERLAYS.md.
import { el, describeError } from './dom.js';
import { overlayHtml, overlaySheets, OVERLAY_SCALES, OVERLAY_PAPERS } from '../../export/overlay.js';
import { coaFingerprint } from '../../../domain/coa-changes.js';
import { formatDtg, slideFileName } from '../../export/slide-layout.js';
import { downloadBlob } from '../../export/paint-slide.js';
import { printHtml as printDocument } from './print-html.js';

const SYMBOL_PX = 60;

/**
 * @param {{ client: object, root: HTMLElement, activeCoa: object, prefs?: object, saveFile?: Function, printHtml?: (html: string) => Promise<void>, now?: () => string }} options
 */
export function mountOverlayView({ client, root, activeCoa, prefs = null, saveFile = (blob, name) => downloadBlob(blob, name), printHtml = null, now = () => new Date().toISOString() }) {
  let destroyed = false;
  const remembered = (key, fallback, ok) => { const v = prefs?.get(key, fallback); return ok(v) ? v : fallback; };
  const scale = el('select', { attrs: { name: 'overlay-scale', 'aria-label': 'Scale' } }, ...OVERLAY_SCALES.map((s) => el('option', { attrs: { value: String(s) }, text: `1:${s.toLocaleString('en-GB')}` })));
  scale.value = String(remembered('overlayScale', 50000, (v) => OVERLAY_SCALES.includes(v)));
  const paper = el('select', { attrs: { name: 'overlay-paper', 'aria-label': 'Paper' } }, ...Object.entries(OVERLAY_PAPERS).map(([v, p]) => el('option', { attrs: { value: v }, text: p.name })));
  paper.value = remembered('overlayPaper', 'letter', (v) => v in OVERLAY_PAPERS);
  const orientation = el('select', { attrs: { name: 'overlay-orientation', 'aria-label': 'Orientation' } }, el('option', { attrs: { value: 'landscape' }, text: 'Landscape' }), el('option', { attrs: { value: 'portrait' }, text: 'Portrait' }));
  orientation.value = remembered('overlayOrientation', 'landscape', (v) => v === 'landscape' || v === 'portrait');
  const weapons = el('input', { attrs: { type: 'checkbox', name: 'overlay-weapons' } });
  const sheets = el('p', { class: 'hint', dataset: { overlaySheets: '' } });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
  root.replaceChildren(el('fieldset', { class: 'group', dataset: { overlay: '' } }, el('legend', { text: 'Overlay at map scale (print)' }),
    el('p', { class: 'hint', text: 'The selected COA at the paper map\'s scale, in its UTM grid with a cross at every 1 km grid crossing, to lay over the map. Print at Actual size (100 %).' }),
    el('div', { class: 'position' }, field('Scale', scale), field('Paper', paper)),
    el('div', { class: 'position' }, field('Orientation', orientation), el('label', { class: 'check' }, weapons, el('span', { text: 'Weapon ranges' }))),
    sheets,
    el('div', { class: 'actions' },
      el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Print…', on: { click: () => run('print') } }),
      el('button', { attrs: { type: 'button' }, text: 'Save (HTML)', on: { click: () => run('save') } })),
    status));

  const options = () => ({ scale: Number(scale.value), paper: paper.value, orientation: orientation.value, weapons: weapons.checked });
  function describeSheets() {
    const coa = activeCoa.get();
    const layout = coa ? overlaySheets(coa, options()) : null;
    sheets.textContent = !coa ? 'Select a COA to print its overlay.' : !layout ? 'This COA has nothing on it yet.'
      : `${layout.sheets.length} sheet${layout.sheets.length === 1 ? '' : 's'}${layout.sheets.length > 1 ? ` (${layout.rows} × ${layout.cols})` : ''}, UTM zone ${layout.zone}${layout.hemisphere}; each sheet ${(layout.tileM.w / 1000).toFixed(1)} × ${(layout.tileM.h / 1000).toFixed(1)} km.`;
  }
  for (const [control, key] of [[scale, 'overlayScale'], [paper, 'overlayPaper'], [orientation, 'overlayOrientation']]) {
    control.addEventListener('change', () => { prefs?.set(key, key === 'overlayScale' ? Number(control.value) : control.value); describeSheets(); });
  }
  weapons.addEventListener('change', describeSheets);

  async function run(action) {
    const coa = activeCoa.get();
    if (!coa) { status.textContent = 'Select a COA first.'; return; }
    const header = await client.ask('export.header', { format: 'coa-builder/overlay', coaIds: [coa.id] });
    if (destroyed) return;
    if (!header.ok) { status.textContent = describeError(header.error); return; }
    const symbols = await Promise.all(coa.symbols.map(async (u) => {
      const r = await client.ask('symbol.preview', { sidc: u.sidc, label: '', modifiers: {}, size: SYMBOL_PX });
      return r.ok ? r.value : null;
    }));
    if (destroyed) return;
    const html = overlayHtml({ coa, symbols, ...options(), header: header.value, fingerprint: coaFingerprint(coa) });
    if (!html) { status.textContent = 'This COA has nothing on it yet.'; return; }
    if (action === 'save') {
      const name = slideFileName(`${coa.name} overlay 1-${scale.value}`, formatDtg(now()), 'html');
      await saveFile(new Blob([html], { type: 'text/html' }), name);
      status.textContent = `Saved ${name}: open it in a browser and print it at Actual size (100 %).`;
      return;
    }
    status.textContent = 'Opening the print dialog: choose Actual size (100 %).';
    await (printHtml ?? ((h) => printDocument(h, root.ownerDocument)))(html);
  }

  const off = activeCoa.subscribe(describeSheets);
  describeSheets();
  return { destroy() { destroyed = true; off(); } };
}
