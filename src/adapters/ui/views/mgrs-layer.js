// MGRS grid overlay (G-1, D43): grid zone boundaries, then 100 km, 10 km, 1 km or 100 m lines as
// the zoom allows, each zone with its own grid; line labels along the bottom and left edges, the
// 100 km square names, and the MGRS reference under the cursor. Works over either base map.
// The lines come from domain/mgrs.js; this only draws them and keeps them current.
import { mgrsGridLines, nearestMgrsIntersection, gridLineLabel, toMgrs } from '../../../domain/mgrs.js';

const SPACINGS = [100, 1000, 10000, 100000];
const MIN_PX = 30; // the closest grid lines are drawn
const SQUARE_LABEL_PX = 150; // 100 km squares are named when at least this wide; else the grid zones are
const EDGE = 40;   // keep labels clear of the map's edges and controls

/** Metres per screen pixel at the centre of the view. */
const metresPerPixel = (map) => (156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();

/**
 * @param {object} L Leaflet
 * @returns {{ layer: object, spacing(map): number | null, snap(latlng): object | null, readout: { add(map), remove() } }}
 */
export function createMgrsLayer(L) {
  const group = L.layerGroup();
  let map = null;
  let labels = null;
  let readoutEl = null;

  /** The spacing drawn (and snapped to) at this zoom; null when even 100 km lines would crowd. */
  const spacing = (m = map) => (m ? SPACINGS.find((s) => s / metresPerPixel(m) >= MIN_PX) ?? null : null);

  function draw() {
    if (!map) return;
    group.clearLayers();
    const b = map.getBounds();
    const box = { south: Math.max(-80, b.getSouth()), north: Math.min(84, b.getNorth()), west: b.getWest(), east: b.getEast() };
    if (box.south >= box.north) { labels.replaceChildren(); return; }
    const step = spacing();
    const { zones, lines, squares } = mgrsGridLines(box, step);
    const ll = (p) => [p.lat, p.lng];
    // Grid zone boundaries: the meridians cut to the view, and the band parallels only where they are in it.
    const zoneLine = (points) => L.polyline(points, { className: 'mgrs-zone-line', interactive: false, weight: 2 }).addTo(group);
    for (const z of zones) {
      const s0 = Math.max(z.south, box.south);
      const n0 = Math.min(z.north, box.north);
      zoneLine([[s0, z.west], [n0, z.west]]);
      for (const lat of [z.south, z.north]) if (lat > box.south && lat < box.north) zoneLine([[lat, z.west], [lat, z.east]]);
    }
    for (const line of lines) {
      const major = step < 100000 && line.value % (step * 10) === 0;
      L.polyline(line.points.map(ll), { className: `mgrs-grid-line${major ? ' is-major' : ''}`, interactive: false, weight: major ? 1.5 : 1 }).addTo(group);
    }
    // Labels: each easting line where it is lowest on the screen, each northing line where it is leftmost.
    const size = map.getSize();
    const out = [];
    const seen = new Set();
    if (step && step < 100000) {
      const bottom = size.y - 28;
      const left = EDGE + 8;
      for (const line of lines) {
        const pts = line.points.map((p) => map.latLngToContainerPoint(p));
        // Where the line crosses the bottom edge (eastings) or the left edge (northings).
        const axis = line.axis === 'e' ? 'y' : 'x';
        const target = line.axis === 'e' ? bottom : left;
        let at = null;
        for (let i = 1; i < pts.length && !at; i++) {
          const [a, b2] = [pts[i - 1], pts[i]];
          if ((a[axis] - target) * (b2[axis] - target) <= 0 && a[axis] !== b2[axis]) {
            const t = (target - a[axis]) / (b2[axis] - a[axis]);
            at = { x: a.x + (b2.x - a.x) * t, y: a.y + (b2.y - a.y) * t };
          }
        }
        if (!at || at.x < EDGE || at.x > size.x - 150 || at.y < EDGE || at.y > size.y - 20) continue;
        const key = `${line.axis}${Math.round(at.x / 30)},${Math.round(at.y / 30)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([`mgrs-label mgrs-label-${line.axis}`, gridLineLabel(line.value, step), at.x, at.y]);
      }
    }
    const inView = (p) => p.x > EDGE && p.x < size.x - EDGE && p.y > EDGE && p.y < size.y - EDGE;
    const namesSquares = 100000 / metresPerPixel(map) >= SQUARE_LABEL_PX;
    if (namesSquares) {
      for (const sq of squares) {
        const p = map.latLngToContainerPoint(sq.center);
        if (inView(p)) out.push(['mgrs-square', `${sq.zone}${sq.band} ${sq.id}`, p.x, p.y]);
      }
    } else {
      for (const z of zones) {
        const p = map.latLngToContainerPoint([(Math.max(z.south, box.south) + Math.min(z.north, box.north)) / 2, (z.west + z.east) / 2]);
        if (inView(p)) out.push(['mgrs-zone', `${z.zone}${z.band}`, p.x, p.y]);
      }
    }
    // A label that would sit on one already placed is left out.
    const placed = [];
    const clear = ([, text, x, y]) => {
      const w = text.length * 7 + 8;
      if (placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < 16)) return false;
      placed.push({ x, y, w });
      return true;
    };
    labels.replaceChildren(...out.filter(clear).map(([cls, text, x, y]) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      span.style.left = `${Math.round(x)}px`;
      span.style.top = `${Math.round(y)}px`;
      return span;
    }));
  }

  const onMouseMove = (e) => {
    if (!readoutEl) return;
    const mpp = metresPerPixel(map);
    const digits = mpp < 1 ? 5 : mpp < 10 ? 4 : mpp < 100 ? 3 : 2;
    readoutEl.textContent = toMgrs(e.latlng, digits) ?? 'Outside MGRS (polar)';
  };
  const onMouseOut = () => { if (readoutEl) readoutEl.textContent = ''; };

  const Layer = L.Layer.extend({
    onAdd(m) {
      map = m;
      group.addTo(m);
      labels = L.DomUtil.create('div', 'mgrs-labels', m.getContainer());
      const readout = L.control({ position: 'bottomright' });
      readout.onAdd = () => {
        readoutEl = L.DomUtil.create('div', 'mgrs-readout');
        readoutEl.dataset.mgrsReadout = '';
        readoutEl.setAttribute('aria-live', 'off');
        readoutEl.title = 'MGRS reference under the pointer';
        return readoutEl;
      };
      readout.addTo(m);
      this._readout = readout;
      m.on('moveend zoomend resize', draw);
      m.on('mousemove', onMouseMove);
      m.on('mouseout', onMouseOut);
      draw();
    },
    onRemove(m) {
      m.off('moveend zoomend resize', draw);
      m.off('mousemove', onMouseMove);
      m.off('mouseout', onMouseOut);
      group.remove();
      labels?.remove();
      this._readout?.remove();
      labels = null;
      readoutEl = null;
      map = null;
    },
  });
  const layer = new Layer();

  return {
    layer,
    isOn: () => map !== null,
    spacing: () => spacing(),
    /** The nearest crossing of the lines shown, or null (off, or zoomed too far out). */
    snap: (latlng) => (map && spacing() ? nearestMgrsIntersection(latlng, spacing()) : null),
  };
}
