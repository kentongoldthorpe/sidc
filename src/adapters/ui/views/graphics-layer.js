// Graphics layer (driving adapter on the Leaflet map): the selected COA's lines, areas and range
// rings, drawn in their colour (hostile dashed) with labels, and an arrowhead on axes of advance.
// Clicking a graphic selects it (`graphicSelection`). The selected graphic gets handles:
//   point handles   drag to move a point; right-click (long-press on touch) removes it
//   midpoint handles drag to insert a point between two others
//   ring handles    the centre (drag to move) and a radius handle (drag to resize)
// Every edit is one graphic.update through the app client; the layer redraws from events.
import { describeError } from './dom.js';
import { graphicColor, shapeOf } from '../../../domain/graphic.js';
import { createActiveCoa } from '../active-coa.js';
import { createMapMessage } from './map-message.js';

const MIN_POINTS = { line: 2, area: 3 };
const HOSTILE_DASH = '10 6';

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
  const latLngs = (points) => points.map((p) => [p.lat, p.lng]);

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

  function addShape(graphic) {
    const shape = shapeOf(graphic.kind);
    const color = graphicColor(graphic);
    const selected = graphic.id === graphicSelection.get();
    const style = {
      color, weight: selected ? 5 : 3, opacity: 0.95,
      dashArray: graphic.side === 'hostile' ? HOSTILE_DASH : null,
      className: `graphic graphic-${graphic.kind}${selected ? ' is-selected' : ''}`,
      interactive: !drawing(), bubblingMouseEvents: false,
    };
    const layer = shape === 'circle'
      ? L.circle([graphic.center.lat, graphic.center.lng], { ...style, radius: graphic.radius, fillOpacity: 0.05 })
      : shape === 'area'
        ? L.polygon(latLngs(graphic.points), { ...style, fillOpacity: 0.12 })
        : L.polyline(latLngs(graphic.points), { ...style, fill: false });
    layer.addTo(shapes);
    layer.getElement().dataset.graphicId = graphic.id;
    // Labels: above the middle of a line, in the middle of an area or ring. Hidden while the graphic
    // is selected, so they never cover its handles.
    // A ring's label sits on its top edge: its centre is often a unit (a weapon's range ring).
    if (graphic.label && !selected) {
      const onLine = shape === 'line';
      const options = { permanent: true, direction: onLine ? 'top' : 'center', offset: onLine ? [0, -4] : [0, 0], className: 'graphic-label', interactive: false };
      // Leaflet treats string content as HTML: hand it a text node, since labels can come from files.
      const text = map.getContainer().ownerDocument.createTextNode(graphic.label);
      if (shape === 'circle') {
        const top = [graphic.center.lat + graphic.radius / 111195, graphic.center.lng];
        L.tooltip(options).setLatLng(top).setContent(text).addTo(shapes);
      } else {
        layer.bindTooltip(text, options).openTooltip();
      }
    }
    layer.on('click', () => { if (!drawing()) graphicSelection.set(graphic.id); });
    if (graphic.kind === 'axisOfAdvance') arrowhead(graphic, color).addTo(shapes);
    return layer;
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

  function render() {
    if (destroyed) return;
    shapes.eachLayer((layer) => layer.unbindTooltip?.()); // Leaflet can leave permanent tooltips behind
    shapes.clearLayers();
    handles.clearLayers();
    if (!coa) return;
    for (const graphic of coa.graphics) {
      const layer = addShape(graphic);
      if (graphic.id === graphicSelection.get() && !drawing()) addHandles(graphic, layer);
    }
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
