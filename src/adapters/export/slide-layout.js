// Slide layout: COA + frame + marking + DTG + rendered symbols → a display list of plain drawing
// items in slide pixels. Pure (no DOM): the display list is the boundary to the painters (PNG now;
// SVG / .pptx later can reuse it).
//
//   ┌────────────────────── classification banner ──────────────────────┐
//   │ COA name                                                DTG …     │  ← metadata strip on top
//   ├───────────────────────────────────────────────────────┬──────────┤
//   │ map: full width, edge to edge; the frame fills it     │ Legend   │  ← legend box over the corner
//   │ exactly (grid, units)                                 │ ▭ A/1-5  │    that hides the fewest units
//   │                                                       └──────────┤
//   └────────────────────── classification banner ──────────────────────┘
import { textColorOn, withAlpha } from './colors.js';
import { graphicColor, shapeOf } from '../../domain/graphic.js';
import { sectorOutlineGeo, destination } from '../../domain/geodesy.js';
import { coverageGraphics } from '../../domain/weapon.js';

const HVT_COLOR = '#c8102e';
import { wrapLng } from '../../shared/values.js';

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

/** "coa-1-envelopment_230215ZNOV26.png" (or another extension, for data files) */
export function slideFileName(name, dtg, extension = 'png') {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'coa'}_${dtg}.${extension}`;
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
const degrees = (value, step, positive, negative) => {
  const text = Math.abs(value).toFixed(decimalsFor(step));
  return Number(text) === 0 ? `${text}°` : `${text}°${value > 0 ? positive : negative}`;
};
const linesBetween = (from, to, step) => {
  const out = [];
  for (let i = Math.ceil(from / step); i * step <= to; i++) out.push(Number((i * step).toFixed(6)));
  return out;
};

// ---- graphics ----
/** The point halfway along a polyline (by length). */
function halfway(points) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : left / lengths[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    left -= lengths[i];
  }
  return points[0];
}

/**
 * Display items for one graphic: its path, an arrowhead for an axis of advance, and its label.
 * @returns {{ shapes: object[], labels: object[] }}
 */
function graphicItems(graphic, toSlide, k, inMap, { weapon = false } = {}) {
  const shape = shapeOf(graphic.kind);
  const color = graphicColor(graphic);
  const geo = shape === 'circle' ? sectorOutlineGeo(graphic.center, { radius: graphic.radius, bearing: 0, arc: 360 }, 3.75) // a geodesic circle
    : shape === 'sector' ? sectorOutlineGeo(graphic.center, graphic)
      : graphic.points;
  const points = geo.map((p) => toSlide(p.lat, p.lng));
  const closed = shape !== 'line';
  const shapes = [{
    kind: 'path', role: weapon ? 'unit-coverage' : 'graphic', id: graphic.id, points, closed, color, width: (weapon ? 2.5 : 5) * k,
    dash: graphic.side === 'hostile' ? [18 * k, 10 * k] : null,
    fill: shape === 'area' || shape === 'sector' ? withAlpha(color, shape === 'sector' ? 0.1 : 0.12) : shape === 'circle' ? withAlpha(color, 0.05) : null,
  }];
  if (graphic.kind === 'axisOfAdvance') {
    const end = points.at(-1);
    const prev = points.at(-2);
    const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
    const u = { x: (end.x - prev.x) / len, y: (end.y - prev.y) / len };
    const length = 28 * k;
    const half = 12 * k;
    const base = { x: end.x - u.x * length, y: end.y - u.y * length };
    shapes.push({
      kind: 'path', role: 'graphic-arrow', id: graphic.id, closed: true, color, width: 1, dash: null, fill: color,
      points: [end, { x: base.x - u.y * half, y: base.y + u.x * half }, { x: base.x + u.y * half, y: base.y - u.x * half }],
    });
  }
  const labels = [];
  if (graphic.label) {
    const at = shape === 'line' ? (({ x, y }) => ({ x, y: y - 20 * k }))(halfway(points))
      : shape === 'circle' ? points.reduce((top, p) => (p.y < top.y ? p : top)) // the top edge: the centre is often a unit
        : shape === 'sector' ? (({ lat, lng }) => toSlide(lat, lng))(destination(graphic.center, graphic.bearing, graphic.radius * 0.66)) // along the centre line, clear of the weapon
        : { x: points.reduce((a, p) => a + p.x, 0) / points.length, y: points.reduce((a, p) => a + p.y, 0) / points.length };
    if (inMap(at)) labels.push({ kind: 'text', role: 'graphic-label', id: graphic.id, x: at.x, y: at.y, text: graphic.label, size: 20 * k, weight: 700, color: COLORS.text, align: 'center', halo: '#ffffff' });
  }
  return { shapes, labels };
}

/** Vertical measurements for a slide `height` px high (type and spacing scale with height). */
function bands(height) {
  const k = height / 1080;
  return { k, bannerH: Math.round(36 * k), headerH: Math.round(60 * k) };
}

/** Width ÷ height of the map area for a slide shape. The on-screen frame uses this, so it matches exactly. */
export function mapAreaRatio(aspect) {
  const [W, H] = SLIDE_SIZES[aspect];
  const { bannerH, headerH } = bands(H);
  return W / (H - 2 * bannerH - headerH);
}

/**
 * @param {{ coa: { name: string, symbols: object[], graphics: object[] }, frame: object, marking: { text: string, color: string },
 *           dtg: string, symbols: { svg: string, width: number, height: number, anchor: {x:number, y:number} }[],
 *           legendSymbols?: object[] }} input
 *   symbols: the rendered symbol for each of coa.symbols, in the same order (drawn on the map).
 *   legendSymbols: the same without label/modifier text, for the legend (defaults to symbols).
 * @returns {{ width: number, height: number, frameBox: object, items: object[] }}
 */
export function layoutSlide({ coa, frame, marking, dtg, symbols, legendSymbols = symbols }) {
  const [W, H] = SLIDE_SIZES[frame.aspect];
  const { k, bannerH, headerH } = bands(H);
  const pad = 24 * k;
  const items = [];

  // Background and classification banners.
  items.push({ kind: 'rect', role: 'background', x: 0, y: 0, w: W, h: H, fill: COLORS.background });
  const bannerText = textColorOn(marking.color);
  for (const [role, y] of [['banner-top', 0], ['banner-bottom', H - bannerH]]) {
    items.push({ kind: 'rect', role, x: 0, y, w: W, h: bannerH, fill: marking.color });
    items.push({ kind: 'text', role: 'banner-text', x: W / 2, y: y + bannerH / 2, text: marking.text, size: 22 * k, weight: 700, color: bannerText, align: 'center' });
  }

  // Metadata strip on top: title left, DTG right.
  const stripY = bannerH + headerH / 2;
  items.push({ kind: 'text', role: 'title', x: pad, y: stripY, text: coa.name, size: 34 * k, weight: 700, color: COLORS.text, align: 'left', maxWidth: W - 2 * pad - 360 * k });
  items.push({ kind: 'text', role: 'dtg', x: W - pad, y: stripY, text: `DTG ${dtg}`, size: 24 * k, weight: 400, color: COLORS.muted, align: 'right' });

  // ---- map: edge to edge between the strip and the bottom banner; the frame fills it exactly ----
  const map = { x: 0, y: bannerH + headerH, w: W, h: H - 2 * bannerH - headerH };
  const world = (map.w * 360) / frame.width;
  const cx = mercX(frame.center.lng, world);
  const cy = mercY(frame.center.lat, world);
  const mapCx = map.x + map.w / 2;
  const mapCy = map.y + map.h / 2;
  const toSlide = (lat, lng) => {
    let dx = mercX(lng, world) - cx;
    if (dx > world / 2) dx -= world; else if (dx < -world / 2) dx += world; // across the date line
    return { x: mapCx + dx, y: mapCy + (mercY(lat, world) - cy) };
  };

  items.push({ kind: 'rect', role: 'map-area', x: map.x, y: map.y, w: map.w, h: map.h, fill: COLORS.map });
  items.push({ kind: 'clip-start', x: map.x, y: map.y, w: map.w, h: map.h });

  // Grid: lines and edge labels (only labels that fit inside the map: no half-cut "117.10°V").
  const step = GRID_STEPS.find((g) => g >= (360 / world) * GRID_SPACING_PX) ?? 30;
  const west = lngAt(cx - map.w / 2, world);
  const east = lngAt(cx + map.w / 2, world);
  const north = latAt(cy - map.h / 2, world);
  const south = latAt(cy + map.h / 2, world);
  const labelSize = 16 * k;
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

  // Lines, areas and range rings: over the grid, under the units (the clip trims what sticks out).
  const inMap = (p) => p.x >= map.x && p.x <= map.x + map.w && p.y >= map.y && p.y <= map.y + map.h;
  // A unit's weapon ranges come first, thinner, so drawn lines and areas stay on top (D28).
  const ranges = coa.symbols.flatMap((u) => coverageGraphics(u)).map((g) => graphicItems(g, toSlide, k, inMap, { weapon: true }));
  const drawn = [...ranges, ...coa.graphics.map((g) => graphicItems(g, toSlide, k, inMap))];
  drawn.forEach(({ shapes }) => items.push(...shapes));
  drawn.forEach(({ labels }) => items.push(...labels));

  // Units, pinned at the renderer's anchor; those whose position is outside the map are left out.
  coa.symbols.forEach((unit, i) => {
    const p = toSlide(unit.position.lat, unit.position.lng);
    if (p.x < map.x || p.x > map.x + map.w || p.y < map.y || p.y > map.y + map.h) return;
    const sym = symbols[i];
    items.push({ kind: 'image', role: 'unit', id: unit.id, x: p.x - sym.anchor.x, y: p.y - sym.anchor.y, w: sym.width, h: sym.height, svg: sym.svg });
    if (unit.hvt) { // the HVT tag (D23) as a red badge under the symbol
      const bw = 50 * k; const bh = 22 * k; const by = p.y - sym.anchor.y + sym.height + 4 * k;
      items.push({ kind: 'rect', role: 'hvt-badge', id: unit.id, x: p.x - bw / 2, y: by, w: bw, h: bh, fill: HVT_COLOR });
      items.push({ kind: 'text', role: 'hvt-text', id: unit.id, x: p.x, y: by + bh / 2, text: 'HVT', size: 16 * k, weight: 700, color: '#ffffff', align: 'center' });
    }
  });
  items.push({ kind: 'clip-end' });

  // ---- legend: a see-through box over a corner of the map ----
  const rowH = 46 * k;
  const head = 52 * k;
  const inset = 16 * k;
  const box = { w: 64 * k, h: 36 * k };
  const legendW = Math.round(W * 0.2);
  const maxRows = Math.max(1, Math.floor((map.h * 0.7 - head - inset) / rowH));
  const shown = coa.symbols.length > maxRows ? maxRows - 1 : coa.symbols.length;
  const rows = shown + (shown < coa.symbols.length ? 1 : 0);
  const legendH = head + rows * rowH + inset / 2;
  // Use the corner that hides the fewest units (top-right preferred when it is free).
  const right = map.x + map.w - legendW - inset;
  const bottom = map.y + map.h - legendH - inset;
  const corners = [[right, map.y + inset], [map.x + inset, map.y + inset], [right, bottom], [map.x + inset, bottom]];
  const unitBoxes = items.filter((i) => i.role === 'unit');
  const hidden = ([x, y]) => unitBoxes.filter((u) => u.x < x + legendW && u.x + u.w > x && u.y < y + legendH && u.y + u.h > y).length;
  const [lx, ly] = corners.reduce((best, c) => (hidden(c) < hidden(best) ? c : best));
  const legend = { x: lx, y: ly, w: legendW, h: legendH };
  items.push({ kind: 'rect', role: 'legend-area', x: legend.x, y: legend.y, w: legend.w, h: legend.h, fill: 'rgba(255, 255, 255, 0.88)', stroke: COLORS.border });
  items.push({ kind: 'text', role: 'legend-title', x: legend.x + inset, y: legend.y + head / 2, text: 'Legend', size: 24 * k, weight: 700, color: COLORS.text, align: 'left' });
  coa.symbols.slice(0, shown).forEach((unit, i) => {
    const sym = legendSymbols[i];
    const y = legend.y + head + i * rowH;
    const scale = Math.min(box.w / sym.width, box.h / sym.height);
    const w = sym.width * scale;
    const h = sym.height * scale;
    items.push({ kind: 'image', role: 'legend-symbol', id: unit.id, x: legend.x + inset + (box.w - w) / 2, y: y + (box.h - h) / 2, w, h, svg: sym.svg });
    items.push({ kind: 'text', role: 'legend-label', x: legend.x + inset + box.w + 12 * k, y: y + box.h / 2, text: `${unit.label || unit.sidc}${unit.hvt ? ' (HVT)' : ''}`, size: 19 * k, weight: 400, color: COLORS.text, align: 'left', maxWidth: legend.w - 2 * inset - box.w - 12 * k });
  });
  if (shown < coa.symbols.length) {
    items.push({ kind: 'text', role: 'legend-more', x: legend.x + inset, y: legend.y + head + shown * rowH + box.h / 2, text: `+${coa.symbols.length - shown} more`, size: 19 * k, weight: 400, color: COLORS.muted, align: 'left' });
  }

  return { width: W, height: H, frameBox: { x: map.x, y: map.y, w: map.w, h: map.h }, items };
}
