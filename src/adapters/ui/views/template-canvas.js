// Template canvas (driving adapter, Epic 3 T-2b): a threat model's doctrinal template drawn to scale
// without terrain. Leaflet with a flat CRS where one unit is one metre: template (x, y) is
// latlng [y, x], so +y (the direction of attack) is up and east is right. Shows a metric grid, the
// reference point, a scale bar, frontage and depth, units (draggable; HVTs marked), each unit's
// systems to scale (rings and sectors of fire), and the template's lines and areas.
import { createPicker } from '../map-picker.js';
import { createDrawer } from '../map-drawer.js';
import { mountDrawTool } from './draw-tool.js';
import { createMapMessage } from './map-message.js';
import { describeError } from './dom.js';
import { coverageOf, formationExtent } from '../../../domain/template-geometry.js';
import { graphicColor, shapeOf } from '../../../domain/graphic.js';

const SYMBOL_SIZE = 36;
const GRID_STEPS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
const GRID_MIN_PX = 70;
const ROLE_COLORS = Object.freeze({ airDefence: '#7b3fa0', direct: '#c8102e', indirect: '#d9730d', sensor: '#00838f', other: '#5b6157' });
const HOSTILE_DASH = '10 6';

const toLatLng = (p) => [p.y, p.x];
const metres = (ll) => ({ x: Math.round(ll.lng), y: Math.round(ll.lat) });
/** "850 m" or "1.6 km" */
export const distanceText = (m) => (m < 1000 ? `${Math.round(m)} m` : `${Number((m / 1000).toFixed(1))} km`);

/**
 * @param {{ client: object, L: object, container: HTMLElement, store: object, unitSelection: object }} options
 * @returns {{ map: object, picker: object, drawer: object, ready: Promise<void>, invalidate(): void, destroy(): void }}
 */
export function mountTemplateCanvas({ client, L, container, store, unitSelection }) {
  let destroyed = false;
  const map = L.map(container, {
    crs: L.CRS.Simple, center: [0, 0], zoom: -3, minZoom: -7, maxZoom: 3, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false,
  });
  container.classList.add('template-canvas-map');
  const picker = createPicker();
  const drawer = createDrawer();
  const drawTool = mountDrawTool({ L, map, drawer });
  const message = createMapMessage(L, map);

  const grid = L.layerGroup().addTo(map);
  const coverage = L.layerGroup().addTo(map);
  const graphics = L.layerGroup().addTo(map);
  const units = L.layerGroup().addTo(map);
  L.control.scale({ imperial: false, maxWidth: 160, position: 'bottomright' }).addTo(map);

  // The reference point (0, 0).
  L.marker([0, 0], {
    interactive: false, keyboard: false,
    icon: L.divIcon({ className: 'template-origin', iconSize: [28, 28], iconAnchor: [14, 14], html: '<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 0v28M0 14h28" stroke="currentColor" stroke-width="1"/></svg>' }),
  }).addTo(map);

  // Fit: a button under the zoom buttons. The direction of attack (always up), frontage and depth:
  // a quiet line beside the scale bar, so nothing covers the drawing.
  const fitControl = L.control({ position: 'topleft' });
  fitControl.onAdd = () => {
    const bar = L.DomUtil.create('div', 'leaflet-bar template-fit');
    const fit = L.DomUtil.create('button', '', bar);
    fit.type = 'button';
    fit.textContent = 'Fit';
    fit.title = 'Zoom to the formation and its coverage';
    fit.setAttribute('aria-label', 'Fit: zoom to the formation and its coverage');
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(fit, 'click', () => fitToFormation(store.get()));
    return bar;
  };
  fitControl.addTo(map);
  const extentControl = L.control({ position: 'bottomright' });
  let extentEl;
  extentControl.onAdd = () => {
    const line = L.DomUtil.create('div', 'template-legend');
    const attack = L.DomUtil.create('span', 'template-attack', line);
    attack.textContent = '↑ Attack';
    attack.title = 'Direction of attack: up the canvas';
    extentEl = L.DomUtil.create('span', 'template-extent', line);
    extentEl.dataset.extent = '';
    extentEl.title = 'Frontage (across the direction of attack) and depth (along it)';
    return line;
  };
  extentControl.addTo(map);

  // ---- metric grid ----
  function drawGrid() {
    grid.clearLayers();
    const pxPerMetre = 2 ** map.getZoom();
    const step = GRID_STEPS.find((s) => s * pxPerMetre >= GRID_MIN_PX) ?? GRID_STEPS.at(-1);
    const b = map.getBounds();
    const [west, east, south, north] = [b.getWest(), b.getEast(), b.getSouth(), b.getNorth()];
    for (let x = Math.ceil(west / step) * step; x <= east; x += step) {
      L.polyline([[south, x], [north, x]], { className: `template-grid-line${x === 0 ? ' is-axis' : ''}`, interactive: false, weight: 1 }).addTo(grid);
      if (x !== 0) L.marker([south, x], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'template-grid-label is-x', html: '', iconSize: null }) }).addTo(grid).getElement().textContent = distanceText(Math.abs(x));
    }
    for (let y = Math.ceil(south / step) * step; y <= north; y += step) {
      L.polyline([[y, west], [y, east]], { className: `template-grid-line${y === 0 ? ' is-axis' : ''}`, interactive: false, weight: 1 }).addTo(grid);
      if (y !== 0) L.marker([y, west], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'template-grid-label is-y', html: '', iconSize: null }) }).addTo(grid).getElement().textContent = `${y > 0 ? '+' : '−'}${distanceText(Math.abs(y))}`;
    }
  }
  map.on('moveend zoomend resize', drawGrid);

  // ---- units ----
  const previews = new Map();
  function iconFor(unit) {
    const key = `${unit.sidc}|${unit.label}`;
    if (!previews.has(key)) {
      previews.set(key, client.ask('symbol.preview', { sidc: unit.sidc, label: unit.label, modifiers: {}, size: SYMBOL_SIZE })
        .then((r) => (r.ok ? { html: r.value.svg, iconSize: [Math.round(r.value.width), Math.round(r.value.height)], iconAnchor: [Math.round(r.value.anchor.x), Math.round(r.value.anchor.y)] } : null)));
    }
    return previews.get(key);
  }

  async function moveUnit(id, to) {
    const result = await store.saveTemplate((t) => ({ ...t, units: t.units.map((u) => (u.id === id ? { ...u, ...to } : u)) }));
    if (!result.ok && !destroyed) { message.say(`Move not saved: ${describeError(result.error)}`); render(store.get()); }
  }

  /** An arrowhead at the end of a move (screen angle; the flat CRS keeps angles at every zoom). */
  function moveArrowhead(from, to) {
    const angle = (Math.atan2(-(to.y - from.y), to.x - from.x) * 180) / Math.PI;
    return L.marker(toLatLng(to), {
      interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'template-move-head', iconSize: [40, 40], iconAnchor: [20, 20], html: `<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(${angle.toFixed(1)} 20 20)"><polygon points="6,20 -8,13 -8,27" fill="currentColor"/></g></svg>` }),
    });
  }

  let renderSeq = 0;
  async function render(model) {
    const seq = ++renderSeq;
    const formation = (model ? store.template() : null) ?? { units: [], graphics: [] }; // the formation or a COA's play
    const icons = await Promise.all(formation.units.map(iconFor));
    if (destroyed || seq !== renderSeq) return;
    units.clearLayers();
    coverage.clearLayers();
    graphics.eachLayer((layer) => layer.unbindTooltip?.());
    graphics.clearLayers();

    for (const unit of formation.units) {
      // In a play, a unit fights where it ends up: show its coverage there.
      for (const shape of coverageOf(unit.end ? { ...unit, ...unit.end } : unit)) {
        const color = ROLE_COLORS[shape.weapon.role] ?? ROLE_COLORS.other;
        const style = { color, weight: 1.5, fillOpacity: 0.07, interactive: false };
        if (shape.kind === 'ring') {
          L.circle(toLatLng(shape.center), { ...style, radius: shape.radius, className: `coverage coverage-ring role-${shape.weapon.role}` }).addTo(coverage);
          if (shape.minRadius) L.circle(toLatLng(shape.center), { ...style, radius: shape.minRadius, fill: false, dashArray: '4 4', className: 'coverage-min' }).addTo(coverage);
        } else {
          L.polygon(shape.points.map(toLatLng), { ...style, className: `coverage coverage-sector role-${shape.weapon.role}` }).addTo(coverage);
        }
      }
    }

    for (const g of formation.graphics) {
      const shape = shapeOf(g.kind);
      const style = { color: graphicColor(g), weight: 3, dashArray: g.side === 'hostile' ? HOSTILE_DASH : null, className: `template-graphic graphic-${g.kind}`, interactive: false };
      const layer = shape === 'circle' ? L.circle(toLatLng(g.center), { ...style, radius: g.radius, fillOpacity: 0.05 })
        : shape === 'area' ? L.polygon(g.points.map(toLatLng), { ...style, fillOpacity: 0.1 })
          : L.polyline(g.points.map(toLatLng), { ...style, fill: false });
      layer.addTo(graphics);
      layer.getElement().dataset.graphicId = g.id;
      if (g.label) layer.bindTooltip(container.ownerDocument.createTextNode(g.label), { permanent: true, direction: 'center', className: 'graphic-label', interactive: false }).openTooltip();
    }

    const addMarker = (unit, icon, at, { role, onDrop }) => {
      const marker = L.marker(toLatLng(at), {
        draggable: true, title: `${unit.label || unit.sidc}${role === 'start' ? ' (start)' : ''}`, riseOnHover: true,
        icon: icon ? L.divIcon({ ...icon, className: 'template-unit' }) : new L.Icon.Default(),
      }).addTo(units);
      const el = marker.getElement();
      el.classList.add('template-unit');
      if (role === 'start') { el.classList.add('is-start'); el.dataset.startOf = unit.id; } else { el.dataset.unitId = unit.id; }
      el.classList.toggle('is-end', role === 'end');
      el.classList.toggle('is-hvt', unit.hvt && role !== 'start');
      if (icon) { el.style.setProperty('--anchor-x', `${icon.iconAnchor[0]}px`); el.style.setProperty('--anchor-y', `${icon.iconAnchor[1]}px`); } // the HVT badge sits under the symbol itself
      el.classList.toggle('is-selected', unit.id === unitSelection.get());
      marker.on('click', () => unitSelection.set(unit.id));
      marker.on('dragend', () => onDrop(metres(marker.getLatLng())));
    };
    formation.units.forEach((unit, i) => {
      if (!unit.end) { addMarker(unit, icons[i], unit, { role: 'unit', onDrop: (p) => moveUnit(unit.id, p) }); return; }
      // A move in a COA's play (D26): the start faded, an arrow, the end solid; both can be dragged.
      L.polyline([toLatLng(unit), toLatLng(unit.end)], { className: 'template-move', weight: 2, dashArray: '6 4', interactive: false }).addTo(units);
      moveArrowhead(unit, unit.end).addTo(units);
      addMarker(unit, icons[i], unit, { role: 'start', onDrop: (p) => moveUnit(unit.id, p) });
      addMarker(unit, icons[i], unit.end, { role: 'end', onDrop: (p) => moveUnit(unit.id, { end: p }) });
    });

    const { frontage, depth } = formationExtent(formation.units);
    extentEl.textContent = formation.units.length > 1 ? `Frontage ${distanceText(frontage)} · Depth ${distanceText(depth)}` : 'Place units to see frontage and depth';
  }

  /** Zoom to everything in the template: units, their coverage, lines and areas (and the reference point). */
  function fitToFormation(model) {
    const formation = model ? store.template() : null;
    if (!formation) return;
    const points = [[0, 0]];
    for (const unit of formation.units) {
      points.push(toLatLng(unit));
      if (unit.end) points.push(toLatLng(unit.end));
      for (const shape of coverageOf(unit)) {
        if (shape.kind === 'ring') points.push([shape.center.y - shape.radius, shape.center.x - shape.radius], [shape.center.y + shape.radius, shape.center.x + shape.radius]);
        else points.push(...shape.points.map(toLatLng));
      }
    }
    for (const g of formation.graphics) {
      if (g.points) points.push(...g.points.map(toLatLng));
      else points.push([g.center.y - g.radius, g.center.x - g.radius], [g.center.y + g.radius, g.center.x + g.radius]);
    }
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 0, animate: false });
  }

  const markSelected = (id) => units.eachLayer((m) => m.getElement()?.classList.toggle('is-selected', m.getElement().dataset.unitId === id));
  const onClick = (e) => { if (picker.isActive()) picker.resolve(metres(e.latlng)); };
  map.on('click', onClick);
  const offs = [
    store.subscribe((model, { switched, error }) => {
      if (error) message.say(describeError(error));
      render(model);
      if (switched && container.offsetParent !== null) fitToFormation(model); // a newly selected model: show all of it
    }),
    unitSelection.subscribe(markSelected),
    picker.subscribe((active) => container.classList.toggle('is-picking', active)),
    drawer.subscribe((request) => { if (request) picker.cancel(); }),
  ];
  drawGrid();

  return {
    map, picker, drawer,
    ready: store.ready.then(async () => { await render(store.get()); if (container.offsetParent !== null) fitToFormation(store.get()); }),
    /** Zoom to the whole formation and its coverage. */
    fit: () => fitToFormation(store.get()),
    /** After the canvas was hidden (workspace switch): fix its size and redraw the grid. */
    invalidate() { map.invalidateSize(); fitToFormation(store.get()); drawGrid(); },
    destroy() {
      destroyed = true;
      offs.forEach((off) => off());
      drawTool.destroy();
      message.remove();
      map.remove();
    },
  };
}
