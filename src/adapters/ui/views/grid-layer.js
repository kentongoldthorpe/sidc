// An offline base layer: a latitude/longitude graticule. No network needed.
// Lines are drawn on canvas tiles; labels are drawn once per line along the map's left (latitude)
// and bottom (longitude) edges in an overlay that follows panning and zooming.
import { wrapLng } from '../../../shared/values.js';

/** Degrees between grid lines for a zoom level. */
const STEPS = [30, 30, 30, 10, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];
export const stepFor = (zoom) => STEPS[Math.max(0, Math.min(STEPS.length - 1, Math.round(zoom)))];
const decimalsFor = (step) => (step >= 1 ? 0 : String(step).split('.')[1].length);

const format = (value, step, positive, negative) => {
  const text = Math.abs(value).toFixed(decimalsFor(step));
  return Number(text) === 0 ? `${text}°` : `${text}°${value > 0 ? positive : negative}`;
};

/** Grid line values in [from, to], using integer indexes to avoid floating-point drift. */
function linesBetween(from, to, step) {
  const values = [];
  for (let i = Math.ceil(from / step); i * step <= to; i++) values.push(Number((i * step).toFixed(6)));
  return values;
}

const EDGE_CLEARANCE = 96; // keep labels clear of the zoom control (top-left) and attribution (bottom-right)

/**
 * @param {object} L Leaflet
 * @param {{ lineColor?: string, labelColor?: string }} [colors]
 */
export function createGridLayer(L, { lineColor = '#a9ada3', labelColor = '#5b6157' } = {}) {
  const Graticule = L.GridLayer.extend({
    createTile(coords) {
      const tile = document.createElement('canvas');
      const size = this.getTileSize();
      const ratio = window.devicePixelRatio || 1;
      tile.width = size.x * ratio;
      tile.height = size.y * ratio;
      const ctx = tile.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;

      const map = this._map;
      const zoom = coords.z;
      const topLeft = coords.scaleBy(size);
      const nw = map.unproject(topLeft, zoom);
      const se = map.unproject(topLeft.add(size), zoom);
      const step = stepFor(zoom);
      for (const lng of linesBetween(nw.lng, se.lng, step)) {
        const x = Math.round(map.project([0, lng], zoom).x - topLeft.x) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.y); ctx.stroke();
      }
      for (const lat of linesBetween(se.lat, nw.lat, step)) {
        const y = Math.round(map.project([lat, 0], zoom).y - topLeft.y) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.x, y); ctx.stroke();
      }
      return tile;
    },

    onAdd(map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      this._labels = L.DomUtil.create('div', 'grid-labels', map.getContainer());
      this._labels.style.color = labelColor;
      map.on('move zoom resize', this._drawLabels, this);
      this._drawLabels();
    },

    onRemove(map) {
      map.off('move zoom resize', this._drawLabels, this);
      this._labels?.remove();
      this._labels = null;
      L.GridLayer.prototype.onRemove.call(this, map);
    },

    _drawLabels() {
      const map = this._map;
      if (!map || !this._labels) return;
      const size = map.getSize();
      const bounds = map.getBounds();
      const step = stepFor(map.getZoom());
      const labels = [];
      for (const lat of linesBetween(bounds.getSouth(), bounds.getNorth(), step)) {
        const y = map.latLngToContainerPoint([lat, bounds.getWest()]).y;
        if (y > EDGE_CLEARANCE && y < size.y - 20) labels.push(['lat', format(lat, step, 'N', 'S'), 4, y]);
      }
      const seen = new Set();
      for (const lng of linesBetween(bounds.getWest(), bounds.getEast(), step)) {
        const text = format(wrapLng(lng), step, 'E', 'W');
        const x = map.latLngToContainerPoint([bounds.getSouth(), lng]).x;
        if (x > 48 && x < size.x - EDGE_CLEARANCE && !seen.has(text)) { seen.add(text); labels.push(['lng', text, x, size.y - 4]); }
      }
      this._labels.replaceChildren(...labels.map(([axis, text, x, y]) => {
        const span = document.createElement('span');
        span.className = `grid-label grid-label-${axis}`;
        span.textContent = text;
        span.style.left = `${Math.round(x)}px`;
        span.style.top = `${Math.round(y)}px`;
        return span;
      }));
    },
  });
  return new Graticule();
}
