// Worksheets (Epic 6 E6-2): print the record surfaces of the analog workflow, blank or pre-filled from
// the selected COA, with its version; save them as HTML to print elsewhere; or download the matching
// CSV template to type a filled-in worksheet into. Layout: export/worksheets.js.
import { el, describeError } from './dom.js';
import { worksheetHtml, worksheetCsvTemplate, WORKSHEET_KINDS, PAPERS } from '../../export/worksheets.js';
import { coaFingerprint } from '../../../domain/coa-changes.js';
import { formatDtg, slideFileName } from '../../export/slide-layout.js';
import { downloadBlob } from '../../export/paint-slide.js';

const KIND_NAMES = Object.freeze({ all: 'All three', units: 'Units', lines: 'Lines and areas', changes: 'Change sheet' });

/**
 * @param {{ client: object, root: HTMLElement, activeCoa: object, prefs?: object, saveFile?: (blob: Blob, name: string) => Promise<void>,
 *           printHtml?: (html: string) => Promise<void>, now?: () => string }} options
 *   printHtml: prints a document (default: a hidden frame and the browser's print dialog)
 */
export function mountWorksheetsView({ client, root, activeCoa, prefs = null, saveFile = (blob, name) => downloadBlob(blob, name), printHtml = null, now = () => new Date().toISOString() }) {
  let destroyed = false;
  const kind = el('select', { attrs: { name: 'worksheet-kind', 'aria-label': 'Worksheet' } }, ...Object.entries(KIND_NAMES).map(([v, t]) => el('option', { attrs: { value: v }, text: t })));
  const fill = el('select', { attrs: { name: 'worksheet-fill', 'aria-label': 'Blank or pre-filled' } },
    el('option', { attrs: { value: 'coa' }, text: 'Pre-filled from this COA' }), el('option', { attrs: { value: 'blank' }, text: 'Blank' }));
  const paper = el('select', { attrs: { name: 'worksheet-paper', 'aria-label': 'Paper' } }, ...Object.entries(PAPERS).map(([v, p]) => el('option', { attrs: { value: v }, text: p.name })));
  paper.value = prefs?.get('worksheetPaper', 'letter') in PAPERS ? prefs.get('worksheetPaper', 'letter') : 'letter';
  paper.addEventListener('change', () => prefs?.set('worksheetPaper', paper.value));
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
  root.replaceChildren(el('fieldset', { class: 'group', dataset: { worksheets: '' } }, el('legend', { text: 'Worksheets (print)' }),
    el('p', { class: 'hint', text: 'Forms to fill in by hand, laid out like the import columns, with the marking and the COA\'s version. Type a filled-in sheet into the CSV template, then Import COAs… or Update from file…' }),
    el('div', { class: 'position' }, field('Worksheet', kind), field('Paper', paper)),
    field('Contents', fill),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Print…', on: { click: () => run('print') } }),
      el('button', { attrs: { type: 'button' }, text: 'Save (HTML)', on: { click: () => run('save') } }),
      el('button', { attrs: { type: 'button' }, text: 'CSV template', on: { click: () => run('csv') } })),
    status));

  async function run(action) {
    const coa = fill.value === 'coa' ? activeCoa.get() : null;
    if (fill.value === 'coa' && !coa) { status.textContent = 'Select a COA to pre-fill, or choose Blank.'; return; }
    const kinds = kind.value === 'all' ? [...WORKSHEET_KINDS] : [kind.value];
    const header = await client.ask('export.header', { format: 'coa-builder/worksheet', ...(coa ? { coaIds: [coa.id] } : {}) });
    if (destroyed) return;
    if (!header.ok) { status.textContent = describeError(header.error); return; }
    const fingerprint = coa ? coaFingerprint(coa) : null;
    const base = `${coa ? coa.name : 'blank'} ${kind.value === 'all' ? 'worksheets' : `${kind.value} worksheet`}`;
    const stamp = formatDtg(now());
    if (action === 'csv') {
      for (const k of kinds) {
        const name = slideFileName(`${coa ? coa.name : 'blank'} ${k} template`, stamp, 'csv');
        await saveFile(new Blob([worksheetCsvTemplate(k, { header: header.value, coa, fingerprint })], { type: 'text/csv' }), name);
      }
      status.textContent = `Saved ${kinds.length === 1 ? 'the CSV template' : `${kinds.length} CSV templates`}.`;
      return;
    }
    const html = worksheetHtml({ kinds, coa, header: header.value, fingerprint, paper: paper.value });
    if (action === 'save') {
      const name = slideFileName(base, stamp, 'html');
      await saveFile(new Blob([html], { type: 'text/html' }), name);
      status.textContent = `Saved ${name}: open it in a browser and print it.`;
      return;
    }
    status.textContent = 'Opening the print dialog…';
    await (printHtml ?? printInFrame)(html);
    if (!destroyed) status.textContent = '';
  }

  /** Print a document through a hidden frame, so the app's page is not replaced. */
  function printInFrame(html) {
    return new Promise((resolve) => {
      const doc = root.ownerDocument;
      const frame = doc.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;';
      frame.addEventListener('load', () => {
        const win = frame.contentWindow;
        const done = () => { frame.remove(); resolve(); };
        win.addEventListener('afterprint', done, { once: true });
        win.focus();
        win.print();
        setTimeout(done, 60_000); // a browser that never reports afterprint
      }, { once: true });
      frame.srcdoc = html;
      doc.body.append(frame);
    });
  }

  return { destroy() { destroyed = true; } };
}
