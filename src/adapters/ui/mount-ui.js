// Mounts the UI on the shell markup in index.html (a driving adapter): one tools panel on the left
// with collapsible sections (COAs, Units, Map, Export), the storage status, the Leaflet map and the views.
// Views talk to the application only through the app client and share UI state: which COA is
// active (`selection`), which unit is being edited (`symbolSelection`) and "Pick on map" (`picker`).
import { createSelection } from './selection.js';
import { createPicker } from './map-picker.js';
import { createPrefs } from './prefs.js';
import { mountCoaListView } from './views/coa-list-view.js';
import { mountMapView } from './views/map-view.js';
import { mountSymbolEditorView } from './views/symbol-editor-view.js';
import { mountExportView } from './views/export-view.js';

/**
 * @param {{ client: object, L: object, root: HTMLElement, storageLabel?: string, narrow?: boolean, prefs?: object }} options
 *   narrow: small-screen mode (panel starts closed and slides over the map); defaults to a media query.
 *   prefs: per-viewer UI preferences; defaults to browser storage.
 * @returns {{ map: object, selection: object, symbolSelection: object, picker: object, ready: Promise<void>, destroy: () => void }}
 */
export function mountUi({ client, L, root, storageLabel = '', narrow, prefs }) {
  if (!(root instanceof HTMLElement)) throw new TypeError('mountUi: a root element is required');
  if (typeof L?.map !== 'function') throw new TypeError('mountUi: Leaflet (L) is required');

  const win = root.ownerDocument.defaultView;
  const uiPrefs = prefs ?? createPrefs(win.localStorage);
  const isNarrow = narrow ?? win.matchMedia('(max-width: 720px)').matches;
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
  setPanelOpen(!isNarrow);
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
  const summary = (name) => root.querySelector(`[data-section="${name}"] [data-summary]`);
  const views = [
    mountCoaListView({ client, root: root.querySelector('[data-region="coa-list"]'), selection, levels: true, prefs: uiPrefs, summary: summary('coas') }),
    mountMapView({ client, L, map, selection, symbolSelection, picker, layersRoot: root.querySelector('[data-region="map-layers"]'), prefs: uiPrefs }),
    mountSymbolEditorView({ client, root: root.querySelector('[data-region="symbol-editor"]'), selection, symbolSelection, picker }),
    mountExportView({ client, root: root.querySelector('[data-region="export"]'), L, map, selection, prefs: uiPrefs }),
  ];

  // On a narrow screen the panel covers the map: step aside while picking a position.
  let reopenPanel = false;
  cleanups.push(picker.subscribe((active) => {
    if (!isNarrow) return;
    if (active) {
      reopenPanel = panelToggle.getAttribute('aria-expanded') === 'true';
      setPanelOpen(false);
    } else if (reopenPanel) {
      reopenPanel = false;
      setPanelOpen(true);
    }
  }));

  return {
    map,
    selection,
    symbolSelection,
    picker,
    ready: Promise.all(views.map((v) => v.ready)).then(() => {}),
    destroy() {
      views.forEach((v) => v.destroy());
      cleanups.forEach((off) => off());
      map.remove();
    },
  };
}
