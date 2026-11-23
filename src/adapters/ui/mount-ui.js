// Mounts the UI on the shell markup in index.html (a driving adapter): one tools panel on the left
// with collapsible sections (COAs, Units, Lines & areas, Map, Export), the storage status, the Leaflet map and the views.
// Views talk to the application only through the app client and share UI state: which COA is
// active (`selection`), which unit is being edited (`symbolSelection`), which line/area is selected
// (`graphicSelection`), "Pick on map" (`picker`) and "Draw on map" (`drawer`).
import { createSelection } from './selection.js';
import { createPicker } from './map-picker.js';
import { createDrawer } from './map-drawer.js';
import { createPrefs } from './prefs.js';
import { mountCoaListView } from './views/coa-list-view.js';
import { mountMapView } from './views/map-view.js';
import { mountSymbolEditorView } from './views/symbol-editor-view.js';
import { mountExportView } from './views/export-view.js';
import { mountGraphicsLayer } from './views/graphics-layer.js';
import { mountDrawTool } from './views/draw-tool.js';
import { mountGraphicsView } from './views/graphics-view.js';

/**
 * @param {{ client: object, L: object, root: HTMLElement, storageLabel?: string, narrow?: boolean, media?: object, prefs?: object }} options
 *   narrow: fixes small-screen mode (panel starts closed and slides over the map). Without it the mode
 *   follows `media` (default: the same max-width query as the CSS), also when the window is resized.
 *   prefs: per-viewer UI preferences; defaults to browser storage.
 * @returns {{ map: object, selection: object, symbolSelection: object, graphicSelection: object, picker: object, drawer: object, ready: Promise<void>, destroy: () => void }}
 */
export function mountUi({ client, L, root, storageLabel = '', narrow, media, prefs }) {
  if (!(root instanceof HTMLElement)) throw new TypeError('mountUi: a root element is required');
  if (typeof L?.map !== 'function') throw new TypeError('mountUi: Leaflet (L) is required');

  const win = root.ownerDocument.defaultView;
  const uiPrefs = prefs ?? createPrefs(win.localStorage);
  const query = narrow === undefined ? (media ?? win.matchMedia('(max-width: 720px)')) : null;
  const isNarrow = () => narrow ?? query.matches;
  const map = L.map(root.querySelector('#map'), { center: [20, 0], zoom: 2, worldCopyJump: true });
  const cleanups = [];
  const listen = (target, type, fn) => { target.addEventListener(type, fn); cleanups.push(() => target.removeEventListener(type, fn)); };

  // ---- the panel ----
  const panel = root.querySelector('#side-panel');
  const panelToggle = root.querySelector('[aria-controls="side-panel"]');
  const setPanelOpen = (open) => {
    panelToggle.setAttribute('aria-expanded', String(open));
    panel.dataset.open = String(open);
    map.invalidateSize();
  };
  setPanelOpen(!isNarrow());
  listen(panelToggle, 'click', () => setPanelOpen(panelToggle.getAttribute('aria-expanded') !== 'true'));

  // ---- collapsible sections (remembered per browser) ----
  const collapsed = new Set(uiPrefs.get('collapsedSections', []));
  for (const section of root.querySelectorAll('[data-section]')) {
    const toggle = section.querySelector('.section-toggle');
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      section.dataset.open = String(open);
    };
    setOpen(!collapsed.has(section.dataset.section));
    listen(toggle, 'click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      setOpen(open);
      if (open) collapsed.delete(section.dataset.section); else collapsed.add(section.dataset.section);
      uiPrefs.set('collapsedSections', [...collapsed]);
    });
  }

  root.querySelector('[data-storage-status]').textContent = storageLabel;
  map.invalidateSize();

  // ---- views ----
  const selection = createSelection();
  const symbolSelection = createSelection();
  const picker = createPicker();
  const graphicSelection = createSelection();
  const drawer = createDrawer();
  const summary = (name) => root.querySelector(`[data-section="${name}"] [data-summary]`);
  const views = [
    mountCoaListView({ client, root: root.querySelector('[data-region="coa-list"]'), selection, levels: true, prefs: uiPrefs, summary: summary('coas') }),
    mountMapView({ client, L, map, selection, symbolSelection, picker, layersRoot: root.querySelector('[data-region="map-layers"]'), prefs: uiPrefs }),
    mountSymbolEditorView({ client, root: root.querySelector('[data-region="symbol-editor"]'), selection, symbolSelection, picker }),
    mountGraphicsLayer({ client, L, map, selection, graphicSelection, drawer }),
    mountDrawTool({ L, map, drawer }),
    mountGraphicsView({ client, root: root.querySelector('[data-region="graphics"]'), selection, graphicSelection, drawer }),
    mountExportView({ client, root: root.querySelector('[data-region="export"]'), L, map, selection, prefs: uiPrefs }),
  ];

  // Picking a position and drawing both take the next map clicks: starting one stops the other.
  cleanups.push(picker.subscribe((active) => { if (active) drawer.cancel(); }));
  cleanups.push(drawer.subscribe((request) => { if (request) picker.cancel(); }));

  // Keep Leaflet's idea of the map size right when the layout switches between wide and narrow.
  if (query) listen(query, 'change', () => map.invalidateSize());

  // On a narrow screen the panel covers the map: step aside while picking a position or drawing.
  let reopenPanel = false;
  const stepAside = (active) => {
    if (active && isNarrow()) {
      if (panelToggle.getAttribute('aria-expanded') === 'true') reopenPanel = true;
      setPanelOpen(false);
    } else if (!active && reopenPanel && !picker.isActive() && !drawer.isActive()) {
      reopenPanel = false; // brought back even if the window was widened meanwhile
      setPanelOpen(true);
    }
  };
  cleanups.push(picker.subscribe((active) => stepAside(active)));
  cleanups.push(drawer.subscribe((request) => stepAside(request !== null)));

  return {
    map,
    selection,
    symbolSelection,
    graphicSelection,
    picker,
    drawer,
    ready: Promise.all(views.map((v) => v.ready)).then(() => {}),
    destroy() {
      views.forEach((v) => v.destroy());
      cleanups.forEach((off) => off());
      map.remove();
    },
  };
}
