// Map view (driving adapter): base layers, the selected COA's units as milsymbol markers, and
// drag-to-move. Talks to the app only through the app client; redraws from coa.* / symbol.* events.
import { createGridLayer } from './grid-layer.js';
import { describeError } from './dom.js';
import { createSelection } from '../selection.js';
import { createPicker } from '../map-picker.js';
import { createMemoryPrefs } from '../prefs.js';
import { el } from './dom.js';

const SYMBOL_SIZE = 40;
const MESSAGE_MS = 6000;

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * @param {{ client: object, L: object, map: object, selection: object, symbolSelection?: object, picker?: object }} options
 *   symbolSelection: the unit being edited (clicking a marker selects it); picker: "Pick on map" requests;
 *   layersRoot: where the base-map choice is shown (the panel's Map section); prefs remembers the choice.
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountMapView({ client, L, map, selection, symbolSelection = createSelection(), picker = createPicker(), layersRoot = null, prefs = createMemoryPrefs() }) {
  let destroyed = false;
  let shownCoaId = null;
  let showSeq = 0;
  let fitPending = false; // fit once the selected COA has units (it may have none yet)
  const previews = new Map(); // "sidc|label|modifiers" → Promise<icon options | null>

  // ---- layers and controls ----
  const grid = createGridLayer(L, { lineColor: cssVar('--color-border', '#a9ada3'), labelColor: cssVar('--color-text-muted', '#5b6157') });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const baseLayers = { grid: { label: 'Grid (offline)', layer: grid }, osm: { label: 'OpenStreetMap (online)', layer: osm } };
  let base = prefs.get('baseLayer', 'grid') in baseLayers ? prefs.get('baseLayer', 'grid') : 'grid';
  const useBase = (key) => {
    for (const [k, { layer }] of Object.entries(baseLayers)) {
      if (k === key) map.addLayer(layer); else map.removeLayer(layer);
    }
    base = key;
    prefs.set('baseLayer', key);
  };
  useBase(base);
  layersRoot?.replaceChildren(el('fieldset', { class: 'base-layers' },
    el('legend', { class: 'placeholder', text: 'Base map' }),
    ...Object.entries(baseLayers).map(([key, { label }]) => el('label', {},
      el('input', { attrs: { type: 'radio', name: 'base-layer', value: key, checked: key === base }, on: { change: () => useBase(key) } }),
      el('span', { text: label })))));
  const units = L.layerGroup().addTo(map);

  let messageEl;
  let messageTimer;
  const messageControl = L.control({ position: 'bottomleft' });
  messageControl.onAdd = () => {
    messageEl = L.DomUtil.create('div', 'map-message');
    messageEl.setAttribute('role', 'status');
    return messageEl;
  };
  messageControl.addTo(map);
  const say = (text) => {
    messageEl.textContent = text;
    clearTimeout(messageTimer);
    if (text) messageTimer = setTimeout(() => { messageEl.textContent = ''; }, MESSAGE_MS);
  };

  // ---- markers ----
  function iconOptionsFor(symbol) {
    const key = JSON.stringify([symbol.sidc, symbol.label, symbol.modifiers]);
    if (!previews.has(key)) {
      previews.set(key, client.ask('symbol.preview', { sidc: symbol.sidc, label: symbol.label, modifiers: symbol.modifiers, size: SYMBOL_SIZE })
        .then((r) => (r.ok ? {
          html: r.value.svg, // renderer SVG (milsymbol escapes label and modifier text)
          className: 'unit-marker',
          iconSize: [Math.round(r.value.width), Math.round(r.value.height)],
          iconAnchor: [Math.round(r.value.anchor.x), Math.round(r.value.anchor.y)],
        } : null)));
    }
    return previews.get(key);
  }

  function addMarker(coaId, symbol, iconOptions) {
    const marker = L.marker([symbol.position.lat, symbol.position.lng], {
      icon: iconOptions ? L.divIcon(iconOptions) : new L.Icon.Default(),
      draggable: true,
      title: symbol.label || symbol.sidc,
      riseOnHover: true,
    }).addTo(units);
    marker.getElement().dataset.symbolId = symbol.id;
    marker.getElement().classList.add('unit-marker');
    marker.getElement().classList.toggle('is-selected', symbol.id === symbolSelection.get());
    marker.on('click', () => symbolSelection.set(symbol.id));
    marker.on('dragend', async () => {
      const { lat, lng } = marker.getLatLng();
      const result = await client.send('symbol.move', { coaId, symbolId: symbol.id, position: { lat, lng } });
      if (!result.ok && !destroyed) {
        marker.setLatLng([symbol.position.lat, symbol.position.lng]); // snap back
        say(`Move not saved: ${describeError(result.error)}`);
      }
    });
  }

  async function show(coaId, { fit }) {
    const seq = ++showSeq;
    if (fit) fitPending = true;
    if (coaId === null) { units.clearLayers(); shownCoaId = null; return; }
    const result = await client.ask('coa.get', { coaId });
    if (destroyed || seq !== showSeq) return;
    if (!result.ok) {
      units.clearLayers();
      shownCoaId = null;
      if (result.error.code !== 'NOT_FOUND') say(describeError(result.error));
      return;
    }
    const coa = result.value;
    const icons = await Promise.all(coa.symbols.map(iconOptionsFor));
    if (destroyed || seq !== showSeq) return;
    units.clearLayers();
    coa.symbols.forEach((symbol, i) => addMarker(coa.id, symbol, icons[i]));
    shownCoaId = coa.id;
    if (fitPending && coa.symbols.length > 0) {
      fitPending = false;
      map.fitBounds(L.latLngBounds(coa.symbols.map((s) => [s.position.lat, s.position.lng])), { padding: [48, 48], maxZoom: 12 });
    }
  }

  // ---- unit selection and "Pick on map" ----
  const markSelected = (id) => {
    units.eachLayer((marker) => {
      const selected = marker.getElement()?.dataset.symbolId === id;
      marker.getElement()?.classList.toggle('is-selected', selected);
      if (selected && !map.getBounds().contains(marker.getLatLng())) map.panTo(marker.getLatLng());
    });
  };
  const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
  const onMapClick = (event) => {
    if (picker.isActive()) picker.resolve({ lat: event.latlng.lat, lng: wrapLng(event.latlng.lng) });
  };
  const onKeydown = (event) => { if (event.key === 'Escape' && picker.isActive()) picker.cancel(); };
  map.on('click', onMapClick);
  document.addEventListener('keydown', onKeydown);

  // ---- wiring ----
  const coaIdOf = (event) => event.payload.coaId ?? event.payload.coa?.id;
  const onChange = (event) => { if (shownCoaId !== null && coaIdOf(event) === shownCoaId) show(shownCoaId, { fit: false }); };
  const unsubscribes = [
    client.subscribe('symbol.*', onChange),
    client.subscribe('coa.*', onChange),
    selection.subscribe((id) => show(id, { fit: true })),
    symbolSelection.subscribe(markSelected),
    picker.subscribe((active) => map.getContainer().classList.toggle('is-picking', active)),
  ];

  return {
    ready: show(selection.get(), { fit: true }),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      clearTimeout(messageTimer);
      map.off('click', onMapClick);
      document.removeEventListener('keydown', onKeydown);
      map.getContainer().classList.remove('is-picking');
      [units, grid, osm].forEach((layer) => map.removeLayer(layer));
      layersRoot?.replaceChildren();
      messageControl.remove();
    },
  };
}
