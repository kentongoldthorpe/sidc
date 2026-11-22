// Map view (driving adapter): base layers, the selected COA's units as milsymbol markers, and
// drag-to-move. Talks to the app only through the app client; redraws from coa.* / symbol.* events.
import { createGridLayer } from './grid-layer.js';
import { describeError } from './dom.js';

const SYMBOL_SIZE = 40;
const MESSAGE_MS = 6000;

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * @param {{ client: object, L: object, map: object, selection: object }} options
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountMapView({ client, L, map, selection }) {
  let destroyed = false;
  let shownCoaId = null;
  let showSeq = 0;
  const previews = new Map(); // "sidc|label|modifiers" → Promise<icon options | null>

  // ---- layers and controls ----
  const grid = createGridLayer(L, { lineColor: cssVar('--color-border', '#a9ada3'), labelColor: cssVar('--color-text-muted', '#5b6157') }).addTo(map);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const layerControl = L.control.layers({ 'Grid (offline)': grid, 'OpenStreetMap (online)': osm }, null, { position: 'topright' }).addTo(map);
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
    if (fit && coa.symbols.length > 0) {
      map.fitBounds(L.latLngBounds(coa.symbols.map((s) => [s.position.lat, s.position.lng])), { padding: [48, 48], maxZoom: 12 });
    }
  }

  // ---- wiring ----
  const coaIdOf = (event) => event.payload.coaId ?? event.payload.coa?.id;
  const onChange = (event) => { if (shownCoaId !== null && coaIdOf(event) === shownCoaId) show(shownCoaId, { fit: false }); };
  const unsubscribes = [
    client.subscribe('symbol.*', onChange),
    client.subscribe('coa.*', onChange),
    selection.subscribe((id) => show(id, { fit: true })),
  ];

  return {
    ready: show(selection.get(), { fit: true }),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      clearTimeout(messageTimer);
      [units, grid, osm].forEach((layer) => map.removeLayer(layer));
      layerControl.remove();
      messageControl.remove();
    },
  };
}
