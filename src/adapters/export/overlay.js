// Overlays at map scale (Epic 6 E6-4, D46): a COA printed at 1:25 000, 1:50 000 or 1:100 000 to lay over
// the paper map and the original acetate (docs/OVERLAYS.md). Pure layout: print-ready HTML with one SVG
// per sheet, sized in millimetres.
//
// Drawn in UTM, in the grid zone of the COA's centre, as military maps are: the 1 km grid is square,
// so the registration crosses (every 1 km grid crossing, numbered along the edges, with the full
// reference at a corner) lie on the paper map's grid lines. A COA larger than a sheet is tiled over
// sheets, numbered north to south and west to east. Each sheet has a 100 mm scale check: printed at any
// size but 100 %, the bar is not 100 mm and the overlay will not fit the map.
import { toUtmInZone, fromUtm, toMgrs, zoneOf } from '../../domain/mgrs.js';
import { sectorOutlineGeo } from '../../domain/geodesy.js';
import { graphicColor, shapeOf } from '../../domain/graphic.js';
import { coverageGraphics } from '../../domain/weapon.js';

export const OVERLAY_SCALES = Object.freeze([25000, 50000, 100000]);
export const OVERLAY_PAPERS = Object.freeze({ letter: { name: 'Letter', w: 279.4, h: 215.9 }, a4: { name: 'A4', w: 297, h: 210 } });
const MARGIN = 10;
const TOP = 6 + 15; // banner, title and information lines (mm)
const BOTTOM = 18 + 6; // scale check and instructions, banner
const GAP = 2;
const SYMBOL_MM = 9;
const EDGE_MARGIN_M = 500;

/** A northing continuous across the equator in the sheet's hemisphere (UTM south adds 10 000 km). */
const northingIn = (u, lat, hemisphere) => u.northing + (hemisphere === 'S' && lat >= 0 ? 10000000 : 0) - (hemisphere === 'N' && lat < 0 ? 10000000 : 0);

/** The sheet's map area in mm. */
export function mapArea(paper, orientation) {
  const p = OVERLAY_PAPERS[paper];
  const [w, h] = orientation === 'portrait' ? [p.h, p.w] : [p.w, p.h];
  // 2 mm of slack across: content wider than the printable area makes browsers shrink the whole page,
  // and a shrunk overlay does not fit the map.
  return { pageW: w, pageH: h, w: w - 2 * MARGIN - 2, h: h - 2 * MARGIN - TOP - BOTTOM - 2 * GAP };
}

/** Every position an overlay must show (units, points, ring and sector outlines, optionally weapon ranges). */
function positionsOf(coa, weapons) {
  const pts = coa.symbols.map((u) => u.position);
  for (const g of coa.graphics) {
    const shape = shapeOf(g.kind);
    if (shape === 'circle') pts.push(...sectorOutlineGeo(g.center, { radius: g.radius, bearing: 0, arc: 360 }, 15));
    else if (shape === 'sector') pts.push(...sectorOutlineGeo(g.center, g, 15));
    else pts.push(...g.points);
  }
  if (weapons) for (const u of coa.symbols) for (const c of coverageGraphics(u)) pts.push(...sectorOutlineGeo(c.center, c.kind === 'rangeRing' ? { radius: c.radius, bearing: 0, arc: 360 } : c, 15));
  return pts;
}

/**
 * The sheets for a COA: its grid zone, and each sheet's UTM extent (metres).
 * @returns {{ zone: number, hemisphere: 'N'|'S', area: object, tileM: { w: number, h: number }, sheets: { row, col, e0, e1, n0, n1 }[] } | null}
 *   null when the COA has nothing to print
 */
export function overlaySheets(coa, { scale = 50000, paper = 'letter', orientation = 'landscape', weapons = false } = {}) {
  const pts = positionsOf(coa, weapons);
  if (!pts.length) return null;
  const mid = { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length };
  const zone = zoneOf(mid.lat, mid.lng);
  const hemisphere = mid.lat < 0 ? 'S' : 'N';
  const utm = pts.map((p) => { const u = toUtmInZone(p, zone); return { e: u.easting, n: northingIn(u, p.lat, hemisphere) }; });
  const minE = Math.min(...utm.map((u) => u.e)) - EDGE_MARGIN_M;
  const maxE = Math.max(...utm.map((u) => u.e)) + EDGE_MARGIN_M;
  const minN = Math.min(...utm.map((u) => u.n)) - EDGE_MARGIN_M;
  const maxN = Math.max(...utm.map((u) => u.n)) + EDGE_MARGIN_M;
  const area = mapArea(paper, orientation);
  const tileM = { w: (area.w * scale) / 1000, h: (area.h * scale) / 1000 };
  const cols = Math.max(1, Math.ceil((maxE - minE) / tileM.w));
  const rows = Math.max(1, Math.ceil((maxN - minN) / tileM.h));
  // Centre the sheets on the COA; start on a 100 m line so edge references are round.
  const e0 = Math.floor(((minE + maxE) / 2 - (cols * tileM.w) / 2) / 100) * 100;
  const nTop = Math.ceil(((minN + maxN) / 2 + (rows * tileM.h) / 2) / 100) * 100;
  const sheets = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const n1 = nTop - row * tileM.h;
      sheets.push({ row, col, e0: e0 + col * tileM.w, e1: e0 + (col + 1) * tileM.w, n0: n1 - tileM.h, n1 });
    }
  }
  return { zone, hemisphere, area, tileM, sheets, rows, cols };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f2 = (n) => Math.round(n * 100) / 100;
const two = (n) => String(Math.floor((((n % 100000) + 100000) % 100000) / 1000)).padStart(2, '0');

/** One sheet's SVG (mm units). @returns {string} */
function sheetSvg({ coa, symbols, sheet, layout, scale, weapons }) {
  const { zone, hemisphere, area } = layout;
  const k = 1000 / scale; // mm per metre
  const mm = (p) => {
    const u = toUtmInZone(p, zone);
    return [f2((u.easting - sheet.e0) * k), f2((sheet.n1 - northingIn(u, p.lat, hemisphere)) * k)];
  };
  const out = [];
  // Registration crosses at every 1 km grid crossing, numbered along the edges.
  const firstE = Math.ceil(sheet.e0 / 1000) * 1000;
  const firstN = Math.ceil(sheet.n0 / 1000) * 1000;
  const grid = [];
  for (let e = firstE; e <= sheet.e1; e += 1000) {
    const x = f2((e - sheet.e0) * k);
    grid.push(`<text class="edge" x="${x}" y="3.2" text-anchor="middle">${two(e)}</text><text class="edge" x="${x}" y="${f2(area.h - 1)}" text-anchor="middle">${two(e)}</text>`);
    for (let n = firstN; n <= sheet.n1; n += 1000) {
      const y = f2((sheet.n1 - n) * k);
      grid.push(`<path class="cross" d="M${f2(x - 1.6)} ${y}h3.2M${x} ${f2(y - 1.6)}v3.2"/>`);
    }
  }
  for (let n = firstN; n <= sheet.n1; n += 1000) {
    const y = f2((sheet.n1 - n) * k);
    grid.push(`<text class="edge" x="1" y="${f2(y + 1)}">${two(n)}</text><text class="edge" x="${f2(area.w - 1)}" y="${f2(y + 1)}" text-anchor="end">${two(n)}</text>`);
  }
  // The full reference of the cross nearest the bottom-left corner.
  const corner = fromUtm({ zone, hemisphere, easting: firstE, northing: firstN });
  const cornerRef = toMgrs(corner, 2);
  if (cornerRef) grid.push(`<text class="ref" x="${f2((firstE - sheet.e0) * k + 2)}" y="${f2((sheet.n1 - firstN) * k - 2)}">${esc(cornerRef)}</text>`);
  out.push(`<g class="grid">${grid.join('')}</g>`);

  // Lines, areas, rings and sectors (and weapon ranges if asked), then units on top.
  const drawShape = (g, cls, extra = '') => {
    const shape = shapeOf(g.kind);
    const geo = shape === 'circle' ? sectorOutlineGeo(g.center, { radius: g.radius, bearing: 0, arc: 360 }, 3)
      : shape === 'sector' ? sectorOutlineGeo(g.center, g, 3) : g.points;
    const d = geo.map((p, i) => `${i ? 'L' : 'M'}${mm(p).join(' ')}`).join('') + (shape === 'line' ? '' : 'Z');
    const color = g.color && cls === 'weapon' ? g.color : graphicColor(g);
    const dash = g.side === 'hostile' && cls !== 'weapon' ? ' stroke-dasharray="2.4 1.4"' : '';
    const fill = shape === 'line' ? 'none' : color;
    return `<path class="${cls}" d="${d}" stroke="${color}" fill="${fill}"${dash}${extra}/>`;
  };
  const labelAt = (text, [x, y], cls = 'label', dy = 0) => `<text class="${cls}" x="${x}" y="${f2(y + dy)}" text-anchor="middle">${esc(text)}</text>`;
  if (weapons) for (const u of coa.symbols) for (const c of coverageGraphics(u)) out.push(drawShape(c, 'weapon'));
  for (const g of coa.graphics) {
    out.push(drawShape(g, 'graphic'));
    const shape = shapeOf(g.kind);
    const at = shape === 'line' ? mm(g.points[Math.floor((g.points.length - 1) / 2)]) : shape === 'area'
      ? (() => { const ps = g.points.map(mm); return [f2(ps.reduce((a, p) => a + p[0], 0) / ps.length), f2(ps.reduce((a, p) => a + p[1], 0) / ps.length)]; })()
      : mm(g.center);
    if (g.annotation && shape === 'line') out.push(labelAt(g.annotation, at, 'label note', g.label ? -5 : -1.8));
    if (g.label) out.push(labelAt(g.label, at, 'label', shape === 'line' ? -1.8 : 1));
  }
  coa.symbols.forEach((u, i) => {
    const [x, y] = mm(u.position);
    const s = symbols[i];
    if (s?.svg && s.width) {
      const f = SYMBOL_MM / s.width;
      out.push(`<image x="${f2(x - s.anchor.x * f)}" y="${f2(y - s.anchor.y * f)}" width="${f2(s.width * f)}" height="${f2(s.height * f)}" href="data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}"/>`);
    } else {
      out.push(`<circle cx="${x}" cy="${y}" r="1.2" class="dot"/>`);
    }
    const label = `${u.label || ''}${u.hvt ? ' (HVT)' : ''}`.trim();
    if (label) out.push(`<text class="label unit" x="${f2(x + SYMBOL_MM / 2 + 0.8)}" y="${f2(y + 1)}">${esc(label)}</text>`);
  });
  // The frame is drawn inside the drawing: a CSS border would squeeze it off scale.
  return `<svg class="map" xmlns="http://www.w3.org/2000/svg" width="${f2(area.w)}mm" height="${f2(area.h)}mm" viewBox="0 0 ${f2(area.w)} ${f2(area.h)}">${out.join('')}<rect class="frame" x="0.15" y="0.15" width="${f2(area.w - 0.3)}" height="${f2(area.h - 0.3)}"/></svg>`;
}

/**
 * The HTML document of an overlay.
 * @param {{ coa: object, symbols: ({ svg: string, anchor: {x,y}, width: number, height: number }|null)[], scale?: number,
 *           paper?: 'letter'|'a4', orientation?: 'landscape'|'portrait', weapons?: boolean,
 *           header: { classification, classificationColor, project, dtg }, fingerprint?: string|null }} input
 * @returns {string | null} null when the COA has nothing to print
 */
export function overlayHtml({ coa, symbols = [], scale = 50000, paper = 'letter', orientation = 'landscape', weapons = false, header, fingerprint = null }) {
  const layout = overlaySheets(coa, { scale, paper, orientation, weapons });
  if (!layout) return null;
  const { area, sheets, rows, cols, zone, hemisphere } = layout;
  const color = /^#[0-9a-f]{6}$/i.test(header.classificationColor ?? '') ? header.classificationColor : '#5b6157';
  const ink = textOn(color);
  const scaleText = `1:${scale.toLocaleString('en-GB')}`;
  const kmPer100 = scale / 10000; // 100 mm on paper, in km
  const pages = sheets.map((sheet, i) => `<section class="page">
<div class="banner">${esc(header.classification)}</div>
<div class="titles"><h1>Overlay: ${esc(coa.name)}</h1><span class="pageno">Sheet ${i + 1} of ${sheets.length}${sheets.length > 1 ? ` (row ${sheet.row + 1} of ${rows} north to south, column ${sheet.col + 1} of ${cols} west to east)` : ''}</span></div>
<div class="info"><span>Scale <b>${scaleText}</b></span><span>Grid: UTM zone ${zone}${hemisphere}, WGS 84; crosses every 1 km</span><span>Version: ${fingerprint ? `<b class="fp">${esc(fingerprint)}</b>` : '–'}</span><span>Project: ${esc(header.project)}</span><span>Printed: ${esc(header.dtg)}</span></div>
${sheetSvg({ coa, symbols, sheet, layout, scale, weapons })}
<div class="check"><svg width="104mm" height="9mm" viewBox="0 0 104 9" xmlns="http://www.w3.org/2000/svg"><path d="M2 2v5M2 4.5h100M102 2v5${Array.from({ length: 9 }, (_, j) => `M${12 + j * 10} 3.2v2.6`).join('')}" stroke="#000" stroke-width="0.3" fill="none"/><text x="2" y="9" font-size="2.2">0</text><text x="102" y="9" font-size="2.2" text-anchor="end">${kmPer100} km</text></svg>
<p><b>Print at Actual size (100 %).</b> This bar must measure exactly 100 mm (${kmPer100} km at ${scaleText}); if it does not, the overlay will not fit the map. Lay the crosses on the map's 1 km grid lines.</p></div>
<div class="banner bottom">${esc(header.classification)}</div>
</section>`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`Overlay ${scaleText} – ${coa.name}`)}</title>
<style>
@page { size: ${OVERLAY_PAPERS[paper].name === 'A4' ? 'A4' : 'letter'} ${orientation}; margin: ${MARGIN}mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 9pt/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; }
.page { width: ${f2(area.pageW - 2 * MARGIN)}mm; height: ${f2(area.pageH - 2 * MARGIN)}mm; display: flex; flex-direction: column; gap: ${GAP}mm; break-after: page; page-break-after: always; overflow: hidden; }
.page:last-child { break-after: auto; page-break-after: auto; }
.banner { background: ${color}; color: ${ink}; text-align: center; font-weight: 700; letter-spacing: .04em; height: 6mm; line-height: 6mm; flex: none; }
.banner.bottom { margin-top: auto; }
.titles { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; }
h1 { font-size: 12pt; margin: 0; }
.pageno { font-weight: 600; font-size: 8.5pt; text-align: right; }
.info { display: flex; gap: 5mm; flex-wrap: wrap; font-size: 8pt; }
.fp { font-family: ui-monospace, Consolas, monospace; }
svg.map { flex: none; display: block; box-sizing: content-box; padding: 0; border: 0; }
svg.map .frame { fill: none; stroke: #000; stroke-width: .3; }
svg.map .cross { stroke: #000; stroke-width: .25; fill: none; }
svg.map .edge { font-size: 2.4px; fill: #333; }
svg.map .ref { font-size: 2.4px; fill: #000; font-weight: 700; }
svg.map .graphic { stroke-width: .6; fill-opacity: .12; stroke-linejoin: round; }
svg.map .weapon { stroke-width: .3; fill-opacity: .05; }
svg.map .label { font-size: 2.8px; font-weight: 700; fill: #111; paint-order: stroke; stroke: #fff; stroke-width: .6; }
svg.map .label.note { font-weight: 500; }
svg.map .label.unit { text-anchor: start; }
svg.map .dot { fill: #111; }
.check { display: flex; align-items: center; gap: 4mm; flex: none; }
.check svg { flex: none; } /* never shrunk: the check is only a check at its true 104 mm */
.check p { margin: 0; font-size: 8pt; }
@media screen { body { background: #ccc; padding: 8mm; } .page { background: #fff; padding: ${MARGIN}mm; box-sizing: content-box; margin: 0 auto 8mm; box-shadow: 0 1mm 4mm rgba(0,0,0,.3); } }
</style></head>
<body>
${pages.join('\n')}
</body></html>
`;
}

function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#ffffff';
}
