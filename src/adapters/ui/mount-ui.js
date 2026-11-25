// Mounts the UI on the shell markup in index.html (a driving adapter): one tools panel on the left
// with collapsible sections (COAs, Units, Lines & areas, Map, Export), the storage status, the Leaflet map and the views.
// Views talk to the application only through the app client and share UI state: which COA is
// active (`selection`), which unit is being edited (`symbolSelection`), which line/area is selected
// (`graphicSelection`), "Pick on map" (`picker`) and "Draw on map" (`drawer`).
import { describeError } from './views/dom.js';
import { createSelection } from './selection.js';
import { createPicker } from './map-picker.js';
import { createDrawer } from './map-drawer.js';
import { createActiveCoa } from './active-coa.js';
import { createStorageHealth } from './storage-health.js';
import { backupAllCoas } from './backup.js';
import { mountStorageBanner } from './views/storage-banner.js';
import { createUndoHistory } from './undo-history.js';
import { mountUndoControls } from './views/undo-controls.js';
import { createCrossWindowSync } from './cross-window-sync.js';
import { mountKeyboardShortcuts } from './views/keyboard-shortcuts.js';
import { mountUnitTemplatesView } from './views/unit-templates-view.js';
import { mountWeatherForecastsView } from './views/weather-forecasts-view.js';
import { mountWeatherCriteriaView } from './views/weather-criteria-view.js';
import { mountWeatherBoard } from './views/weather-board.js';
import { createThreatModelStore } from './threat-model-store.js';
import { mountTemplateCanvas } from './views/template-canvas.js';
import { mountThreatModelsView } from './views/threat-models-view.js';
import { mountTemplateEditorView } from './views/template-editor-view.js';
import { mountPlacementPreview } from './views/placement-preview.js';
import { mountProjectsView } from './views/projects-view.js';
import { mountThreatCoasView } from './views/threat-coas-view.js';
import { VERSION, BUILD } from '../../shared/version.js';
import { downloadBlob } from '../export/paint-slide.js';
import { createPrefs } from './prefs.js';
import { mountCoaListView } from './views/coa-list-view.js';
import { mountMapView } from './views/map-view.js';
import { mountSymbolEditorView } from './views/symbol-editor-view.js';
import { mountExportView } from './views/export-view.js';
import { mountGraphicsLayer } from './views/graphics-layer.js';
import { mountDrawTool } from './views/draw-tool.js';
import { mountGraphicsView } from './views/graphics-view.js';
import { createSnapSettings, createSnapper, coaSnapTargets, latLngGrid } from './snapper.js';
import { mountSnapControl } from './views/snap-control.js';
import { mountCoaVersionView } from './views/coa-version-view.js';
import { mountWorksheetsView } from './views/worksheets-view.js';
import { stepFor } from './views/grid-layer.js';
import { createMgrsLayer } from './views/mgrs-layer.js';

/**
 * @param {{ client: object, L: object, root: HTMLElement, storageLabel?: string, narrow?: boolean, media?: object, prefs?: object,
 *           saveFile?: (blob: Blob, name: string) => Promise<void>, openProject?: (projectId: string) => void }} options
 *   openProject: start the app inside another project (D27); main.js remembers it and reloads.
 *   saveFile: where exported and backup files go (default: a browser download).
 *   narrow: fixes small-screen mode (panel starts closed and slides over the map). Without it the mode
 *   follows `media` (default: the same max-width query as the CSS), also when the window is resized.
 *   prefs: per-viewer UI preferences; defaults to browser storage.
 * @returns {{ map: object, selection: object, symbolSelection: object, graphicSelection: object, picker: object, drawer: object, ready: Promise<void>, destroy: () => void }}
 */
export function mountUi({ client: appClient, L, root, storageLabel = '', narrow, media, prefs, saveFile = (blob, name) => downloadBlob(blob, name), openProject = () => {} }) {
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
  // A section marked data-open="false" in the markup starts collapsed until the viewer opens it.
  const startCollapsed = [...root.querySelectorAll('[data-section][data-open="false"]')].map((section) => section.dataset.section);
  const collapsed = new Set(uiPrefs.get('collapsedSections', startCollapsed));
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
  root.querySelector('.app-title').title = `COA Builder ${VERSION} (build ${BUILD})`;
  map.invalidateSize();

  // ---- views ----
  const selection = createSelection();
  const symbolSelection = createSelection();
  const picker = createPicker();
  const graphicSelection = createSelection();
  const drawer = createDrawer();
  // Every view talks through the health-watching client, so any storage failure raises the banner.
  const health = createStorageHealth(appClient);
  const client = health.client;
  const activeCoa = createActiveCoa({ client, selection }); // one load per change, shared by the views
  // Snapping (B-2): one set of settings for the map and the template canvas, remembered per browser.
  const snapSettings = createSnapSettings(uiPrefs);
  // The grid snapped to is the MGRS grid when it is shown (and fine enough at this zoom), else the lat/long grid.
  const mgrsGrid = createMgrsLayer(L);
  const latLngGridAt = latLngGrid(map, stepFor);
  const snapper = createSnapper({ L, map, settings: snapSettings, targets: () => coaSnapTargets(activeCoa.get()), gridAt: (ll) => mgrsGrid.snap(ll) ?? latLngGridAt(ll) });
  const snapControl = mountSnapControl({ L, map, settings: snapSettings });
  cleanups.push(() => { snapControl.destroy(); snapper.destroy(); });
  const backup = () => backupAllCoas({ client, activeCoa, saveFile });
  const history = createUndoHistory({ client, activeCoa }); // undo/redo per selected COA (D19)
  const summary = (name) => root.querySelector(`[data-section="${name}"] [data-summary]`);
  const coaList = mountCoaListView({ client, root: root.querySelector('[data-region="coa-list"]'), selection, levels: true, prefs: uiPrefs, summary: summary('coas'), backup });
  const exportView = mountExportView({ client, root: root.querySelector('[data-region="export"]'), L, map, selection, prefs: uiPrefs, activeCoa, saveFile });
  const projectsView = mountProjectsView({ client, root: root.querySelector('[data-region="projects"]'), summary: summary('project'), headerName: root.querySelector('[data-project-name]'), onOpen: openProject, saveFile });
  // ---- Weather workspace (Epic 4): forecasts and critical values in the panel, the board beside ----
  const forecastSelection = createSelection(uiPrefs.get('weatherForecast', null));
  cleanups.push(forecastSelection.subscribe((id) => uiPrefs.set('weatherForecast', id)));
  const forecastsView = mountWeatherForecastsView({ client, root: root.querySelector('[data-region="weather-forecasts"]'), forecastSelection, summary: summary('weather-forecasts'), saveFile });
  const criteriaView = mountWeatherCriteriaView({ client, root: root.querySelector('[data-region="weather-criteria"]'), summary: summary('weather-criteria') });
  const weatherBoard = mountWeatherBoard({ client, root: root.querySelector('#weather-board'), forecastSelection });
  const templatesView = mountUnitTemplatesView({ client, root: root.querySelector('[data-region="unit-templates"]'), saveFile, summary: summary('unit-templates') });

  // ---- Threat models workspace (Epic 3): models, the template canvas (metres, no terrain), the editor ----
  const modelSelection = createSelection(uiPrefs.get('threatModel', null));
  const unitSelection = createSelection();
  const playSelection = createSelection('formation'); // the formation, or one threat COA's play
  const threatStore = createThreatModelStore({ client, modelSelection, playSelection });
  const canvas = mountTemplateCanvas({ client, L, container: root.querySelector('#template-canvas'), store: threatStore, unitSelection, snapSettings });
  const modelsView = mountThreatModelsView({ client, root: root.querySelector('[data-region="threat-models"]'), modelSelection, store: threatStore, saveFile });
  // Place on map (T-5): the play is previewed on the main map; placing it creates and selects a SITTEMP COA.
  const placement = mountPlacementPreview({
    client, L, map, selection,
    onDone: (coa, { moving = false } = {}) => undoControls.note(`${moving ? 'Moved' : 'Placed'} ${coa.name}`),
    onCancel: ({ moving = false } = {}) => { if (!moving && root.dataset.workspace !== 'threat') setWorkspace('threat'); },
  });
  cleanups.push(() => placement.destroy());
  const placeOnMap = (play) => {
    const model = threatStore.get();
    if (!model) return;
    setWorkspace('map');
    placement.start({ model, play });
  };
  // Move or turn a placed COA (D30): the same preview, starting where the COA is.
  const rePlaceOnMap = async (coa) => {
    const got = await client.ask('threat-model.get', { modelId: coa.source.threatModelId });
    if (!got.ok) { undoControls.note(describeError(got.error)); return; }
    setWorkspace('map');
    placement.start({ model: got.value, play: coa.source.play, coa });
  };
  const threatCoasView = mountThreatCoasView({ client, root: root.querySelector('[data-region="threat-coas"]'), store: threatStore, onPlace: placeOnMap, saveFile, gridStep: () => snapSettings.get().templateGrid });
  const templateEditor = mountTemplateEditorView({ client, root: root.querySelector('[data-region="template-editor"]'), store: threatStore, unitSelection, canvas });
  cleanups.push(modelSelection.subscribe((id) => uiPrefs.set('threatModel', id)));
  cleanups.push(() => threatStore.destroy());
  const undoControls = mountUndoControls({ root: root.querySelector('[data-region="history"]'), history });
  const views = [
    projectsView,
    coaList,
    mountCoaVersionView({ client, root: root.querySelector('[data-region="coa-version"]'), activeCoa }), // E6-3
    mountWorksheetsView({ client, root: root.querySelector('[data-region="worksheets"]'), activeCoa, prefs: uiPrefs, saveFile }), // E6-2
    mountMapView({ client, L, map, selection, symbolSelection, picker, layersRoot: root.querySelector('[data-region="map-layers"]'), prefs: uiPrefs, activeCoa, snapper, mgrsGrid }),
    mountSymbolEditorView({ client, root: root.querySelector('[data-region="symbol-editor"]'), selection, symbolSelection, picker, activeCoa, onRePlace: rePlaceOnMap }),
    mountGraphicsLayer({ client, L, map, selection, graphicSelection, drawer, activeCoa, snapper }),
    mountDrawTool({ L, map, drawer, snapper }),
    mountGraphicsView({ client, root: root.querySelector('[data-region="graphics"]'), selection, graphicSelection, drawer, activeCoa }),
    exportView,
    templatesView,
    forecastsView,
    criteriaView,
    weatherBoard,
    canvas,
    modelsView,
    threatCoasView,
    templateEditor,
    mountStorageBanner({ root: root.querySelector('.app-main'), health, backup }),
    undoControls,
    mountKeyboardShortcuts({ client, map, activeCoa, symbolSelection, graphicSelection, picker, drawer, note: (text) => undoControls.note(text) }),
  ];
  // Other windows of this app (same person, D20): show their changes here as they happen.
  const sync = createCrossWindowSync({
    client, win, activeCoa,
    refreshList: () => { projectsView.refresh(); coaList.refresh(); templatesView.refresh(); forecastsView.refresh(); criteriaView.refresh(); weatherBoard.refresh(); modelsView.refresh(); threatStore.refresh(); }, refreshSettings: () => exportView.refreshSettings(), onUpdated: (text) => undoControls.note(text),
  });
  cleanups.push(() => sync.destroy());

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
  cleanups.push(canvas.picker.subscribe((active) => stepAside(active)));
  cleanups.push(canvas.drawer.subscribe((request) => stepAside(request !== null)));

  // ---- workspace: Map | Threat models (remembered per browser) ----
  const switchInputs = [...root.querySelectorAll('[data-workspace-switch] input')];
  const setWorkspace = (name) => {
    root.dataset.workspace = name;
    switchInputs.forEach((input) => { input.checked = input.value === name; });
    uiPrefs.set('workspace', name);
    if (name !== 'map') { picker.cancel(); drawer.cancel(); placement.cancel(); }
    if (name !== 'threat') { canvas.picker.cancel(); canvas.drawer.cancel(); }
    if (name === 'threat') canvas.invalidate(); else if (name === 'map') map.invalidateSize();
  };
  switchInputs.forEach((input) => listen(input, 'change', () => setWorkspace(input.value)));
  setWorkspace(['threat', 'weather'].includes(uiPrefs.get('workspace', 'map')) ? uiPrefs.get('workspace', 'map') : 'map');

  return {
    map,
    selection,
    symbolSelection,
    graphicSelection,
    picker,
    drawer,
    health,
    history,
    modelSelection,
    playSelection,
    unitSelection,
    canvas,
    setWorkspace,
    ready: Promise.all(views.map((v) => v.ready)).then(() => {}),
    destroy() {
      views.forEach((v) => v.destroy());
      history.destroy();
      activeCoa.destroy();
      health.destroy();
      cleanups.forEach((off) => off());
      map.remove();
    },
  };
}
