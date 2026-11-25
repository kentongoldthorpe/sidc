// The photo underlay on the map (Epic 6 E6-5): a registered photo or scan drawn under everything else,
// warped to the ground. Canvas only draws affine images, so the photo is cut into a mesh of small
// triangles, each mapped image → ground (the fitted transform, UTM) → screen; that follows perspective
// and Mercator alike. Redrawn when the map stops moving; it pans with the map in between.
import { fromUtm } from '../../../domain/mgrs.js';

const MESH = 24;

/** The affine matrix taking three image points to three screen points (for ctx.transform). */
function affineFor([u0, v0, u1, v1, u2, v2], [x0, y0, x1, y1, x2, y2]) {
  const det = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(det) < 1e-12) return null;
  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / det;
  const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / det;
  const e = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / det;
  const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / det;
  const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / det;
  const f = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / det;
  return [a, b, c, d, e, f];
}

/**
 * @param {{ L: object, map: object }} options
 * @returns {{ show(u: { image: CanvasImageSource, width: number, height: number, transform: object, zone: number, hemisphere: string }): void,
 *             setOpacity(v: number): void, clear(): void, isOn(): boolean, destroy(): void }}
 */
export function createUnderlay({ L, map }) {
  const pane = map.getPane('underlay') ?? map.createPane('underlay');
  pane.style.zIndex = '250'; // over the base map (200), under lines, areas and units (400+)
  pane.style.pointerEvents = 'none';
  const canvas = L.DomUtil.create('canvas', 'underlay-canvas', pane);
  canvas.dataset.underlay = '';
  let state = null;
  let opacity = 0.6;

  function draw() {
    if (!state) { canvas.hidden = true; return; }
    canvas.hidden = false;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.x * dpr);
    canvas.height = Math.round(size.y * dpr);
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = opacity;
    const { image, width, height, transform, zone, hemisphere } = state;
    const screen = [];
    for (let j = 0; j <= MESH; j++) {
      for (let i = 0; i <= MESH; i++) {
        const u = (i / MESH) * width;
        const v = (j / MESH) * height;
        const g = transform.apply(u, v);
        const ll = fromUtm({ zone, hemisphere, easting: g.e, northing: g.n });
        const p = map.latLngToContainerPoint([ll.lat, ll.lng]);
        screen.push({ u, v, x: p.x, y: p.y });
      }
    }
    const at = (i, j) => screen[j * (MESH + 1) + i];
    const tri = (A, B, C) => {
      const m = affineFor([A.u, A.v, B.u, B.v, C.u, C.v], [A.x, A.y, B.x, B.y, C.x, C.y]);
      if (!m) return;
      // Clip to the triangle, grown by half a pixel so the seams do not show.
      const cx = (A.x + B.x + C.x) / 3;
      const cy = (A.y + B.y + C.y) / 3;
      const grow = (P) => { const dx = P.x - cx; const dy = P.y - cy; const d = Math.hypot(dx, dy) || 1; return [P.x + (dx / d) * 0.6, P.y + (dy / d) * 0.6]; };
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.moveTo(...grow(A)); ctx.lineTo(...grow(B)); ctx.lineTo(...grow(C)); ctx.closePath();
      ctx.clip();
      ctx.transform(...m);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    };
    for (let j = 0; j < MESH; j++) {
      for (let i = 0; i < MESH; i++) {
        tri(at(i, j), at(i + 1, j), at(i + 1, j + 1));
        tri(at(i, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }
  }

  const hide = () => { canvas.hidden = true; };
  map.on('moveend zoomend resize viewreset', draw);
  map.on('zoomstart', hide);
  return {
    show(u) { state = u; draw(); },
    setOpacity(v) { opacity = Math.max(0, Math.min(1, v)); draw(); },
    clear() { state = null; draw(); },
    isOn: () => state !== null,
    destroy() { map.off('moveend zoomend resize viewreset', draw); map.off('zoomstart', hide); canvas.remove(); },
  };
}
