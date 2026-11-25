// Export view (driving adapter): the slide frame (shared, or a COA's own), its aspect ratio, the
// classification marking, and the frame drawn on the map with the outside shaded.
import { el, describeError } from './dom.js';
import { coalesce } from './coalesce.js';
import { createMemoryPrefs } from '../prefs.js';
import { ASPECTS } from '../../../domain/frame.js';
import { textColorOn } from '../../export/colors.js';
import { layoutSlide, formatDtg, slideFileName, mapAreaRatio } from '../../export/slide-layout.js';
import { paintSlide, canvasToPng, downloadBlob, svgToPng } from '../../export/paint-slide.js';
import { buildKmz } from '../../exchange/kmz.js';
import { DATA_FORMATS, writeCoaData, titleOf } from '../../files/coa-data.js';
import { wrapLng } from '../../../shared/values.js';
import { createActiveCoa } from '../active-coa.js';

/** The format each data file names in its header. */
const HEADER_FORMATS = Object.freeze({ json: ['coa-builder/import', 1], geojson: ['coa-builder/geojson', 2], csv: ['csv', 1], weapons: ['coa-builder/weapons-csv', 1], kml: ['kml', 1], kmz: ['kmz', 1] });
const ICON_SIZE = 48; // a KMZ unit icon, in pixels
const SLIDE_SYMBOL_SIZE = 40; // symbol size on a 1080-pixel-high slide (scaled for other heights)

const VIEW_MARGIN = 0.94; // "from current view": the largest frame that fits, with a small margin
const MARKING_PRESETS = Object.freeze([
  ['UNCLASSIFIED (green)', '#007a33'], ['CUI (purple)', '#502b85'], ['CONFIDENTIAL (blue)', '#0033a0'],
  ['SECRET (red)', '#c8102e'], ['TOP SECRET (orange)', '#ff8c00'],
]);

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

/** Geographic bounds of a frame, using the map's projection (Web Mercator) at zoom 0. */
export function frameBounds(L, map, frame) {
  const centre = map.project([frame.center.lat, frame.center.lng], 0);
  const halfWidth = (frame.width / 360) * 256 / 2;
  const halfHeight = halfWidth / mapAreaRatio(frame.aspect); // the slide's map area: what you frame is what you get
  return L.latLngBounds(
    map.unproject([centre.x - halfWidth, centre.y + halfHeight], 0),
    map.unproject([centre.x + halfWidth, centre.y - halfHeight], 0),
  );
}

/** The largest frame of `aspect` that fits inside the map's current view. */
function frameFromView(map, aspect) {
  const size = map.getSize();
  const widthPx = Math.min(size.x, size.y * mapAreaRatio(aspect)) * VIEW_MARGIN;
  const degreesPerPx = 360 / (256 * 2 ** map.getZoom());
  const c = map.getCenter();
  return { aspect, center: { lat: round(c.lat, 7), lng: round(wrapLng(c.lng), 7) }, width: round(widthPx * degreesPerPx, 9) };
}

/**
 * @param {{ client: object, root: HTMLElement, L: object, map: object, selection: object, prefs?: object,
 *           saveFile?: (blob: Blob, fileName: string) => Promise<void>, activeCoa?: object }} options
 *   activeCoa: the shared active-COA store (one is created when the view is mounted on its own).
 *   Exports still read each COA fresh (coa.get) at the moment of export.
 *   saveFile: where an exported file (PNG slide or data file) goes (default: a browser download).
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
const DATA_FORMAT_NAMES = Object.freeze({ json: 'JSON', geojson: 'GeoJSON', csv: 'CSV', weapons: 'Weapons', kml: 'KML', kmz: 'KMZ' });
/** Every data file the view offers: the text formats, and KMZ (built here: it needs symbol icons). */
const EXPORT_FORMATS = Object.freeze({ ...DATA_FORMATS, kmz: Object.freeze({ label: 'KMZ (KML with unit symbols)', extension: 'kmz', mimeType: 'application/vnd.google-earth.kmz' }) });
/** What each data format is for (shown under the format choice). */
const DATA_FORMAT_HINTS = Object.freeze({
  json: 'Everything (units, lines, frames, descriptions). Import it again with Import COAs…',
  geojson: 'Units and lines as map features, for GIS tools. Re-importable.',
  csv: 'One row per unit, for spreadsheets. Units only.',
  weapons: 'One row per weapon per unit, keyed by unit id, to join to the units in a GIS.',
  kml: 'For Google Earth, TAK and C2 viewers: a folder per COA, coloured, every field kept.',
  kmz: 'KML with each unit\'s 2525 symbol as its icon, in one file.',
});

export function mountExportView({ client, root, L, map, selection, prefs = createMemoryPrefs(), saveFile = (blob, name) => downloadBlob(blob, name), activeCoa }) {
  let destroyed = false;
  const ownStore = activeCoa ? null : createActiveCoa({ client, selection });
  const store = activeCoa ?? ownStore;
  let settings = null;
  let coa = null;
  let showFrame = prefs.get('showExportFrame', true) !== false;
  let preferredAspect = prefs.get('exportAspect', '16:9') in ASPECTS ? prefs.get('exportAspect', '16:9') : '16:9';

  const frameInUse = () => coa?.frame ?? settings?.frame ?? null;

  // ---- controls ----
  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const aspectRadios = Object.keys(ASPECTS).map((aspect) => el('input', {
    attrs: { type: 'radio', name: 'aspect', value: aspect }, on: { change: () => onAspect(aspect) },
  }));
  const status = el('p', { class: 'hint', dataset: { frameStatus: '' } });
  const setShared = el('button', { attrs: { type: 'button' }, text: 'Set shared frame from current view', on: { click: onSetShared } });
  const setOwn = el('button', { attrs: { type: 'button' }, text: 'Give this COA its own frame', on: { click: onSetOwn } });
  const useShared = el('button', { attrs: { type: 'button' }, text: 'Use shared frame', on: { click: onUseShared } });
  const zoomTo = el('button', { attrs: { type: 'button' }, text: 'Zoom to frame', on: { click: onZoomTo } });
  const exportPng = el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Export PNG', on: { click: onExportPng } });
  const exportAll = el('button', { attrs: { type: 'button' }, text: 'Export all COAs', on: { click: onExportAll } });
  let dataFormat = Object.hasOwn(EXPORT_FORMATS, prefs.get('dataFormat', 'json')) ? prefs.get('dataFormat', 'json') : 'json';
  const dataHint = el('p', { class: 'hint' });
  const showDataHint = () => { dataHint.textContent = DATA_FORMAT_HINTS[dataFormat]; };
  const dataRadios = Object.entries(EXPORT_FORMATS).map(([value, f]) => el('input', {
    attrs: { type: 'radio', name: 'data-format', value, 'aria-label': f.label },
    on: { change: () => { dataFormat = value; prefs.set('dataFormat', value); showDataHint(); } },
  }));
  dataRadios.forEach((r) => { r.checked = r.value === dataFormat; });
  showDataHint();
  const downloadOne = el('button', { attrs: { type: 'button' }, text: 'Download this COA', on: { click: onDownloadOne } });
  const downloadAll = el('button', { attrs: { type: 'button' }, text: 'Download all COAs', on: { click: onDownloadAll } });
  const useOwnFrames = el('input', { attrs: { type: 'checkbox', name: 'use-own-frames' } });
  const exportStatus = el('p', { class: 'status', attrs: { role: 'status' } });
  const showToggle = el('input', { attrs: { type: 'checkbox', name: 'show-frame' }, on: { change: (e) => { showFrame = e.target.checked; prefs.set('showExportFrame', showFrame); drawOverlay(); } } });

  const markingText = el('input', { attrs: { name: 'marking-text', autocomplete: 'off', 'aria-describedby': 'marking-text-error' }, on: { input: renderMarkingPreview } });
  const markingColor = el('input', { attrs: { type: 'color', name: 'marking-color', 'aria-label': 'Banner colour' }, on: { input: renderMarkingPreview } });
  const markingError = el('p', { class: 'field-error', dataset: { errorFor: 'marking-text' }, attrs: { id: 'marking-text-error' } });
  const markingPreview = el('div', { class: 'marking-preview', dataset: { markingPreview: '' } });

  const segment = (radio, text) => el('label', {}, radio, el('span', { text }));
  root.replaceChildren(el('div', { class: 'export-panel' },
    alert,
    el('fieldset', { class: 'group' }, el('legend', { text: 'Slide frame' }),
      el('div', { class: 'segmented', attrs: { 'aria-label': 'Slide shape' } }, ...aspectRadios.map((r) => segment(r, r.value))),
      status,
      el('div', { class: 'actions' }, setShared, setOwn, useShared, zoomTo),
      el('label', { class: 'check' }, showToggle, el('span', { text: 'Show frame on map' }))),
    el('fieldset', { class: 'group' }, el('legend', { text: 'Classification marking' }),
      el('label', { class: 'field' }, el('span', { text: 'Banner text' }), markingText),
      markingError,
      el('div', { class: 'marking-colors' }, markingColor,
        ...MARKING_PRESETS.map(([label, color]) => el('button', {
          class: 'swatch', attrs: { type: 'button', title: label, style: `--swatch: ${color}` }, text: label,
          on: { click: () => { markingColor.value = color; renderMarkingPreview(); } },
        }))),
      markingPreview,
      el('div', { class: 'actions' }, el('button', { attrs: { type: 'button' }, text: 'Save marking', on: { click: onSaveMarking } }))),
    el('fieldset', { class: 'group' }, el('legend', { text: 'Slides (PNG)' }),
      el('div', { class: 'actions' }, exportPng, exportAll),
      el('label', { class: 'check' }, useOwnFrames, el('span', { text: 'Use each COA\'s own frame where set' }))),
    el('fieldset', { class: 'group' }, el('legend', { text: 'Data file' }),
      el('div', { class: 'segmented segmented-grid', attrs: { 'aria-label': 'Data format' } }, ...dataRadios.map((r) => segment(r, DATA_FORMAT_NAMES[r.value]))),
      dataHint,
      el('div', { class: 'actions' }, downloadOne, downloadAll)),
    exportStatus));

  function renderMarkingPreview() {
    markingPreview.textContent = markingText.value.trim() || ' ';
    markingPreview.style.backgroundColor = markingColor.value;
    markingPreview.style.color = textColorOn(markingColor.value);
  }

  function render() {
    if (destroyed) return;
    const frame = frameInUse();
    const aspect = frame?.aspect ?? preferredAspect;
    aspectRadios.forEach((r) => { r.checked = r.value === aspect; });
    status.textContent = coa?.frame ? 'This COA has its own frame.'
      : settings?.frame ? 'Using the shared frame.'
        : 'No frame yet: pan and zoom the map to the area for your slides, then set the shared frame.';
    setOwn.disabled = coa === null;
    useShared.hidden = !coa?.frame;
    zoomTo.hidden = frame === null;
    showToggle.checked = showFrame;
    drawOverlay();
  }

  // ---- the frame on the map ----
  let overlay = null;
  function drawOverlay() {
    overlay?.remove();
    overlay = null;
    const frame = frameInUse();
    if (!frame || !showFrame || destroyed) return;
    const b = frameBounds(L, map, frame);
    const ring = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()];
    const world = [[-85, -540], [85, -540], [85, 540], [-85, 540]];
    overlay = L.layerGroup([
      L.polygon([world, ring], { className: 'export-frame-shade', stroke: false, fillColor: '#000', fillOpacity: 0.28, interactive: false }),
      // noClip: keep the outline exact when part of it is off-screen (Leaflet clips paths by default).
      L.rectangle(b, { className: 'export-frame', weight: 2, dashArray: '6 4', fill: false, interactive: false, noClip: true }),
    ]).addTo(map);
  }

  // ---- loading ----
  async function loadSettings() {
    const result = await client.ask('settings.get', {});
    if (destroyed) return;
    if (!result.ok) { alert.textContent = describeError(result.error); return; }
    settings = result.value;
    markingText.value = settings.marking.text;
    markingColor.value = settings.marking.color;
    renderMarkingPreview();
    render();
  }

  const applyCoa = (next) => { if (!destroyed) { coa = next; render(); } };

  // ---- actions ----
  const report = (result) => { alert.textContent = result.ok ? '' : describeError(result.error); return result.ok; };

  async function onAspect(aspect) {
    preferredAspect = aspect;
    prefs.set('exportAspect', aspect);
    const frame = frameInUse();
    if (!frame || frame.aspect === aspect) { render(); return; }
    if (coa?.frame) report(await client.send('coa.update', { coaId: coa.id, frame: { ...coa.frame, aspect } }));
    else report(await client.send('settings.update', { expectedRevision: settings.revision, frame: { ...settings.frame, aspect } }));
  }

  async function onSetShared() {
    report(await client.send('settings.update', { expectedRevision: settings.revision, frame: frameFromView(map, preferredAspect) }));
  }

  async function onSetOwn() {
    if (coa) report(await client.send('coa.update', { coaId: coa.id, frame: frameFromView(map, preferredAspect) }));
  }

  /** Render one COA as a PNG slide with `frame`. @returns {Promise<{ ok: true, png: Blob, fileName: string } | { ok: false, message: string }>} */
  async function renderSlide(target, frame, dtg) {
    const k = (frame.aspect === '16:9' ? 1080 : 1200) / 1080;
    const size = Math.round(SLIDE_SYMBOL_SIZE * k);
    const previews = await Promise.all(target.symbols.map((s) => client.ask('symbol.preview', { sidc: s.sidc, label: s.label, modifiers: s.modifiers, size })));
    // The legend shows the bare symbol: label and modifier text would only shrink it there.
    const plain = await Promise.all(target.symbols.map((s) => client.ask('symbol.preview', { sidc: s.sidc, size })));
    const failed = [...previews, ...plain].find((r) => !r.ok);
    if (failed) return { ok: false, message: describeError(failed.error) };
    const slide = layoutSlide({
      coa: target, frame, marking: settings.marking, dtg,
      symbols: previews.map((r) => r.value), legendSymbols: plain.map((r) => r.value),
    });
    return { ok: true, png: await canvasToPng(await paintSlide(slide, root.ownerDocument)), fileName: slideFileName(target.name, dtg) };
  }

  /** Run an export with the buttons disabled and errors reported in the status line. */
  async function exporting(work) {
    const buttons = [exportPng, exportAll, downloadOne, downloadAll];
    buttons.forEach((b) => { b.disabled = true; });
    exportStatus.textContent = 'Exporting…';
    try {
      exportStatus.textContent = await work();
    } catch (error) {
      exportStatus.textContent = `Export failed: ${error?.message ?? error}`;
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  async function onExportPng() {
    const frame = frameInUse();
    if (coa === null) { exportStatus.textContent = 'Select a COA first.'; return; }
    if (!frame) { exportStatus.textContent = 'Set a frame first (Set shared frame from current view).'; return; }
    await exporting(async () => {
      // Read the COA fresh: units may have changed since this section last loaded it.
      const latest = await client.ask('coa.get', { coaId: coa.id });
      if (!latest.ok) return describeError(latest.error);
      const slide = await renderSlide(latest.value, latest.value.frame ?? settings.frame, formatDtg(new Date().toISOString()));
      if (!slide.ok) return slide.message;
      await saveFile(slide.png, slide.fileName);
      return `Exported ${slide.fileName}`;
    });
  }

  /** One slide per COA, in name order, same frame and same DTG, for a comparison brief. */
  async function onExportAll() {
    if (!settings?.frame) { exportStatus.textContent = 'Set the shared frame first (Set shared frame from current view).'; return; }
    await exporting(async () => {
      const listed = await client.ask('coa.list', {});
      if (!listed.ok) return describeError(listed.error);
      const ids = [...listed.value].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((x) => x.id);
      const dtg = formatDtg(new Date().toISOString());
      let count = 0;
      for (const id of ids) {
        const loaded = await client.ask('coa.get', { coaId: id });
        if (!loaded.ok) return describeError(loaded.error);
        const frame = useOwnFrames.checked && loaded.value.frame ? loaded.value.frame : settings.frame;
        const slide = await renderSlide(loaded.value, frame, dtg);
        if (!slide.ok) return `${loaded.value.name}: ${slide.message}`;
        await saveFile(slide.png, slide.fileName);
        count += 1;
      }
      return `Exported ${count} slide${count === 1 ? '' : 's'}`;
    });
  }

  // ---- data files ----
  /** A unit's plain 2525 symbol as PNG bytes, for a KMZ icon. */
  async function renderIcon(sidc) {
    const preview = await client.ask('symbol.preview', { sidc, size: ICON_SIZE });
    return preview.ok ? svgToPng(preview.value.svg, preview.value.width, preview.value.height, root.ownerDocument) : null;
  }
  /** Read COAs fresh, write them in the chosen format and save the file. */
  async function saveData(ids, baseName) {
    const coas = [];
    for (const id of ids) {
      const loaded = await client.ask('coa.get', { coaId: id });
      if (!loaded.ok) return describeError(loaded.error);
      coas.push(loaded.value);
    }
    const format = EXPORT_FORMATS[dataFormat];
    const fileName = slideFileName(baseName, formatDtg(new Date().toISOString()), format.extension);
    const [headerFormat, formatVersion] = HEADER_FORMATS[dataFormat];
    const header = await client.ask('export.header', { format: headerFormat, formatVersion });
    if (!header.ok) return describeError(header.error);
    const body = dataFormat === 'kmz'
      ? await buildKmz({ coas, header: header.value, title: titleOf(coas), renderIcon })
      : writeCoaData(dataFormat, coas, { header: header.value });
    await saveFile(new Blob([body], { type: format.mimeType }), fileName);
    return `Saved ${fileName}`;
  }

  async function onDownloadOne() {
    if (coa === null) { exportStatus.textContent = 'Select a COA first.'; return; }
    await exporting(() => saveData([coa.id], coa.name));
  }

  async function onDownloadAll() {
    await exporting(async () => {
      const listed = await client.ask('coa.list', {});
      if (!listed.ok) return describeError(listed.error);
      if (listed.value.length === 0) return 'There are no COAs to download.';
      const ids = [...listed.value].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((x) => x.id);
      return saveData(ids, 'coas');
    });
  }

  function onZoomTo() {
    const frame = frameInUse();
    if (frame) map.fitBounds(frameBounds(L, map, frame), { padding: [16, 16], animate: false });
  }

  async function onUseShared() {
    if (coa) report(await client.send('coa.update', { coaId: coa.id, frame: null }));
  }

  async function onSaveMarking() {
    markingError.textContent = '';
    markingText.removeAttribute('aria-invalid');
    const result = await client.send('settings.update', { expectedRevision: settings.revision, marking: { text: markingText.value, color: markingColor.value } });
    if (result.ok) { alert.textContent = ''; return; }
    const problem = result.error.details?.problems?.find((p) => p.field === 'marking.text');
    if (problem) {
      markingError.textContent = problem.reason.replace(/^./, (c) => c.toUpperCase());
      markingText.setAttribute('aria-invalid', 'true');
    } else {
      alert.textContent = describeError(result.error);
    }
  }

  // ---- wiring ----
  const reloadSettings = coalesce(() => { if (!destroyed) loadSettings(); });
  const unsubscribes = [
    client.subscribe('settings.*', reloadSettings),
    store.subscribe(applyCoa),
  ];

  return {
    ready: Promise.all([loadSettings(), store.ready]).then(() => applyCoa(store.get())),
    /** Reload the shared frame and marking (e.g. after a change in another window). */
    refreshSettings: () => loadSettings(),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      ownStore?.destroy();
      overlay?.remove();
      overlay = null;
    },
  };
}
