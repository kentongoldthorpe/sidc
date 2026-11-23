// Export view (driving adapter): the slide frame (shared, or a COA's own), its aspect ratio, the
// classification marking, and the frame drawn on the map with the outside shaded.
import { el, describeError } from './dom.js';
import { coalesce } from './coalesce.js';
import { createMemoryPrefs } from '../prefs.js';
import { ASPECTS } from '../../../domain/frame.js';
import { textColorOn } from '../../export/colors.js';
import { layoutSlide, formatDtg, slideFileName, mapAreaRatio } from '../../export/slide-layout.js';
import { paintSlide, canvasToPng, downloadBlob } from '../../export/paint-slide.js';

const SLIDE_SYMBOL_SIZE = 40; // symbol size on a 1080-pixel-high slide (scaled for other heights)

const VIEW_MARGIN = 0.94; // "from current view": the largest frame that fits, with a small margin
const MARKING_PRESETS = Object.freeze([
  ['UNCLASSIFIED (green)', '#007a33'], ['CUI (purple)', '#502b85'], ['CONFIDENTIAL (blue)', '#0033a0'],
  ['SECRET (red)', '#c8102e'], ['TOP SECRET (orange)', '#ff8c00'],
]);

const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
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
 *           saveFile?: (blob: Blob, fileName: string) => Promise<void> }} options
 *   saveFile: where an exported PNG goes (default: a browser download).
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountExportView({ client, root, L, map, selection, prefs = createMemoryPrefs(), saveFile = (blob, name) => downloadBlob(blob, name) }) {
  let destroyed = false;
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
  const status = el('p', { class: 'placeholder', dataset: { frameStatus: '' } });
  const setShared = el('button', { attrs: { type: 'button' }, text: 'Set shared frame from current view', on: { click: onSetShared } });
  const setOwn = el('button', { attrs: { type: 'button' }, text: 'Give this COA its own frame', on: { click: onSetOwn } });
  const useShared = el('button', { attrs: { type: 'button' }, text: 'Use shared frame', on: { click: onUseShared } });
  const zoomTo = el('button', { attrs: { type: 'button' }, text: 'Zoom to frame', on: { click: onZoomTo } });
  const exportPng = el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Export PNG', on: { click: onExportPng } });
  const exportAll = el('button', { attrs: { type: 'button' }, text: 'Export all COAs', on: { click: onExportAll } });
  const useOwnFrames = el('input', { attrs: { type: 'checkbox', name: 'use-own-frames' } });
  const exportStatus = el('p', { class: 'bulk-status', attrs: { role: 'status' } });
  const showToggle = el('input', { attrs: { type: 'checkbox', name: 'show-frame' }, on: { change: (e) => { showFrame = e.target.checked; prefs.set('showExportFrame', showFrame); drawOverlay(); } } });

  const markingText = el('input', { attrs: { name: 'marking-text', autocomplete: 'off', 'aria-describedby': 'marking-text-error' }, on: { input: renderMarkingPreview } });
  const markingColor = el('input', { attrs: { type: 'color', name: 'marking-color', 'aria-label': 'Banner colour' }, on: { input: renderMarkingPreview } });
  const markingError = el('p', { class: 'field-error', dataset: { errorFor: 'marking-text' }, attrs: { id: 'marking-text-error' } });
  const markingPreview = el('div', { class: 'marking-preview', dataset: { markingPreview: '' } });

  root.replaceChildren(el('div', { class: 'export-panel' },
    alert,
    el('fieldset', { class: 'base-layers' }, el('legend', { class: 'placeholder', text: 'Slide shape' }),
      ...aspectRadios.map((r) => el('label', {}, r, el('span', { text: r.value })))),
    status,
    el('div', { class: 'stack' }, setShared, setOwn, useShared, zoomTo),
    el('label', { class: 'check' }, showToggle, el('span', { text: 'Show frame on map' })),
    el('fieldset', { class: 'marking' }, el('legend', { class: 'placeholder', text: 'Classification marking' }),
      el('label', { class: 'field' }, el('span', { text: 'Banner text' }), markingText),
      markingError,
      el('div', { class: 'marking-colors' }, markingColor,
        ...MARKING_PRESETS.map(([label, color]) => el('button', {
          class: 'swatch', attrs: { type: 'button', title: label, style: `--swatch: ${color}` }, text: label,
          on: { click: () => { markingColor.value = color; renderMarkingPreview(); } },
        }))),
      markingPreview,
      el('button', { attrs: { type: 'button' }, text: 'Save marking', on: { click: onSaveMarking } })),
    exportPng,
    exportAll,
    el('label', { class: 'check' }, useOwnFrames, el('span', { text: 'Use each COA\'s own frame where set' })),
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

  let coaSeq = 0;
  async function loadCoa(id = selection.get()) {
    const seq = ++coaSeq;
    if (id === null) { coa = null; render(); return; }
    const result = await client.ask('coa.get', { coaId: id });
    if (destroyed || seq !== coaSeq) return;
    coa = result.ok ? result.value : null;
    render();
  }

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
    exportPng.disabled = true;
    exportAll.disabled = true;
    exportStatus.textContent = 'Exporting…';
    try {
      exportStatus.textContent = await work();
    } catch (error) {
      exportStatus.textContent = `Export failed: ${error?.message ?? error}`;
    } finally {
      exportPng.disabled = false;
      exportAll.disabled = false;
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
  const reloadCoa = coalesce(() => { if (!destroyed) loadCoa(); });
  const unsubscribes = [
    client.subscribe('settings.*', reloadSettings),
    client.subscribe('coa.*', (e) => { if ((e.payload.coaId ?? e.payload.coa?.id) === selection.get()) reloadCoa(); }),
    client.subscribe('symbol.*', (e) => { if (e.payload.coaId === selection.get()) reloadCoa(); }),
    selection.subscribe((id) => loadCoa(id)),
  ];

  return {
    ready: Promise.all([loadSettings(), loadCoa()]).then(() => {}),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      overlay?.remove();
      overlay = null;
    },
  };
}
