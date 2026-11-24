// Placement preview (driving adapter, Epic 3 T-5b): a threat play laid on the main map before it
// becomes a SITTEMP COA. The preview is exactly what will be created: it is drawn from the same pure
// placePlay the command uses. Drag the anchor (the template's reference point) to move the whole
// play; drag the rotate handle, or type a bearing, to turn its direction of attack. Every distance
// and angle is kept. Place sends threat-coa.place; Cancel (or Escape) drops the preview.
import { el, describeError } from './dom.js';
import { placePlay, POSITIONS } from '../../../domain/placement.js';
import { sectorOutlineGeo, initialBearing } from '../../../domain/geodesy.js';
import { graphicColor, shapeOf } from '../../../domain/graphic.js';
import { coverageGraphics } from '../../../domain/weapon.js';

const SYMBOL_SIZE = 32;
const ROTATE_PX = 90; // the rotate handle sits this far from the anchor, along the direction of attack
const POSITION_NAMES = Object.freeze({ start: 'Start positions', end: 'End positions', endWithMoves: 'End positions with moves' });
const norm = (b) => ((Math.round(b) % 360) + 360) % 360;
const ll = (p) => [p.lat, p.lng];

/**
 * @param {{ client: object, L: object, map: object, selection: object, onDone?: (coa: object) => void, onCancel?: () => void }} options
 * @returns {{ start(o: { model: object, play: string }): void, cancel(): void, isActive(): boolean, state(): object|null, destroy(): void }}
 */
export function mountPlacementPreview({ client, L, map, selection, onDone = () => {}, onCancel = () => {} }) {
  let session = null; // { model, play, anchor, bearing, positions, name, nameTouched }
  let control = null;
  const shapes = L.layerGroup();
  const units = L.layerGroup();
  let anchorMarker = null;
  let rotateMarker = null;
  const previews = new Map();
  let renderSeq = 0;

  const iconFor = (s) => {
    const key = `${s.sidc}|${s.label}`;
    if (!previews.has(key)) {
      previews.set(key, client.ask('symbol.preview', { sidc: s.sidc, label: s.label, modifiers: {}, size: SYMBOL_SIZE })
        .then((r) => (r.ok ? L.divIcon({ className: 'placement-unit-icon', html: r.value.svg, iconSize: [Math.round(r.value.width), Math.round(r.value.height)], iconAnchor: [Math.round(r.value.anchor.x), Math.round(r.value.anchor.y)] }) : null)));
    }
    return previews.get(key);
  };

  const content = () => placePlay(session.model, { play: session.play, anchor: session.anchor, bearing: session.bearing, positions: session.positions });

  async function render() {
    if (!session) return;
    const seq = ++renderSeq;
    const placed = content();
    const template = session.play === 'formation' ? session.model.formation : session.model.coas.find((c) => c.id === session.play)?.template;
    if (!placed || !template) { cancel(); return; }
    shapes.clearLayers();
    const ranges = placed.symbols.flatMap((u, i) => coverageGraphics({ ...u, id: `p${i}` }));
    for (const g of [...ranges, ...placed.graphics]) {
      const style = { color: graphicColor(g), weight: 2, opacity: 0.8, fillOpacity: 0.06, interactive: false, className: `placement-shape graphic-${g.kind}`, dashArray: g.kind === 'axisOfAdvance' ? '8 6' : null };
      const shape = shapeOf(g.kind);
      if (shape === 'circle') L.circle(ll(g.center), { ...style, radius: g.radius }).addTo(shapes);
      else if (shape === 'sector') L.polygon(sectorOutlineGeo(g.center, g).map(ll), style).addTo(shapes);
      else if (shape === 'area') L.polygon(g.points.map(ll), style).addTo(shapes);
      else L.polyline(g.points.map(ll), { ...style, fill: false }).addTo(shapes);
    }
    const icons = await Promise.all(placed.symbols.map(iconFor));
    if (!session || seq !== renderSeq) return;
    units.clearLayers();
    placed.symbols.forEach((s, i) => {
      const marker = L.marker(ll(s.position), { interactive: false, keyboard: false, icon: icons[i] ?? L.divIcon({ className: 'placement-unit-icon', iconSize: [12, 12] }) }).addTo(units);
      const node = marker.getElement();
      node.classList.add('placement-unit');
      node.dataset.unitId = template.units[i].id;
      if (s.hvt) node.classList.add('is-hvt');
    });
  }

  function rotateHandleAt() {
    const a = map.latLngToContainerPoint(ll(session.anchor));
    const r = (session.bearing * Math.PI) / 180;
    return map.containerPointToLatLng([a.x + ROTATE_PX * Math.sin(r), a.y - ROTATE_PX * Math.cos(r)]);
  }
  const placeHandles = () => {
    if (!session) return;
    anchorMarker.setLatLng(ll(session.anchor));
    if (!rotateMarker.dragging?._draggable?._moving) rotateMarker.setLatLng(rotateHandleAt());
  };

  const handleIcon = (cls, glyph) => L.divIcon({ className: cls, iconSize: [26, 26], iconAnchor: [13, 13], html: glyph });

  function buildControl(placed) {
    const name = el('input', { attrs: { name: 'place-name', autocomplete: 'off', maxlength: 120, 'aria-label': 'Name of the new COA' } });
    name.value = session.name ?? placed.name;
    name.addEventListener('input', () => { session.name = name.value; });
    const bearing = el('input', { attrs: { name: 'place-bearing', type: 'number', min: 0, max: 359, step: 1, inputmode: 'numeric', 'aria-label': 'Direction of attack, degrees true' } });
    bearing.value = String(session.bearing);
    bearing.addEventListener('input', () => {
      const v = Number(bearing.value);
      if (bearing.value.trim() === '' || !Number.isFinite(v)) return;
      session.bearing = norm(v);
      placeHandles();
      render();
    });
    const positions = el('select', { attrs: { name: 'place-positions', 'aria-label': 'Unit positions' } }, ...POSITIONS.map((p) => el('option', { attrs: { value: p }, text: POSITION_NAMES[p] })));
    positions.value = session.positions;
    positions.addEventListener('change', () => { session.positions = positions.value; render(); });
    const error = el('p', { class: 'field-error' });
    const placeButton = el('button', { class: 'primary', attrs: { type: 'button' }, text: session.coa ? 'Apply' : 'Place', on: { click: onPlace } });
    const field = (text, input) => el('label', { class: 'field' }, el('span', { text }), input);
    const box = el('div', { class: 'placement-control stack', dataset: { placement: '' }, attrs: { role: 'group', 'aria-label': 'Place threat play' } },
      el('strong', { text: session.coa ? `Moving ${session.coa.name}` : `Placing ${session.play === 'formation' ? `${session.model.name} formation` : session.model.coas.find((c) => c.id === session.play).name}` }),
      el('p', { class: 'hint', text: 'Drag ✛ to move the play, ↻ to turn it. Distances are kept.' }),
      session.coa ? null : field('Name', name),
      el('div', { class: 'position' }, field('Attack bearing °', bearing), field('Units at', positions)),
      error,
      el('div', { class: 'actions' }, placeButton, el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: cancel } })));
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    const c = L.control({ position: 'topright' });
    c.onAdd = () => box;
    c.sync = () => { bearing.value = String(session.bearing); };
    c.fail = (text) => { error.textContent = text; placeButton.disabled = false; };
    c.busy = () => { error.textContent = ''; placeButton.disabled = true; };
    return c;
  }

  async function onPlace() {
    if (!session) return;
    const s = session;
    control.busy();
    const name = (s.name ?? '').trim();
    const result = s.coa // moving or turning a placed COA (D30): its georeference changes, nothing is copied
      ? await client.send('coa.re-place', { coaId: s.coa.id, expectedRevision: s.coa.revision, anchor: s.anchor, bearing: s.bearing, positions: s.positions })
      : await client.send('threat-coa.place', {
        modelId: s.model.id, play: s.play, anchor: s.anchor, bearing: s.bearing, positions: s.positions, ...(name ? { name } : {}),
      });
    if (session !== s) return;
    if (!result.ok) { control.fail(describeError(result.error)); return; }
    stop();
    selection.set(result.value.id);
    onDone(result.value, { moving: s.coa !== null });
  }

  /** Zoom (keeping the centre, so the anchor stays put) until the whole play and its ranges fit. */
  function fitTo(placed) {
    const bounds = L.latLngBounds([]);
    placed.symbols.forEach((s) => bounds.extend(ll(s.position)));
    for (const g of placed.graphics) {
      if (g.points) g.points.forEach((p) => bounds.extend(ll(p)));
      else bounds.extend(L.latLng(ll(g.center)).toBounds(2 * g.radius));
    }
    if (!bounds.isValid()) return;
    const c = map.getCenter();
    const half = Math.max(Math.abs(bounds.getNorth() - c.lat), Math.abs(bounds.getSouth() - c.lat), 0.001);
    const halfLng = Math.max(Math.abs(bounds.getEast() - c.lng), Math.abs(bounds.getWest() - c.lng), 0.001);
    const around = L.latLngBounds([c.lat - half, c.lng - halfLng], [c.lat + half, c.lng + halfLng]);
    map.setView(c, Math.min(map.getBoundsZoom(around, false, L.point(60, 60)), 15), { animate: false });
  }

  const onKey = (event) => { if (event.key === 'Escape' && session) cancel(); };

  /**
   * Start previewing a play. With `coa` (a COA placed from this play), the preview starts at its
   * georeference and Apply moves or turns that COA (coa.re-place) instead of creating a new one.
   */
  function start({ model, play, coa = null }) {
    stop();
    const template = play === 'formation' ? model.formation : model.coas.find((c) => c.id === play)?.template;
    if (!template) return;
    if (coa) map.setView(ll(coa.source.anchor), map.getZoom(), { animate: false });
    const c = map.getCenter();
    session = {
      model, play, coa, anchor: coa ? { ...coa.source.anchor } : { lat: c.lat, lng: c.lng }, bearing: coa ? coa.source.bearing : 0,
      positions: coa ? coa.source.positions : template.units.some((u) => u.end) ? 'endWithMoves' : 'start', name: null,
    };
    const placed = content();
    session.name = placed.name;
    fitTo(placed);
    shapes.addTo(map);
    units.addTo(map);
    anchorMarker = L.marker(ll(session.anchor), { draggable: true, autoPan: true, icon: handleIcon('placement-anchor', '✛'), title: 'Drag to move the play', zIndexOffset: 1000 }).addTo(map);
    rotateMarker = L.marker(rotateHandleAt(), { draggable: true, icon: handleIcon('placement-rotate', '↻'), title: 'Drag to turn the direction of attack', zIndexOffset: 1000 }).addTo(map);
    anchorMarker.on('drag', () => { const p = anchorMarker.getLatLng(); session.anchor = { lat: p.lat, lng: p.lng }; rotateMarker.setLatLng(rotateHandleAt()); render(); });
    rotateMarker.on('drag', () => { const p = rotateMarker.getLatLng(); session.bearing = norm(initialBearing(session.anchor, { lat: p.lat, lng: p.lng })); control.sync(); render(); });
    rotateMarker.on('dragend', () => rotateMarker.setLatLng(rotateHandleAt()));
    map.on('zoomend moveend', placeHandles);
    document.addEventListener('keydown', onKey);
    control = buildControl(placed);
    control.addTo(map);
    render();
  }

  function stop() {
    if (!session) return;
    session = null;
    renderSeq += 1;
    map.off('zoomend moveend', placeHandles);
    document.removeEventListener('keydown', onKey);
    control?.remove();
    control = null;
    anchorMarker?.remove();
    rotateMarker?.remove();
    anchorMarker = rotateMarker = null;
    shapes.clearLayers().remove();
    units.clearLayers().remove();
  }

  function cancel() {
    if (!session) return;
    const moving = session.coa !== null; // moving a placed COA: stay on the map
    stop();
    onCancel({ moving });
  }

  return {
    start,
    cancel,
    isActive: () => session !== null,
    state: () => (session ? { anchor: { ...session.anchor }, bearing: session.bearing, positions: session.positions, play: session.play } : null),
    destroy: stop,
  };
}
