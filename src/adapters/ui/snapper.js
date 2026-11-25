// Snapping on a Leaflet map or the template canvas (Epic 3 backlog B-2, D42).
//   createSnapSettings(prefs) – what snaps, remembered per browser and shared by the map and canvas
//   createSnapper(...)        – snaps a latlng for one map: works in screen pixels (the tolerance is
//                               what the eye sees), then gives back the exact target or grid point
// The rule itself (points, then angle, then grid) is domain/snap.js. Holding Alt places freely.
import { snapPoint, DEFAULT_TOLERANCE } from '../../domain/snap.js';

/** Template grid spacings in metres ('auto' follows the zoom). */
export const TEMPLATE_GRID_STEPS = Object.freeze([50, 100, 250, 500, 1000, 2500, 5000, 10000]);
export const SNAP_DEFAULTS = Object.freeze({ points: false, grid: false, angle: 0, templateGrid: 'auto' });
const ANGLES = new Set([0, 15, 45, 90]);

function clean(raw) {
  const v = { ...SNAP_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  return Object.freeze({
    points: v.points === true,
    grid: v.grid === true,
    angle: ANGLES.has(v.angle) ? v.angle : 0,
    templateGrid: TEMPLATE_GRID_STEPS.includes(v.templateGrid) ? v.templateGrid : 'auto',
  });
}

/** @param {{ get(key, fallback), set(key, value) }} prefs */
export function createSnapSettings(prefs) {
  let value = clean(prefs.get('snap', SNAP_DEFAULTS));
  const listeners = new Set();
  return Object.freeze({
    get: () => value,
    /** Change some settings, e.g. set({ grid: true }). */
    set(changes) {
      value = clean({ ...value, ...changes });
      prefs.set('snap', value);
      [...listeners].forEach((fn) => fn(value));
    },
    /** Is anything snapping? */
    any: () => value.points || value.grid || value.angle > 0,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  });
}

const same = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-12 && Math.abs(a.lng - b.lng) < 1e-12;

/**
 * @param {{ L: object, map: object, settings: object, targets: () => { lat: number, lng: number }[],
 *           gridAt: (latlng: { lat, lng }) => { lat: number, lng: number } | null, tolerance?: number }} options
 *   targets: the points that can be snapped to (units, vertices, centres); gridAt: the nearest grid intersection
 * @returns {{ snap(latlng, options?): { latlng: object, snap: string | null }, show(latlng, snap): void, hide(): void, destroy(): void }}
 */
export function createSnapper({ L, map, settings, targets, gridAt, tolerance = DEFAULT_TOLERANCE }) {
  let indicator = null;

  /**
   * @param {{ lat: number, lng: number }} latlng
   * @param {{ from?: object | null, exclude?: object | null, event?: Event | null, angle?: boolean }} [options]
   *   from: the previous point (for angles); exclude: a point not to snap to (the one being dragged);
   *   event: the pointer event (Alt held: no snapping); angle: false where a direction means nothing
   */
  function snap(latlng, { from = null, exclude = null, event = null, angle = true } = {}) {
    const s = settings.get();
    const plain = L.latLng(latlng.lat, latlng.lng);
    if (!settings.any() || event?.altKey) return { latlng: plain, snap: null };
    const px = (ll) => map.latLngToContainerPoint(ll);
    const list = s.points ? targets().filter((t) => !same(t, exclude)) : [];
    let gridPoint = null;
    const result = snapPoint(px(plain), {
      targets: list.map(px),
      tolerance,
      from: from && angle ? px(from) : null,
      angleStep: angle ? s.angle || null : null,
      grid: s.grid ? (p) => { gridPoint = gridAt(map.containerPointToLatLng(p)); return gridPoint ? px(gridPoint) : null; } : null,
    });
    if (result.snap === 'point') { const t = list[result.target]; return { latlng: L.latLng(t.lat, t.lng), snap: 'point' }; }
    if (result.snap === 'grid') return { latlng: L.latLng(gridPoint.lat, gridPoint.lng), snap: 'grid' };
    if (result.snap === 'angle') return { latlng: map.containerPointToLatLng(L.point(result.x, result.y)), snap: 'angle' };
    return { latlng: plain, snap: null };
  }

  /** A small ring where the point snapped (nothing when it did not). */
  function show(latlng, kind) {
    if (!kind) { hide(); return; }
    if (!indicator) indicator = L.circleMarker(latlng, { radius: 7, weight: 2, fill: false, interactive: false, className: 'snap-indicator' }).addTo(map);
    indicator.setLatLng(latlng);
    const el = indicator.getElement();
    if (el) el.setAttribute('class', `snap-indicator snap-${kind}`);
  }
  function hide() { indicator?.remove(); indicator = null; }

  return Object.freeze({ snap, show, hide, destroy: hide });
}

/** The points of a map COA that can be snapped to: units, and the vertices and centres of its lines, areas, rings and sectors. */
export function coaSnapTargets(coa) {
  if (!coa) return [];
  return [
    ...coa.symbols.map((u) => u.position),
    ...coa.graphics.flatMap((g) => (g.points ? g.points : [g.center])),
  ];
}

/** The same for a template (metres, as the canvas's latlng { lat: y, lng: x }); a unit's end too. */
export function templateSnapTargets(template) {
  if (!template) return [];
  const ll = (p) => ({ lat: p.y, lng: p.x });
  return [
    ...template.units.flatMap((u) => [ll(u), ...(u.end ? [ll(u.end)] : [])]),
    ...template.graphics.flatMap((g) => (g.points ? g.points.map(ll) : [ll(g.center)])),
  ];
}

const r9 = (n) => Number(n.toFixed(9));
/** The map's grid: the nearest intersection of the lat/long lines shown at this zoom (`stepFor` from the grid layer). */
export const latLngGrid = (map, stepFor) => (ll) => {
  const step = stepFor(map.getZoom());
  return { lat: r9(Math.round(ll.lat / step) * step), lng: r9(Math.round(ll.lng / step) * step) };
};
