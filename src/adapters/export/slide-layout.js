// Slide layout: COA + frame + marking + DTG + rendered symbols → a display list of plain drawing
// items in slide pixels. Pure (no DOM): the display list is the boundary to the painters (PNG now;
// SVG / .pptx later can reuse it).
//
//   ┌────────────────────── classification banner ──────────────────────┐
//   │ COA name                                                DTG …     │
//   │ ┌──────────────── map (frame fitted, grid, units) ─────┐ Legend   │
//   │ │                                                      │ ▭ A/1-5  │
//   │ └──────────────────────────────────────────────────────┘ ▭ …      │
//   └────────────────────── classification banner ──────────────────────┘
import { ASPECTS } from '../../domain/frame.js';
import { textColorOn } from './colors.js';

export const SLIDE_SIZES = Object.freeze({ '16:9': [1920, 1080], '4:3': [1600, 1200], '5:4': [1500, 1200] });

const COLORS = Object.freeze({ background: '#ffffff', text: '#1c1f1a', muted: '#5b6157', map: '#e6e8e1', grid: '#c4c8bf', border: '#a9ada3' });
const GRID_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
const GRID_SPACING_PX = 140;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "230215ZNOV26": day, hour, minute, Z (UTC), month, two-digit year. */
export function formatDtg(iso) {
  const d = new Date(iso);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}Z${MONTHS[d.getUTCMonth()]}${two(d.getUTCFullYear() % 100)}`;
}

/** "coa-1-envelopment_230215ZNOV26.png" */
export function slideFileName(name, dtg) {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'coa'}_${dtg}.png`;
}

// ---- Web Mercator in "world pixels" for a world `size` px wide ----
const mercX = (lng, size) => ((lng + 180) / 360) * size;
const mercY = (lat, size) => {
  const phi = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * size;
};
const lngAt = (x, size) => (x / size) * 360 - 180;
const latAt = (y, size) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;

const decimalsFor = (step) => (step >= 1 ? 0 : String(step).split('.')[1].length);
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
const degrees = (value, step, positive, negative) => {
  const text = Math.abs(value).toFixed(decimalsFor(step));
  return Number(text) === 0 ? `${text}°` : `${text}°${value > 0 ? positive : negative}`;
};
const linesBetween = (from, to, step) => {
  const out = [];
  for (let i = Math.ceil(from / step); i * step <= to; i++) out.push(Number((i * step).toFixed(6)));
  return out;
};

/**
 * @param {{ coa: { name: string, symbols: object[] }, frame: object, marking: { text: string, color: string },
 *           dtg: string, symbols: { svg: string, width: number, height: number, anchor: {x:number, y:number} }[],
 *           legendSymbols?: object[] }} input
 *   symbols: the rendered symbol for each of coa.symbols, in the same order (drawn on the map).
 *   legendSymbols: the same without label/modifier text, for the legend (defaults to symbols).
 * @returns {{ width: number, height: number, frameBox: object, items: object[] }}
 */
export function layoutSlide({ coa, frame, marking, dtg, symbols, legendSymbols = symbols }) {
  const [W, H] = SLIDE_SIZES[frame.aspect];
  const k = H / 1080; // scale for type and spacing
  const pad = 32 * k;
  const bannerH = Math.round(36 * k);
  const titleH = Math.round(84 * k);
  const items = [];

  // Background and classification banners.
  items.push({ kind: 'rect', role: 'background', x: 0, y: 0, w: W, h: H, fill: COLORS.background });
  const bannerText = textColorOn(marking.color);
  for (const [role, y] of [['banner-top', 0], ['banner-bottom', H - bannerH]]) {
    items.push({ kind: 'rect', role, x: 0, y, w: W, h: bannerH, fill: marking.color });
    items.push({ kind: 'text', role: 'banner-text', x: W / 2, y: y + bannerH / 2, text: marking.text, size: 22 * k, weight: 700, color: bannerText, align: 'center' });
  }

  // Title block.
  const titleY = bannerH + titleH / 2;
  items.push({ kind: 'text', role: 'title', x: pad, y: titleY, text: coa.name, size: 40 * k, weight: 700, color: COLORS.text, align: 'left', maxWidth: W - 2 * pad - 420 * k });
  items.push({ kind: 'text', role: 'dtg', x: W - pad, y: titleY, text: `DTG ${dtg}`, size: 26 * k, weight: 400, color: COLORS.muted, align: 'right' });

  // Body: map on the left, legend on the right.
  const top = bannerH + titleH;
  const bodyH = H - bannerH - pad - top;
  const legendW = Math.round(W * 0.2);
  const map = { x: pad, y: top, w: W - legendW - 3 * pad, h: bodyH };
  const legend = { x: W - pad - legendW, y: top, w: legendW, h: bodyH };

  // ---- map: fit the frame (keeps its shape), extra space shows the surroundings ----
  const ratio = ASPECTS[frame.aspect];
  // Fit by whichever side is limiting. (At today's three slide sizes the map area is narrower than
  // the frame, so the width decides; the height term keeps the fit right if the layout changes.)
  const frameW = Math.min(map.w, map.h * ratio);
  const world = (frameW * 360) / frame.width;
  const cx = mercX(frame.center.lng, world);
  const cy = mercY(frame.center.lat, world);
  const mapCx = map.x + map.w / 2;
  const mapCy = map.y + map.h / 2;
  const toSlide = (lat, lng) => {
    let dx = mercX(lng, world) - cx;
    if (dx > world / 2) dx -= world; else if (dx < -world / 2) dx += world; // across the date line
    return { x: mapCx + dx, y: mapCy + (mercY(lat, world) - cy) };
  };

  items.push({ kind: 'rect', role: 'map-area', x: map.x, y: map.y, w: map.w, h: map.h, fill: COLORS.map, stroke: COLORS.border });
  items.push({ kind: 'clip-start', x: map.x, y: map.y, w: map.w, h: map.h });

  // Grid: lines and edge labels.
  const step = GRID_STEPS.find((s) => s >= (360 / world) * GRID_SPACING_PX) ?? 30;
  const west = lngAt(cx - map.w / 2, world);
  const east = lngAt(cx + map.w / 2, world);
  const north = latAt(cy - map.h / 2, world);
  const south = latAt(cy + map.h / 2, world);
  const labelSize = 16 * k;
  // A label is only drawn if it fits inside the map area (no half-cut "117.10°V" at the edge).
  const fits = (x, y, text) => x + text.length * labelSize * 0.62 <= map.x + map.w && y - labelSize / 2 >= map.y;
  for (const lng of linesBetween(west, east, step)) {
    const { x } = toSlide(frame.center.lat, lng);
    items.push({ kind: 'line', role: 'grid', x1: x, y1: map.y, x2: x, y2: map.y + map.h, color: COLORS.grid, width: 1 });
    const label = { x: x + 4 * k, y: map.y + map.h - 10 * k, text: degrees(wrapLng(lng), step, 'E', 'W') };
    if (fits(label.x, label.y, label.text)) items.push({ kind: 'text', role: 'grid-label', ...label, size: labelSize, weight: 400, color: COLORS.muted, align: 'left' });
  }
  for (const lat of linesBetween(south, north, step)) {
    const { y } = toSlide(lat, frame.center.lng);
    items.push({ kind: 'line', role: 'grid', x1: map.x, y1: y, x2: map.x + map.w, y2: y, color: COLORS.grid, width: 1 });
    const label = { x: map.x + 6 * k, y: y - 10 * k, text: degrees(lat, step, 'N', 'S') };
    if (fits(label.x, label.y, label.text)) items.push({ kind: 'text', role: 'grid-label', ...label, size: labelSize, weight: 400, color: COLORS.muted, align: 'left' });
  }

  // Units, pinned at the renderer's anchor; those whose position is outside the map are left out.
  coa.symbols.forEach((unit, i) => {
    const p = toSlide(unit.position.lat, unit.position.lng);
    if (p.x < map.x || p.x > map.x + map.w || p.y < map.y || p.y > map.y + map.h) return;
    const s = symbols[i];
    items.push({ kind: 'image', role: 'unit', id: unit.id, x: p.x - s.anchor.x, y: p.y - s.anchor.y, w: s.width, h: s.height, svg: s.svg });
  });
  items.push({ kind: 'clip-end' });

  // ---- legend ----
  items.push({ kind: 'rect', role: 'legend-area', x: legend.x, y: legend.y, w: legend.w, h: legend.h, fill: COLORS.background });
  items.push({ kind: 'text', role: 'legend-title', x: legend.x, y: legend.y + 18 * k, text: 'Legend', size: 26 * k, weight: 700, color: COLORS.text, align: 'left' });
  const rowH = 48 * k;
  const firstRow = legend.y + 56 * k;
  const rows = Math.max(1, Math.floor((legend.y + legend.h - firstRow) / rowH));
  const shown = coa.symbols.length > rows ? rows - 1 : coa.symbols.length;
  const box = { w: 72 * k, h: 40 * k };
  coa.symbols.slice(0, shown).forEach((unit, i) => {
    const s = legendSymbols[i];
    const y = firstRow + i * rowH;
    const scale = Math.min(box.w / s.width, box.h / s.height);
    const w = s.width * scale;
    const h = s.height * scale;
    items.push({ kind: 'image', role: 'legend-symbol', id: unit.id, x: legend.x + (box.w - w) / 2, y: y + (box.h - h) / 2, w, h, svg: s.svg });
    items.push({ kind: 'text', role: 'legend-label', x: legend.x + box.w + 12 * k, y: y + box.h / 2, text: unit.label || unit.sidc, size: 20 * k, weight: 400, color: COLORS.text, align: 'left', maxWidth: legend.w - box.w - 12 * k });
  });
  if (shown < coa.symbols.length) {
    items.push({ kind: 'text', role: 'legend-more', x: legend.x, y: firstRow + shown * rowH + box.h / 2, text: `+${coa.symbols.length - shown} more`, size: 20 * k, weight: 400, color: COLORS.muted, align: 'left' });
  }

  return { width: W, height: H, frameBox: { x: mapCx - frameW / 2, y: mapCy - frameW / ratio / 2, w: frameW, h: frameW / ratio }, items };
}
