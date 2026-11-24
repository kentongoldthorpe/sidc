// Graphics layer (driving adapter on the Leaflet map): the selected COA's lines, areas and range
// rings, drawn in their colour (hostile dashed) with labels, and an arrowhead on axes of advance.
// Clicking a graphic selects it (`graphicSelection`). The selected graphic gets handles:
//   point handles   drag to move a point; right-click (long-press on touch) removes it
//   midpoint handles drag to insert a point between two others
//   ring handles    the centre (drag to move) and a radius handle (drag to resize)
// Every edit is one graphic.update through the app client; the layer redraws from events.
import { describeError } from './dom.js';
import { graphicColor, shapeOf } from '../../../domain/graphic.js';
import { sectorOutlineGeo, destination, initialBearing } from '../../../domain/geodesy.js';
import { MAP_SPACE, shapeLayer, addLabel, weaponRanges } from './drawing.js';
import { createActiveCoa } from '../active-coa.js';
import { createMapMessage } from './map-message.js';

const MIN_POINTS = { line: 2, area: 3 };

/**
 * @param {{ client: object, L: object, map: object, selection: object, graphicSelection: object, drawer?: object, activeCoa?: object }} options
 *   activeCoa: the shared active-COA store (one is created when the layer is mounted on its own).
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountGraphicsLayer({ client, L, map, selection, graphicSelection, drawer = null, activeCoa }) {
  let destroyed = false;
  let coa = null;
  const ownStore = activeCoa ? null : createActiveCoa({ client, selection });
  const store = activeCoa ?? ownStore;
  const shapes = L.layerGroup().addTo(map);
  const handles = L.layerGroup().addTo(map);

  const message = createMapMessage(L, map);
  const say = message.say;

  const drawing = () => drawer?.isActive() ?? false;

  async function save(graphic, changes) {
    const result = await client.send('graphic.update', { coaId: coa.id, graphicId: graphic.id, ...changes });
    if (destroyed) return;
    if (!result.ok) {
      say(`Change not saved: ${describeError(result.error)}`);
      render(); // put the handles back where the stored graphic is
    }
  }

  // ---- drawing the graphics ----
  function arrowhead(graphic, color) {
    const [a, b] = graphic.points.slice(-2).map((p) => map.project([p.lat, p.lng], 0)); // Mercator is conformal: the angle is the same at every zoom
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const last = graphic.points.at(-1);
    return L.marker([last.lat, last.lng], {
      interactive: false, keyboard: false,
      icon: L.divIcon({
        className: 'graphic-arrow',
        iconSize: [40, 40], iconAnchor: [20, 20],
        html: `<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(${angle.toFixed(1)} 20 20)"><polygon points="22,20 6,12 6,28" fill="${color}"/></g></svg>`,
      }),
    });
  }

  /** Draw one graphic. @returns {{ layer: object, parts: object[] }} parts: every layer added for it */
  function addShape(graphic) {
    const parts = [];
    const color = graphicColor(graphic);
    const selected = graphic.id === graphicSelection.get();
    const weapon = graphic.coverage === true; // a unit's weapon range, drawn from the unit (D28): not selectable here
    const layer = shapeLayer(L, graphic, MAP_SPACE, {
      weight: selected ? 5 : weapon ? 1.5 : 3, opacity: weapon ? 0.8 : 0.95,
      ...(weapon ? { fillOpacity: 0.07, dashArray: null } : {}),
      className: weapon ? `unit-coverage role-${graphic.role}` : `graphic graphic-${graphic.kind}${selected ? ' is-selected' : ''}`,
      interactive: !drawing() && !weapon, bubblingMouseEvents: false,
    });
    layer.addTo(shapes);
    parts.push(layer);
    if (weapon) layer.getElement().dataset.coverageOf = graphic.unitId; else layer.getElement().dataset.graphicId = graphic.id;
    // Labels: above the middle of a line, in the middle of an area or ring. Hidden while the graphic
    // is selected, so they never cover its handles.
    // A ring's label sits on its top edge: its centre is often a unit (a weapon's range ring).
    if (!selected) parts.push(...addLabel(L, shapes, layer, graphic, MAP_SPACE, map.getContainer().ownerDocument));
    if (!weapon) layer.on('click', () => { if (!drawing()) graphicSelection.set(graphic.id); });
    if (graphic.kind === 'axisOfAdvance') parts.push(arrowhead(graphic, color).addTo(shapes));
    return { layer, parts };
  }

  function handle(latlng, className, layer) {
    const marker = L.marker(latlng, {
      draggable: true, keyboard: false, zIndexOffset: 1000,
      icon: L.divIcon({ className: `graphic-handle ${className}`.trim(), iconSize: [14, 14], iconAnchor: [7, 7] }),
    }).addTo(handles);
    return marker;
  }

  function addHandles(graphic, layer) {
    const shape = shapeOf(graphic.kind);
    if (shape === 'circle') {
      const center = handle([graphic.center.lat, graphic.center.lng], 'is-center');
      const edgeOf = (c, r) => L.latLng(c.lat, c.lng + (r / (111320 * Math.cos((c.lat * Math.PI) / 180))));
      const edge = handle(edgeOf(graphic.center, graphic.radius), 'is-radius');
      center.on('drag', () => { layer.setLatLng(center.getLatLng()); edge.setLatLng(edgeOf(center.getLatLng(), layer.getRadius())); });
      center.on('dragend', () => { const { lat, lng } = center.getLatLng(); save(graphic, { center: { lat, lng } }); });
      edge.on('drag', () => layer.setRadius(map.distance(center.getLatLng(), edge.getLatLng())));
      edge.on('dragend', () => save(graphic, { radius: Math.max(1, Math.round(map.distance(center.getLatLng(), edge.getLatLng()))) }));
      return;
    }
    if (shape === 'sector') {
      // Centre handle moves the sector; the rim handle (on the centre line) sets range and direction together.
      const plain = (ll) => ({ lat: ll.lat, lng: ll.lng });
      const rimOf = (c, g) => { const p = destination(c, g.bearing, g.radius); return [p.lat, p.lng]; };
      const center = handle([graphic.center.lat, graphic.center.lng], 'is-center');
      const rim = handle(rimOf(graphic.center, graphic), 'is-radius');
      const outline = (g) => layer.setLatLngs(sectorOutlineGeo(g.center, g).map((p) => [p.lat, p.lng]));
      const live = () => {
        const c = plain(center.getLatLng());
        const r = plain(rim.getLatLng());
        return { ...graphic, center: c, radius: Math.max(1, Math.round(map.distance(c, r))), bearing: Math.round(initialBearing(c, r) * 10) / 10 % 360 };
      };
      center.on('drag', () => { const g = { ...graphic, center: plain(center.getLatLng()) }; outline(g); rim.setLatLng(rimOf(g.center, g)); });
      center.on('dragend', () => save(graphic, { center: plain(center.getLatLng()) }));
      rim.on('drag', () => outline(live()));
      rim.on('dragend', () => { const g = live(); save(graphic, { radius: g.radius, bearing: g.bearing }); });
      return;
    }
    const points = graphic.points.map((p) => L.latLng(p.lat, p.lng));
    const closed = shape === 'area';
    const toPlain = (list) => list.map((p) => ({ lat: p.lat, lng: p.lng }));
    points.forEach((p, i) => {
      const h = handle(p, '');
      h.on('drag', () => { const next = [...points]; next[i] = h.getLatLng(); layer.setLatLngs(next); });
      h.on('dragend', () => { const next = [...points]; next[i] = h.getLatLng(); save(graphic, { points: toPlain(next) }); });
      h.on('contextmenu', (e) => {
        L.DomEvent.preventDefault(e.originalEvent);
        if (points.length <= MIN_POINTS[shape]) { say(`A${shape === 'area' ? 'n area' : ' line'} needs at least ${MIN_POINTS[shape]} points`); return; }
        save(graphic, { points: toPlain(points.filter((_, j) => j !== i)) });
      });
    });
    const segments = closed ? points.length : points.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const mid = handle(L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2), 'is-mid');
      const inserted = () => [...points.slice(0, i + 1), mid.getLatLng(), ...points.slice(i + 1)];
      mid.on('drag', () => layer.setLatLngs(inserted()));
      mid.on('dragend', () => save(graphic, { points: toPlain(inserted()) }));
    }
  }

  // Drawn graphics are kept between renders (H-5): only a graphic that changed, or whose selected or
  // drawing state changed, is drawn again. id → { look, layer, parts }
  const drawn = new Map();
  const undraw = (id) => {
    for (const part of drawn.get(id).parts) { part.unbindTooltip?.(); shapes.removeLayer(part); } // Leaflet can leave permanent tooltips behind
    drawn.delete(id);
  };

  function render() {
    if (destroyed) return;
    handles.clearLayers();
    const ranges = weaponRanges(coa?.symbols ?? []);
    const wanted = new Map([...ranges, ...(coa?.graphics ?? [])].map((g) => [g.id, g]));
    for (const id of [...drawn.keys()]) if (!wanted.has(id)) undraw(id);
    for (const graphic of wanted.values()) {
      const look = JSON.stringify([graphic, graphic.id === graphicSelection.get(), drawing()]);
      if (drawn.get(graphic.id)?.look === look) continue;
      if (drawn.has(graphic.id)) undraw(graphic.id);
      drawn.set(graphic.id, { look, ...addShape(graphic) });
    }
    const selected = drawn.get(graphicSelection.get());
    if (selected && !drawing() && !wanted.get(graphicSelection.get()).coverage) addHandles(wanted.get(graphicSelection.get()), selected.layer);
  }

  function apply(next, { error } = {}) {
    if (destroyed || (next === coa && !error && next !== null)) return; // already showing this load
    coa = next;
    if (error) say(describeError(error));
    if (coa && graphicSelection.get() !== null && !coa.graphics.some((g) => g.id === graphicSelection.get())) graphicSelection.set(null);
    render();
  }

  // ---- wiring ----
  const onKeydown = (event) => {
    if (event.key === 'Escape' && !drawing() && graphicSelection.get() !== null && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '')) graphicSelection.set(null);
  };
  document.addEventListener('keydown', onKeydown);
  const unsubscribes = [
    store.subscribe(apply),
    selection.subscribe(() => graphicSelection.set(null)),
    graphicSelection.subscribe(render),
    ...(drawer ? [drawer.subscribe(render)] : []),
  ];

  return {
    ready: store.ready.then(() => apply(store.get())),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      document.removeEventListener('keydown', onKeydown);
      ownStore?.destroy();
      message.remove();
      shapes.remove();
      handles.remove();
    },
  };
}
