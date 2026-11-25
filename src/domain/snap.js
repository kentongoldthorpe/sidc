// Snapping (Epic 3 backlog B-2, D42): where a point being drawn, dragged or placed lands. Pure
// planar geometry: the caller works in screen pixels (so the tolerance is what the eye sees) and
// converts back to the map or template space.
//
//   1. points: the nearest existing point (a unit, a line's or area's vertex, a ring's centre)
//      within the tolerance wins;
//   2. angle:  else, from the previous point of a line, the direction is rounded to the nearest
//      multiple of the angle step (15°, 45° or 90°), keeping the cursor's distance;
//   3. grid:   else the grid's nearest intersection (the caller says where that is).
// Each is optional; with none on, the cursor stays where it is.

export const ANGLE_STEPS = Object.freeze([15, 45, 90]);
export const DEFAULT_TOLERANCE = 10;

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * @param {{ x: number, y: number }} cursor in a plane (screen pixels; y may point either way)
 * @param {{ targets?: { x: number, y: number }[], tolerance?: number, from?: { x: number, y: number } | null,
 *           angleStep?: number | null, grid?: ((p: { x: number, y: number }) => { x: number, y: number }) | null }} [options]
 *   targets: existing points to snap to; from: the previous point (angle snapping needs one);
 *   angleStep: degrees, or null for no angle snapping; grid: the nearest grid intersection, or null
 * @returns {{ x: number, y: number, snap: 'point' | 'angle' | 'grid' | null, target?: number }}
 *   target: the index of the point snapped to
 */
export function snapPoint(cursor, { targets = [], tolerance = DEFAULT_TOLERANCE, from = null, angleStep = null, grid = null } = {}) {
  let best = -1;
  let bestDistance = tolerance;
  targets.forEach((t, i) => {
    const d = distance(cursor, t);
    if (d <= bestDistance) { best = i; bestDistance = d; }
  });
  if (best >= 0) return { x: targets[best].x, y: targets[best].y, snap: 'point', target: best };

  if (from && angleStep > 0) {
    const length = distance(cursor, from);
    if (length > 0) {
      const step = (angleStep * Math.PI) / 180;
      const angle = Math.round(Math.atan2(cursor.y - from.y, cursor.x - from.x) / step) * step;
      return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length, snap: 'angle' };
    }
  }

  if (grid) {
    const g = grid(cursor);
    if (g && Number.isFinite(g.x) && Number.isFinite(g.y)) return { x: g.x, y: g.y, snap: 'grid' };
  }
  return { x: cursor.x, y: cursor.y, snap: null };
}

/** The nearest multiple of `step` (for grid intersections in a space where the grid is regular). */
export const roundTo = (value, step) => Math.round(value / step) * step;

/** Automatic grid spacings in metres, the first wide enough on screen is used. */
export const AUTO_GRID_STEPS = Object.freeze([50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000]);
/** Round distances for drawn and labelled lines (so a label never reads 1.3 km for 1,250 m). */
const NICE = Object.freeze([50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000]);

/**
 * A metric grid at a scale: which spacing points snap to, which lines are drawn and which labelled.
 * With a chosen spacing, points always snap to it; when its lines would crowd, only lines at round
 * multiples of it (500 m, 1 km, 2.5 km…) are drawn, and labels go on wider round multiples. With 'auto' all three follow the zoom.
 * @param {'auto' | number} chosen metres
 * @param {number} pxPerMetre
 * @param {{ minLine?: number, minLabel?: number }} [spacing] the fewest pixels between drawn lines and labelled lines
 * @returns {{ snap: number, line: number, label: number }} metres
 */
export function gridSpacing(chosen, pxPerMetre, { minLine = 12, minLabel = 70 } = {}) {
  if (chosen === 'auto' || !(chosen > 0)) {
    const step = AUTO_GRID_STEPS.find((s) => s * pxPerMetre >= minLabel) ?? AUTO_GRID_STEPS.at(-1);
    return { snap: step, line: step, label: step };
  }
  const steps = [chosen, ...NICE.filter((n) => n > chosen && n % chosen === 0)];
  const multiple = (list, min) => list.find((n) => n * pxPerMetre >= min) ?? list.at(-1);
  const line = multiple(steps, minLine);
  return { snap: chosen, line, label: multiple(steps.filter((n) => n % line === 0), minLabel) };
}
