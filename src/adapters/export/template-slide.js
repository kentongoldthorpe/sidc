// Template slide (Epic 3 T-7): a threat model's formation or one threat COA's play as a PNG slide.
// Pure layout → the same display list map slides use (painted by paint-slide.js).
//
//   ┌──────────────────────── classification banner ────────────────────────┐
//   │ MRB in the attack · COA 1 Penetration (MLCOA)                 DTG …   │
//   ├──────────────────────────────────────────────┬────────────────────────┤
//   │ ↑ Direction of attack                        │ COA statement          │
//   │   metric grid, the play to scale: starts     │ WHO  …                 │
//   │   faded, moves, ends, weapon ranges, lines,  │ WHAT …                 │
//   │   HVT badges                                 │ …                      │
//   │                     Frontage · Depth  ▭ 5 km │ END STATE …  · Units   │
//   └──────────────────────── classification banner ────────────────────────┘
import { gridSpacing } from '../../domain/snap.js';
import { SLIDE_SIZES, COLORS, bands, slideChrome, halfway } from './slide-layout.js';
import { withAlpha } from './colors.js';
import { graphicColor, shapeOf } from '../../domain/graphic.js';
import { coverageGraphics } from '../../domain/weapon.js';
import { sectorOutline, pointAt, formationExtent } from '../../domain/template-geometry.js';
import { STATEMENT_PARTS } from '../../domain/threat-model.js';

const HVT_COLOR = '#c8102e';
const RANK_TEXT = Object.freeze({ mostLikely: 'Most likely COA (MLCOA)', mostDangerous: 'Most dangerous COA (MDCOA)', other: 'Threat COA' });
const RANK_BADGE = Object.freeze({ mostLikely: 'MLCOA', mostDangerous: 'MDCOA', other: '' });
/** "850 m" or "1.6 km" */
const distanceText = (m) => (m < 1000 ? `${Math.round(m)} m` : `${Number((m / 1000).toFixed(1))} km`);
const ring = (center, radius) => Array.from({ length: 96 }, (_, i) => pointAt(center, (i * 360) / 96, radius));

/** Split text into lines of at most `chars` characters, at spaces (a long word is cut). */
export function wrapText(text, chars) {
  const lines = [];
  for (const paragraph of String(text).split(/\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      for (let w = word; w.length; w = w.slice(chars)) {
        const piece = w.slice(0, chars);
        if (!line) line = piece;
        else if (line.length + 1 + piece.length <= chars) line += ` ${piece}`;
        else { lines.push(line); line = piece; }
        if (w.length <= chars) break;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The play shown: { title, rank, template, statement?, endState?, description? }, or null. */
export function playOf(model, play) {
  if (play === 'formation') return { title: `${model.name} · Formation`, rank: null, template: model.formation, description: model.description };
  const coa = model.coas.find((c) => c.id === play);
  if (!coa) return null;
  const badge = RANK_BADGE[coa.rank];
  return { title: `${model.name} · ${coa.name}${badge ? ` (${badge})` : ''}`, rank: coa.rank, template: coa.template, statement: coa.statement, endState: coa.endState };
}

/**
 * @param {{ model: object, play: 'formation' | string, aspect?: '16:9'|'4:3'|'5:4', marking: { text, color }, dtg: string,
 *           symbols: { svg, width, height, anchor }[] }} input  symbols: one rendered symbol per unit of the play, in order
 * @returns {{ width, height, area: { x, y, w, h }, metresPerPixel: number, items: object[] } | null} null when the play does not exist
 */
export function layoutTemplateSlide({ model, play, aspect = '16:9', marking, dtg, symbols, gridStep = 'auto' }) {
  const shown = playOf(model, play);
  if (!shown) return null;
  const { template } = shown;
  const [W, H] = SLIDE_SIZES[aspect];
  const { k, bannerH, headerH } = bands(H);
  const items = slideChrome({ W, H, marking, title: shown.title, dtg });

  // ---- layout: the drawing on the left, the statement on the right ----
  const body = { y: bannerH + headerH, h: H - 2 * bannerH - headerH };
  const panelW = Math.round(W * 0.3);
  const area = { x: 0, y: body.y, w: W - panelW, h: body.h };
  const panel = { x: area.w, y: body.y, w: panelW, h: body.h };
  items.push({ kind: 'rect', role: 'template-area', x: area.x, y: area.y, w: area.w, h: area.h, fill: COLORS.map });

  // ---- fit the play: every unit (start and end), weapon range, line and the reference point ----
  const at = (u) => (u.end ? { x: u.end.x, y: u.end.y } : { x: u.x, y: u.y });
  const ranges = template.units.flatMap((u) => coverageGraphics({ ...u, position: at(u) }));
  const outlineOf = (g) => (shapeOf(g.kind) === 'circle' ? ring(g.center, g.radius) : shapeOf(g.kind) === 'sector' ? sectorOutline(g.center, g) : g.points);
  const pts = [{ x: 0, y: 0 }, ...template.units.flatMap((u) => [{ x: u.x, y: u.y }, ...(u.end ? [u.end] : [])]),
    ...ranges.flatMap(outlineOf), ...template.graphics.flatMap(outlineOf)];
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const margin = 70 * k;
  const scale = Math.min((area.w - 2 * margin) / Math.max(maxX - minX, 500), (area.h - 2 * margin) / Math.max(maxY - minY, 500)); // px per metre
  const midX = (minX + maxX) / 2; const midY = (minY + maxY) / 2;
  const toSlide = (p) => ({ x: area.x + area.w / 2 + (p.x - midX) * scale, y: area.y + area.h / 2 - (p.y - midY) * scale });
  const toMetres = (sx, sy) => ({ x: midX + (sx - area.x - area.w / 2) / scale, y: midY - (sy - area.y - area.h / 2) / scale });

  // Boxes that sit over the drawing: grid labels under them are left out.
  const attackBox = { x: area.x + 16 * k, y: area.y + 16 * k, w: 280 * k, h: 40 * k };
  const scaleBox = { x: area.x + area.w * 0.45, y: area.y + area.h - 70 * k, w: area.w * 0.55, h: 70 * k };
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const textBox = (t) => {
    const w = t.text.length * t.size * 0.56;
    const x = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
    return { x, y: t.y - t.size * 0.6, w, h: t.size * 1.2 };
  };
  const free = (t) => ![attackBox, scaleBox].some((b) => overlaps(textBox(t), b));

  items.push({ kind: 'clip-start', x: area.x, y: area.y, w: area.w, h: area.h });
  // Metric grid, with the axes through the reference point drawn darker.
  // The grid spacing chosen on the canvas (B-2), or one that suits the scale; labels on wider multiples when lines crowd.
  const { line: step, label: labelStep } = gridSpacing(gridStep, scale, { minLine: 40 * k, minLabel: 110 * k });
  const labelled = (v) => v !== 0 && Math.abs(Math.round(v / labelStep) * labelStep - v) < 1e-6;
  const tl = toMetres(area.x, area.y); const br = toMetres(area.x + area.w, area.y + area.h);
  const label = { size: 15 * k, weight: 400, color: COLORS.muted };
  for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
    const sx = toSlide({ x, y: 0 }).x;
    items.push({ kind: 'line', role: x === 0 ? 'grid-axis' : 'grid', x1: sx, y1: area.y, x2: sx, y2: area.y + area.h, color: x === 0 ? COLORS.muted : COLORS.grid, width: x === 0 ? 1.5 : 1 });
    const t = { kind: 'text', role: 'grid-label', x: sx + 4 * k, y: area.y + area.h - 12 * k, text: distanceText(Math.abs(x)), align: 'left', ...label };
    if (labelled(x) && free(t)) items.push(t);
  }
  for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
    const sy = toSlide({ x: 0, y }).y;
    items.push({ kind: 'line', role: y === 0 ? 'grid-axis' : 'grid', x1: area.x, y1: sy, x2: area.x + area.w, y2: sy, color: y === 0 ? COLORS.muted : COLORS.grid, width: y === 0 ? 1.5 : 1 });
    const t = { kind: 'text', role: 'grid-label', x: area.x + 8 * k, y: sy - 11 * k, text: `${y > 0 ? '+' : '−'}${distanceText(Math.abs(y))}`, align: 'left', ...label };
    if (labelled(y) && free(t)) items.push(t);
  }

  // Weapon ranges (under), then the template's lines and areas, then moves, then units.
  const pathOf = (g, role, width, fillAlpha) => {
    const shape = shapeOf(g.kind);
    const color = graphicColor(g);
    return {
      kind: 'path', role, id: g.id, points: outlineOf(g).map(toSlide), closed: shape !== 'line', color, width: width * k,
      dash: g.side === 'hostile' && role === 'graphic' ? [18 * k, 10 * k] : null, fill: shape === 'line' ? null : withAlpha(color, fillAlpha),
    };
  };
  const labels = [];
  // A label that would overlap one already placed is left out (several units often carry the same weapon).
  // Each label tries its places in turn and takes the first that is free.
  const labelAt = (g, ...places) => labelTextAt(g, { role: 'graphic-label', text: g.label, size: 18 * k, weight: 700 }, ...places);
  const labelTextAt = (g, style, ...places) => {
    for (const p of places) {
      const t = { kind: 'text', id: g.id, x: p.x, y: p.y, color: COLORS.text, align: 'center', halo: '#ffffff', ...style };
      if (!labels.some((l) => overlaps(textBox(l), textBox(t))) && free(t)) { labels.push(t); return; }
    }
  };
  for (const g of ranges) {
    items.push(pathOf(g, 'unit-coverage', 2.5, 0.08));
    const places = g.kind === 'rangeRing' ? [0, 90, 180, 270].map((b) => pointAt(g.center, b, g.radius)) : [0.66, 0.9, 0.45].map((f) => pointAt(g.center, g.bearing, g.radius * f));
    labelAt(g, ...places.map(toSlide));
  }
  for (const g of template.graphics) {
    items.push(pathOf(g, 'graphic', 4, 0.1));
    if (g.kind === 'axisOfAdvance') items.push(...arrowhead(g.points.slice(-2).map(toSlide), graphicColor(g), k, 'graphic-arrow'));
    if (g.label) {
      const shape = shapeOf(g.kind);
      const pts2 = outlineOf(g).map(toSlide);
      labelAt(g, shape === 'line' ? (({ x, y }) => ({ x, y: y - 18 * k }))(halfway(pts2)) : shape === 'circle' ? toSlide({ x: g.center.x, y: g.center.y + g.radius })
        : { x: pts2.reduce((a, p) => a + p.x, 0) / pts2.length, y: pts2.reduce((a, p) => a + p.y, 0) / pts2.length });
    }
    if (g.annotation && shapeOf(g.kind) === 'line') { // above the name
      const mid = halfway(outlineOf(g).map(toSlide));
      labelTextAt(g, { role: 'graphic-annotation', text: g.annotation, size: 16 * k, weight: 500 }, { x: mid.x, y: mid.y - (g.label ? 40 : 18) * k });
    }
  }
  items.push(...labels);
  template.units.forEach((u) => {
    if (!u.end) return;
    const [a, b] = [toSlide(u), toSlide(u.end)];
    items.push({ kind: 'path', role: 'move', id: u.id, points: [a, b], closed: false, color: COLORS.muted, width: 2.5 * k, dash: [12 * k, 8 * k], fill: null });
    items.push(...arrowhead([a, b], COLORS.muted, k, 'move-arrow', u.id));
  });
  template.units.forEach((u, i) => {
    const sym = symbols[i];
    if (u.end) { const s = toSlide(u); items.push({ kind: 'image', role: 'unit-start', id: u.id, x: s.x - sym.anchor.x, y: s.y - sym.anchor.y, w: sym.width, h: sym.height, svg: sym.svg, alpha: 0.35 }); }
    const p = toSlide(at(u));
    items.push({ kind: 'image', role: 'unit', id: u.id, x: p.x - sym.anchor.x, y: p.y - sym.anchor.y, w: sym.width, h: sym.height, svg: sym.svg });
    if (u.hvt) {
      const bw = 50 * k; const bh = 22 * k; const by = p.y - sym.anchor.y + sym.height + 4 * k;
      items.push({ kind: 'rect', role: 'hvt-badge', id: u.id, x: p.x - bw / 2, y: by, w: bw, h: bh, fill: HVT_COLOR });
      items.push({ kind: 'text', role: 'hvt-text', id: u.id, x: p.x, y: by + bh / 2, text: 'HVT', size: 16 * k, weight: 700, color: '#ffffff', align: 'center' });
    }
  });
  // The reference point.
  items.push({ kind: 'path', role: 'reference-point', points: ring({ x: 0, y: 0 }, 7 * k / scale).map(toSlide), closed: true, color: COLORS.text, width: 2 * k, dash: null, fill: null });
  items.push({ kind: 'clip-end' });

  // Direction of attack (top left), extent and scale bar (bottom right of the drawing).
  items.push({ kind: 'rect', role: 'attack-box', ...attackBox, fill: 'rgba(255, 255, 255, 0.85)', stroke: COLORS.border });
  items.push({ kind: 'text', role: 'attack', x: area.x + 30 * k, y: area.y + 36 * k, text: '↑ Direction of attack', size: 21 * k, weight: 700, color: COLORS.text, align: 'left' });
  const barMetres = [100, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000].filter((m) => m * scale <= area.w * 0.22).at(-1) ?? 100;
  const barW = barMetres * scale;
  const barX = area.x + area.w - 24 * k - barW; const barY = area.y + area.h - 34 * k;
  items.push({ kind: 'rect', role: 'scale-box', x: barX - 12 * k, y: barY - 34 * k, w: barW + 24 * k, h: 56 * k, fill: 'rgba(255, 255, 255, 0.85)' });
  items.push({ kind: 'line', role: 'scale-bar', x1: barX, y1: barY, x2: barX + barW, y2: barY, color: COLORS.text, width: 4 * k });
  for (const x of [barX, barX + barW]) items.push({ kind: 'line', role: 'scale-tick', x1: x, y1: barY - 8 * k, x2: x, y2: barY + 8 * k, color: COLORS.text, width: 2 * k });
  items.push({ kind: 'text', role: 'scale-text', x: barX + barW / 2, y: barY - 18 * k, text: distanceText(barMetres), size: 18 * k, weight: 700, color: COLORS.text, align: 'center' });
  if (template.units.length > 1) {
    const { frontage, depth } = formationExtent(template.units);
    items.push({ kind: 'text', role: 'extent', x: barX - 24 * k, y: barY - 4 * k, text: `Frontage ${distanceText(frontage)} · Depth ${distanceText(depth)}`, size: 18 * k, weight: 400, color: COLORS.text, align: 'right', halo: '#ffffff' });
  }

  // ---- the statement panel ----
  const inset = 28 * k;
  const textW = panel.w - 2 * inset;
  const chars = Math.max(10, Math.floor(textW / (17 * k * 0.55)));
  let y = panel.y + inset;
  const bottom = panel.y + panel.h - inset;
  const line = (text, { size = 17, weight = 400, color = COLORS.text, role = 'statement-text', gap = 1.35 } = {}) => {
    if (y + size * k > bottom) return false;
    items.push({ kind: 'text', role, x: panel.x + inset, y: y + (size * k) / 2, text, size: size * k, weight, color, align: 'left', maxWidth: textW });
    y += size * k * gap;
    return true;
  };
  const paragraph = (heading, text) => {
    if (heading && !line(heading, { size: 15, weight: 700, color: COLORS.muted, role: 'statement-heading', gap: 1.5 })) return;
    for (const l of wrapText(text, chars)) if (!line(l)) { line('…', { color: COLORS.muted }); return; }
    y += 10 * k;
  };
  line(shown.rank ? RANK_TEXT[shown.rank] : 'Doctrinal template (formation)', { size: 24, weight: 700, role: 'statement-title', gap: 1.6 });
  if (shown.statement) {
    for (const part of STATEMENT_PARTS) if (shown.statement[part]) paragraph(part.toUpperCase(), shown.statement[part]);
    if (shown.endState) paragraph('END STATE', shown.endState);
  } else if (shown.description) {
    paragraph(null, shown.description);
  }
  // Units: label, HVT and weapons in a compact list, as space allows.
  if (template.units.length && y + 60 * k < bottom) {
    y += 6 * k;
    line('UNITS', { size: 15, weight: 700, color: COLORS.muted, role: 'statement-heading', gap: 1.5 });
    for (const u of template.units) {
      const weapons = (u.weapons ?? []).map((w) => `${w.name} ${distanceText(w.maxRange)}`).join(', ');
      const text = `${u.label || u.sidc}${u.hvt ? ' (HVT)' : ''}${weapons ? `: ${weapons}` : ''}`;
      if (!line(text, { size: 16, role: 'unit-line', gap: 1.4 })) break;
    }
  }

  return { width: W, height: H, area, metresPerPixel: 1 / scale, items };
}

function arrowhead([prev, end], color, k, role, id) {
  const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  const u = { x: (end.x - prev.x) / len, y: (end.y - prev.y) / len };
  const base = { x: end.x - u.x * 26 * k, y: end.y - u.y * 26 * k };
  const half = 11 * k;
  return [{ kind: 'path', role, ...(id ? { id } : {}), closed: true, color, width: 1, dash: null, fill: color,
    points: [end, { x: base.x - u.y * half, y: base.y + u.x * half }, { x: base.x + u.y * half, y: base.y - u.x * half }] }];
}
