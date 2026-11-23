// Map view (driving adapter): base layers, the selected COA's units as milsymbol markers, and
// drag-to-move. Talks to the app only through the app client; redraws from coa.* / symbol.* events.
import { createGridLayer } from './grid-layer.js';
import { describeError } from './dom.js';
import { createSelection } from '../selection.js';
import { createPicker } from '../map-picker.js';
import { createMemoryPrefs } from '../prefs.js';
import { el } from './dom.js';
import { createActiveCoa } from '../active-coa.js';
import { wrapLng } from '../../../shared/values.js';
import { createMapMessage } from './map-message.js';

const SYMBOL_SIZE = 40;

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * @param {{ client: object, L: object, map: object, selection: object, symbolSelection?: object, picker?: object }} options
 *   symbolSelection: the unit being edited (clicking a marker selects it); picker: "Pick on map" requests;
 *   layersRoot: where the base-map choice is shown (the panel's Map section); prefs remembers the choice.
 *   activeCoa: the shared active-COA store (one is created when the view is mounted on its own).
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountMapView({ client, L, map, selection, symbolSelection = createSelection(), picker = createPicker(), layersRoot = null, prefs = createMemoryPrefs(), activeCoa }) {
  let destroyed = false;
  let showSeq = 0;
  const ownStore = activeCoa ? null : createActiveCoa({ client, selection });
  const store = activeCoa ?? ownStore;
  let fitPending = false; // fit once the selected COA has units (it may have none yet)
  const previews = new Map(); // "sidc|label|modifiers" → Promise<icon options | null>

  // ---- layers and controls ----
  const grid = createGridLayer(L, { lineColor: cssVar('--color-border', '#a9ada3'), labelColor: cssVar('--color-text-muted', '#5b6157') });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const baseLayers = { grid: { label: 'Grid', layer: grid }, osm: { label: 'OpenStreetMap', layer: osm } };
  let base = prefs.get('baseLayer', 'grid') in baseLayers ? prefs.get('baseLayer', 'grid') : 'grid';
  const useBase = (key) => {
    for (const [k, { layer }] of Object.entries(baseLayers)) {
      if (k === key) map.addLayer(layer); else map.removeLayer(layer);
    }
    base = key;
    prefs.set('baseLayer', key);
  };
  useBase(base);
  const setTranslucent = (on) => {
    map.getContainer().classList.toggle('units-translucent', on);
    prefs.set('translucentUnits', on);
  };
  const translucent = prefs.get('translucentUnits', false) === true;
  setTranslucent(translucent);
  layersRoot?.replaceChildren(
    el('fieldset', { class: 'group' },
      el('legend', { text: 'Base map' }),
      el('div', { class: 'segmented' },
        ...Object.entries(baseLayers).map(([key, { label }]) => el('label', {},
          el('input', { attrs: { type: 'radio', name: 'base-layer', value: key, checked: key === base }, on: { change: () => useBase(key) } }),
          el('span', { text: label })))),
      el('p', { class: 'hint', text: 'The grid works offline; OpenStreetMap needs the internet.' }),
      el('label', { class: 'check' },
        el('input', { attrs: { type: 'checkbox', name: 'translucent-units', checked: translucent }, on: { change: (e) => setTranslucent(e.target.checked) } }),
        el('span', { text: 'Semi-transparent units (50%)' }))));
  const units = L.layerGroup().addTo(map);

  const message = createMapMessage(L, map);
  const say = message.say;

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

  /** Everything on the COA: units, line and area points, and ring extents. */
  function extentOf(coa) {
    const points = coa.symbols.map((s) => [s.position.lat, s.position.lng]);
    for (const g of coa.graphics) {
      if (g.points) points.push(...g.points.map((p) => [p.lat, p.lng]));
      else {
        const ring = L.latLng(g.center.lat, g.center.lng).toBounds(g.radius * 2); // a square around the ring
        points.push([ring.getSouth(), ring.getWest()], [ring.getNorth(), ring.getEast()]);
      }
    }
    return points;
  }

  /** Show the active COA (from the shared store). Fits the map when a different COA was selected. */
  async function apply(coa, { switched = false, error = null } = {}) {
    const seq = ++showSeq;
    if (switched) fitPending = true;
    if (error) say(describeError(error));
    if (coa === null) { units.clearLayers(); return; }
    const icons = await Promise.all(coa.symbols.map(iconOptionsFor));
    if (destroyed || seq !== showSeq) return;
    units.clearLayers();
    coa.symbols.forEach((symbol, i) => addMarker(coa.id, symbol, icons[i]));
    const extent = extentOf(coa);
    if (fitPending && extent.length > 0) {
      fitPending = false;
      map.fitBounds(L.latLngBounds(extent), { padding: [48, 48], maxZoom: 12 });
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
  const onMapClick = (event) => {
    if (picker.isActive()) picker.resolve({ lat: event.latlng.lat, lng: wrapLng(event.latlng.lng) });
  };
  const onKeydown = (event) => { if (event.key === 'Escape' && picker.isActive()) picker.cancel(); };
  // While picking, say so on the map (on a narrow screen the panel steps aside, so this is all you see).
  let pickHint = null;
  const showPickHint = (active) => {
    pickHint?.remove();
    pickHint = null;
    if (!active || destroyed) return;
    pickHint = L.control({ position: 'topright' });
    pickHint.onAdd = () => {
      const box = L.DomUtil.create('div', 'pick-hint');
      box.dataset.pickHint = '';
      box.setAttribute('role', 'status');
      box.append('Click the map to place the unit ');
      const cancel = L.DomUtil.create('button', 'link', box);
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      L.DomEvent.disableClickPropagation(box); // a click on the hint is not a pick
      L.DomEvent.on(cancel, 'click', () => picker.cancel());
      return box;
    };
    pickHint.addTo(map);
  };
  map.on('click', onMapClick);
  document.addEventListener('keydown', onKeydown);

  // ---- wiring ----
  const unsubscribes = [
    store.subscribe(apply),
    symbolSelection.subscribe(markSelected),
    picker.subscribe((active) => { map.getContainer().classList.toggle('is-picking', active); showPickHint(active); }),
  ];

  return {
    ready: store.ready.then(() => apply(store.get(), { switched: true })),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      ownStore?.destroy();
      message.remove();
      pickHint?.remove();
      map.off('click', onMapClick);
      document.removeEventListener('keydown', onKeydown);
      map.getContainer().classList.remove('is-picking', 'units-translucent');
      [units, grid, osm].forEach((layer) => map.removeLayer(layer));
      layersRoot?.replaceChildren();
    },
  };
}
