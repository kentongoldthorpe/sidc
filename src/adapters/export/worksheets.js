// Printable worksheets (Epic 6 E6-2, D45): the record surfaces of the analog workflow
// (docs/ANALOG-DIGITAL-WORKFLOW.md). Pure layout: a print-ready HTML document (no scripts), and the
// matching CSV templates.
//
//   units    one unit per line: name, unit template or symbol code, grid (zone and square, easting,
//            northing), facing, HVT, higher formation, remarks
//   lines    one line or area per row: name, kind (short codes), side, text above, points (grids, in order)
//   changes  the change sheet: name, action (add / change / remove), new grid, new name, other change,
//            initials, DTG; names the version it changes
//
// Every page has the classification banners, the title, project, COA, version fingerprint, DTG and
// "page n of m"; the last page has the sign-off (filled in, entered, read back by; counts). Under each
// column heading is the CSV column it is typed into, so transcription is mechanical. Blank worksheets
// have no COA; pre-filled ones list the COA's items and leave blank lines for additions.
import { toMgrs } from '../../domain/mgrs.js';

export const WORKSHEET_KINDS = Object.freeze(['units', 'lines', 'changes']);
export const PAPERS = Object.freeze({
  letter: Object.freeze({ name: 'Letter', size: 'letter landscape', heightMm: 215.9 }),
  a4: Object.freeze({ name: 'A4', size: 'A4 landscape', heightMm: 210 }),
});
const MARGIN_MM = 10;
const CHROME_MM = 64; // banners, title, information and instruction lines, table heading
const SIGN_OFF_MM = 30;

/** Short codes for line and area kinds, as written on paper (the CSV importer reads them too). */
export const KIND_CODES = Object.freeze({
  PL: 'phaseLine', BDY: 'boundary', AXIS: 'axisOfAdvance', RTE: 'route', LN: 'line',
  OBJ: 'objective', AA: 'assemblyArea', EA: 'engagementArea', AREA: 'area', RING: 'rangeRing', SECT: 'sector',
});
const CODE_OF = Object.freeze(Object.fromEntries(Object.entries(KIND_CODES).map(([c, k]) => [k, c])));
/** Side letters, as written on paper. */
export const SIDE_CODES = Object.freeze({ F: 'friendly', H: 'hostile', N: 'neutral', U: 'unknown' });
const SIDE_OF = Object.freeze(Object.fromEntries(Object.entries(SIDE_CODES).map(([c, s]) => [s, c])));

/** The columns of each worksheet: heading, the CSV column it is typed into, width (%), and how a COA fills it. */
const SPECS = Object.freeze({
  units: {
    title: 'Unit worksheet', rowMm: 9,
    instructions: 'One unit per line. Name every unit (unique in the COA). Grids: zone and square, then 4 or 5 digits each way, e.g. 18S UJ | 2348 | 0648.',
    columns: [
      { head: '#', width: 3 },
      { head: 'Name', csv: 'label', width: 13 },
      { head: 'Unit template or symbol code', csv: 'template / sidc', width: 18 },
      { head: 'Zone and square', csv: 'mgrs', width: 9, grid: 'square' },
      { head: 'Easting', csv: '(mgrs)', width: 8, grid: 'e' },
      { head: 'Northing', csv: '(mgrs)', width: 8, grid: 'n' },
      { head: 'Facing °', csv: 'facing', width: 6 },
      { head: 'HVT', csv: 'hvt', width: 4 },
      { head: 'Higher formation', csv: 'higherFormation', width: 12 },
      { head: 'Remarks', csv: 'staffComments', width: 19 },
    ],
    csv: ['coa', 'label', 'template', 'sidc', 'mgrs', 'facing', 'hvt', 'higherFormation', 'staffComments'],
    items: (coa) => coa.symbols,
    cells: (u) => {
      const grid = splitGrid(u.position);
      return ['', u.label, u.sidc, grid.square, grid.e, grid.n, u.facing ?? '', u.hvt ? 'X' : '', u.modifiers?.higherFormation ?? '', u.modifiers?.staffComments ?? ''];
    },
  },
  lines: {
    title: 'Lines and areas worksheet', rowMm: 15,
    instructions: `One line or area per row. Kind: ${Object.entries(KIND_CODES).map(([c, k]) => `${c} ${words(k)}`).join(', ')}. Side: F, H, N, U. Points: grids in order, separated by ; (a ring or sector: its centre, and its radius).`,
    columns: [
      { head: '#', width: 3 },
      { head: 'Name', csv: 'label', width: 12 },
      { head: 'Kind', csv: 'kind', width: 6 },
      { head: 'Side', csv: 'side', width: 5 },
      { head: 'Text above the line', csv: 'annotation', width: 12 },
      { head: 'Points (grids, in order)', csv: 'points', width: 52 },
      { head: 'Radius m', csv: 'radius', width: 10 },
    ],
    csv: ['coa', 'label', 'kind', 'side', 'annotation', 'points', 'radius'],
    items: (coa) => coa.graphics,
    cells: (g) => ['', g.label, CODE_OF[g.kind] ?? g.kind, SIDE_OF[g.side] ?? '', g.annotation ?? '',
      (g.points ?? (g.center ? [g.center] : [])).map((p) => toMgrs(p, 4) ?? `${p.lat.toFixed(5)} ${p.lng.toFixed(5)}`).join('; '), g.radius ?? ''],
  },
  changes: {
    title: 'Change sheet', rowMm: 10,
    instructions: 'One change per line, naming the item as it is on the copy you changed. Add: give a template or symbol and a grid. Change: give only what changes. Remove: the name is enough.',
    columns: [
      { head: '#', width: 3 },
      { head: 'Name', csv: 'label', width: 13 },
      { head: 'Action', csv: 'action', width: 17, boxes: ['add', 'change', 'remove'] },
      { head: 'Zone and square', csv: 'mgrs', width: 8 },
      { head: 'Easting', csv: '(mgrs)', width: 7 },
      { head: 'Northing', csv: '(mgrs)', width: 7 },
      { head: 'New name', csv: 'newLabel', width: 11 },
      { head: 'Template or symbol (to add)', csv: 'template / sidc', width: 13 },
      { head: 'Other change', csv: '(type into the app)', width: 10 },
      { head: 'Initials', width: 5 },
      { head: 'DTG', width: 6 },
    ],
    csv: ['label', 'action', 'mgrs', 'newLabel', 'template', 'sidc'],
    items: () => [], // a change sheet starts blank: changes are what is written on it
    cells: () => [],
  },
});

function words(kind) { return kind.replace(/([A-Z])/g, ' $1').toLowerCase(); }

/** A position as written on a worksheet: { square: "18S UJ", e: "2348", n: "0648" } (10 m). */
export function splitGrid(position) {
  const text = position ? toMgrs(position, 4) : null;
  if (!text) return { square: '', e: '', n: '' };
  const [zone, square, e, n] = text.split(' ');
  return { square: `${zone} ${square}`, e, n };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** How many rows fit on a full page and on the last page (which has the sign-off). */
export function rowsPerPage(kind, paper = 'letter') {
  const usable = PAPERS[paper].heightMm - 2 * MARGIN_MM - CHROME_MM;
  const row = SPECS[kind].rowMm;
  return { full: Math.floor(usable / row), last: Math.floor((usable - SIGN_OFF_MM) / row) };
}

/**
 * The pages of a worksheet: each a list of rows (an item or null for a blank line), numbered on.
 * A pre-filled worksheet keeps at least `spare` blank lines for additions, and fills its last page.
 */
export function paginate(items, { full, last }, { spare = 3 } = {}) {
  const pages = [];
  let rest = items.length ? [...items] : [];
  while (rest.length + (items.length ? spare : 0) > last) {
    pages.push(rest.slice(0, full));
    rest = rest.slice(full);
    if (rest.length === 0 && items.length) break;
  }
  pages.push([...rest, ...Array(Math.max(0, last - rest.length)).fill(null)]);
  return pages.map((page, i) => (i < pages.length - 1 ? [...page, ...Array(Math.max(0, full - page.length)).fill(null)] : page));
}

/**
 * The HTML document for one or more worksheets.
 * @param {{ kinds: string[], coa?: object|null, header: { classification: string, classificationColor: string, project: string, dtg: string, application: string },
 *           fingerprint?: string|null, paper?: 'letter'|'a4' }} input
 * @returns {string}
 */
export function worksheetHtml({ kinds, coa = null, header, fingerprint = null, paper = 'letter' }) {
  const color = /^#[0-9a-f]{6}$/i.test(header.classificationColor ?? '') ? header.classificationColor : '#5b6157';
  const ink = textOn(color);
  const sections = [];
  for (const kind of kinds) {
    const spec = SPECS[kind];
    const items = coa ? spec.items(coa) : [];
    const pages = paginate(items, rowsPerPage(kind, paper));
    let n = 0;
    pages.forEach((rows, p) => {
      const lastPage = p === pages.length - 1;
      const body = rows.map((item) => {
        n += 1;
        const cells = item ? spec.cells(item) : spec.columns.map(() => '');
        return `<tr style="height:${spec.rowMm}mm">${spec.columns.map((c, i) => {
          if (i === 0) return `<td class="num">${n}</td>`;
          if (c.boxes) return `<td class="boxes">${c.boxes.map((b) => `<span>☐ ${esc(b)}</span>`).join(' ')}</td>`;
          return `<td${c.grid ? ' class="grid"' : ''}>${esc(cells[i])}</td>`;
        }).join('')}</tr>`;
      }).join('');
      sections.push(`<section class="page">
<div class="banner">${esc(header.classification)}</div>
<div class="titles"><h1>${esc(spec.title)}</h1><span class="pageno">Page ${p + 1} of ${pages.length}</span></div>
<div class="info"><span>Project: <b>${esc(header.project)}</b></span><span>COA: ${coa ? `<b>${esc(coa.name)}</b>` : '<span class="blank wide"></span>'}</span><span>Version: ${fingerprint ? `<b class="fp">${esc(fingerprint)}</b>` : '<span class="blank"></span>'}</span><span>Printed: ${esc(header.dtg)}</span></div>
<p class="instructions">${esc(spec.instructions)}</p>
<table><colgroup>${spec.columns.map((c) => `<col style="width:${c.width}%">`).join('')}</colgroup>
<thead><tr>${spec.columns.map((c) => `<th>${esc(c.head)}${c.csv ? `<small>${esc(c.csv)}</small>` : ''}</th>`).join('')}</tr></thead>
<tbody>${body}</tbody></table>
${lastPage ? signOff(kind, coa, items.length) : ''}
<div class="banner bottom">${esc(header.classification)}</div>
</section>`);
    });
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`${kinds.map((k) => SPECS[k].title).join(', ')}${coa ? ` – ${coa.name}` : ''}`)}</title>
<style>
@page { size: ${PAPERS[paper].size}; margin: ${MARGIN_MM}mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10pt/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; }
.page { height: ${PAPERS[paper].heightMm - 2 * MARGIN_MM}mm; display: flex; flex-direction: column; gap: 2mm; break-after: page; page-break-after: always; overflow: hidden; }
.page:last-child { break-after: auto; page-break-after: auto; }
.banner { background: ${color}; color: ${ink}; text-align: center; font-weight: 700; letter-spacing: .04em; padding: 1mm; }
.banner.bottom { margin-top: auto; }
.titles { display: flex; justify-content: space-between; align-items: baseline; }
h1 { font-size: 14pt; margin: 0; }
.pageno { font-weight: 600; }
.info { display: flex; gap: 6mm; flex-wrap: wrap; }
.blank { display: inline-block; min-width: 22mm; border-bottom: 1px solid #111; }
.blank.wide { min-width: 50mm; }
.fp { font-family: ui-monospace, Consolas, monospace; letter-spacing: .05em; }
.instructions { margin: 0; color: #333; font-size: 8.5pt; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 1px solid #333; padding: .6mm 1.2mm; vertical-align: top; overflow-wrap: anywhere; }
th { background: #eef0ea; text-align: left; font-size: 8.5pt; }
th small { display: block; font-weight: 400; color: #555; font-family: ui-monospace, Consolas, monospace; font-size: 7pt; }
td.num { text-align: right; color: #555; }
td.grid { font-family: ui-monospace, Consolas, monospace; letter-spacing: .06em; }
td.boxes span { white-space: nowrap; margin-right: 1mm; font-size: 8pt; }
.signoff { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm 6mm; border: 1px solid #333; padding: 2mm; font-size: 9pt; }
.signoff div { display: flex; flex-direction: column; gap: 1mm; }
.signoff .line { border-bottom: 1px solid #111; height: 6mm; }
.signoff .note { grid-column: 1 / -1; color: #444; font-size: 8pt; }
@media screen { body { background: #ccc; padding: 8mm; } .page { background: #fff; padding: ${MARGIN_MM}mm; margin: 0 auto 8mm; width: ${paper === 'a4' ? 297 : 279.4}mm; height: ${PAPERS[paper].heightMm}mm; box-shadow: 0 1mm 4mm rgba(0,0,0,.3); } }
</style></head>
<body>
${sections.join('\n')}
</body></html>
`;
}

function signOff(kind, coa, count) {
  const what = { units: 'units', lines: 'lines and areas', changes: 'changes' }[kind];
  const counted = coa && kind !== 'changes' ? `Printed with <b>${count}</b> ${what}. Count now:` : `Number of ${what}:`;
  const into = kind === 'changes' ? 'COA Builder: Update from file… (a CSV with these columns), or by hand'
    : 'COA Builder: Import COAs… or Update from file… (a CSV with the columns shown under each heading)';
  return `<div class="signoff">
<div>Filled in by<span class="line"></span>DTG<span class="line"></span></div>
<div>Entered by<span class="line"></span>DTG<span class="line"></span></div>
<div>Read back by<span class="line"></span>DTG<span class="line"></span></div>
<div><span>${counted}</span><span class="line"></span></div>
<p class="note">Typed into ${esc(into)}. Keep this sheet with its marking.</p>
</div>`;
}

/** The marking's text colour: black or white, whichever reads on the banner. */
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#ffffff';
}

/**
 * The CSV to type a worksheet into: the marking line, the version line (when known), and the header
 * row; the columns the importer reads (docs/IMPORT-FORMAT.md, docs/CHANGE-SHEETS.md).
 */
export function worksheetCsvTemplate(kind, { header, coa = null, fingerprint = null }) {
  const line = `# ${header.classification} // ${header.project} // ${SPECS[kind].title} template // ${header.dtg}`;
  const version = fingerprint ? (kind === 'changes' ? `# version: ${fingerprint}` : `# version ${coa?.name ?? ''}: ${fingerprint}`) : null;
  return `﻿${[line, ...(version ? [version] : []), SPECS[kind].csv.join(',')].join('\r\n')}\r\n`;
}
