// Photo underlay (Epic 6 E6-5, D48; docs/PHOTO-UNDERLAY.md): load a photo or scan of an overlay (or of
// the map), register it by clicking 3 or more points on it and typing each one's grid, check the fit
// (each point's residual in metres), and show it under the map to trace with the drawing tools and
// snapping. The photo stays in this browser tab: it is not stored or sent anywhere.
import { el } from './dom.js';
import { fitTransform } from '../../../domain/image-registration.js';
import { parseMgrs, toUtmInZone, zoneOf } from '../../../domain/mgrs.js';
import { createUnderlay } from './underlay-layer.js';

const metres = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** A typed position: an MGRS grid or "lat, lng". */
function readPosition(text) {
  const t = text.trim();
  if (!t) return null;
  const ll = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (ll) return { lat: Number(ll[1]), lng: Number(ll[2]) };
  const m = parseMgrs(t);
  return m.problems ? { problem: m.problems[0].reason } : { lat: m.lat, lng: m.lng };
}

/**
 * Fit control points { px, text } → { transform, zone, hemisphere, rows: [{ residual?, problem? }] } or { problem }.
 * Exported for tests.
 */
export function fitPoints(points) {
  const rows = points.map((p) => { const pos = readPosition(p.text); return pos?.problem ? { problem: pos.problem } : pos ? { pos } : { problem: 'type its grid' }; });
  const good = points.map((p, i) => ({ ...p, pos: rows[i].pos })).filter((p) => p.pos);
  if (good.length < 3) return { rows, problem: `Click and give the grid of at least 3 points (${good.length} so far).` };
  const zone = zoneOf(good[0].pos.lat, good[0].pos.lng);
  const hemisphere = good[0].pos.lat < 0 ? 'S' : 'N';
  const fit = fitTransform(good.map((p) => { const u = toUtmInZone(p.pos, zone); return { px: p.px, at: { e: u.easting, n: u.northing } }; }));
  if (fit.problem) return { rows, problem: `The points ${fit.problem}.` };
  let k = 0;
  points.forEach((p, i) => { if (rows[i].pos) rows[i].residual = fit.residuals[k++]; });
  return { rows, transform: fit, zone, hemisphere, kind: fit.kind, rms: fit.rms };
}

/**
 * @param {{ root: HTMLElement, L: object, map: object }} options
 */
export function mountUnderlayView({ root, L, map }) {
  const underlay = createUnderlay({ L, map });
  let photo = null; // { name, image, width, height, url }
  let points = []; // { px: { x, y }, text }
  let fitted = null;
  let zoom = 1;

  // ---- the panel ----
  const fileInput = el('input', { attrs: { type: 'file', hidden: true, accept: 'image/*', 'aria-label': 'Load a photo or scan to trace', tabindex: '-1' }, on: { change: onFile } });
  const summary = el('p', { dataset: { underlaySummary: '' }, text: 'No photo.' });
  const opacity = el('input', { attrs: { type: 'range', name: 'underlay-opacity', min: 10, max: 100, value: 60, 'aria-label': 'Photo opacity' } });
  opacity.addEventListener('input', () => underlay.setOpacity(Number(opacity.value) / 100));
  const shownTools = el('div', { class: 'stack', attrs: { hidden: true } },
    el('label', { class: 'field' }, el('span', { text: 'Opacity' }), opacity),
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Edit points', on: { click: openDialog } }),
      el('button', { class: 'link danger', attrs: { type: 'button' }, text: 'Remove photo', on: { click: remove } })));
  root.replaceChildren(el('fieldset', { class: 'group', dataset: { underlay: '' } }, el('legend', { text: 'Photo underlay (trace)' }),
    el('p', { class: 'hint', text: 'A photo or scan of an overlay or map, placed under the map by 3 or more points whose grids you know, to trace with the drawing tools. It stays in this tab only.' }),
    summary,
    el('div', { class: 'actions' }, el('button', { attrs: { type: 'button' }, text: 'Load photo…', on: { click: () => fileInput.click() } }), fileInput),
    shownTools));

  // ---- the registration dialog ----
  const img = el('img', { class: 'register-image', attrs: { alt: 'The photo: click a point whose grid you know' } });
  const marks = el('div', { class: 'register-marks' });
  const stage = el('div', { class: 'register-stage' }, img, marks);
  const scroller = el('div', { class: 'register-scroller' }, stage);
  const zoomSelect = el('select', { attrs: { name: 'register-zoom', 'aria-label': 'Zoom' } }, ...[['fit', 'Fit'], ['1', '100 %'], ['2', '200 %'], ['4', '400 %']].map(([v, t]) => el('option', { attrs: { value: v }, text: t })));
  const table = el('table', { class: 'register-points', dataset: { registerPoints: '' } });
  const fitNote = el('p', { dataset: { fitNote: '' } });
  const showButton = el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Show on map', on: { click: onShow } });
  const dialog = el('dialog', { class: 'register-dialog', attrs: { 'aria-label': 'Place the photo' } },
    el('div', { class: 'stack' },
      el('h3', { class: 'subheading', text: 'Place the photo' }),
      el('p', { class: 'hint', text: 'Click a point on the photo whose grid you can read (a grid line crossing is best), then type its grid. 3 points place a flat scan; 4 or more also correct a photo taken at an angle. Spread them out.' }),
      el('div', { class: 'actions' }, el('label', { class: 'field' }, el('span', { text: 'Zoom' }), zoomSelect)),
      scroller, table, fitNote,
      el('div', { class: 'actions' }, showButton, el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }))));
  root.ownerDocument.body.append(dialog);

  zoomSelect.addEventListener('change', layoutStage);
  stage.addEventListener('click', (e) => {
    if (!photo) return;
    const r = img.getBoundingClientRect();
    const px = { x: Math.round(((e.clientX - r.left) / r.width) * photo.width), y: Math.round(((e.clientY - r.top) / r.height) * photo.height) };
    points.push({ px, text: '' });
    renderPoints();
    table.querySelectorAll('input[name="point-grid"]')[points.length - 1]?.focus();
  });

  function layoutStage() {
    if (!photo) return;
    const v = zoomSelect.value;
    zoom = v === 'fit' ? Math.min(1, (Math.min(860, window.innerWidth - 80)) / photo.width) : Number(v);
    img.style.width = `${photo.width * zoom}px`;
    img.style.height = `${photo.height * zoom}px`;
    renderMarks();
  }
  function renderMarks() {
    marks.replaceChildren(...points.map((p, i) => el('span', { class: 'register-mark', text: String(i + 1), attrs: { style: `left:${p.px.x * zoom}px;top:${p.px.y * zoom}px` } })));
  }
  function renderPoints() {
    fitted = fitPoints(points);
    table.replaceChildren(
      el('thead', {}, el('tr', {}, ...['#', 'Pixel', 'Grid (MGRS or lat, lng)', 'Off by', ''].map((t) => el('th', { attrs: { scope: 'col' }, text: t })))),
      el('tbody', {}, ...points.map((p, i) => {
        const grid = el('input', { attrs: { name: 'point-grid', autocomplete: 'off', spellcheck: 'false', placeholder: '18S UJ 2300 0600', 'aria-label': `Grid of point ${i + 1}` } });
        grid.value = p.text;
        grid.addEventListener('change', () => { p.text = grid.value; renderPoints(); });
        const row = fitted.rows[i];
        const worst = fitted.transform && row.residual === Math.max(...fitted.rows.map((r) => r.residual ?? 0)) && points.length > 3;
        return el('tr', { class: worst && row.residual > 3 * Math.max(1, fitted.rms / 2) ? 'is-worst' : '' },
          el('td', { text: String(i + 1) }), el('td', { text: `${p.px.x}, ${p.px.y}` }), el('td', {}, grid),
          el('td', { dataset: { residual: '' }, text: row.problem ?? (row.residual !== undefined ? metres(row.residual) : '') }),
          el('td', {}, el('button', { class: 'link', attrs: { type: 'button', 'aria-label': `Remove point ${i + 1}` }, text: 'Remove', on: { click: () => { points.splice(i, 1); renderPoints(); } } })));
      })));
    fitNote.textContent = fitted.problem ?? `${fitted.kind === 'projective' ? 'Corrected for perspective' : 'Flat (3 points: no perspective correction)'}; fits within ${metres(fitted.rms)} (RMS)${points.length > 3 ? '; a point far off the others is usually a wrong click or grid' : ''}.`;
    showButton.disabled = Boolean(fitted.problem);
    renderMarks();
  }
  function openDialog() {
    if (!photo) return;
    if (!dialog.open) dialog.showModal();
    layoutStage();
    renderPoints();
  }

  async function onFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { summary.textContent = `${file.name} is not an image the browser can read.`; URL.revokeObjectURL(url); return; }
    if (photo) URL.revokeObjectURL(photo.url);
    photo = { name: file.name, image, width: image.naturalWidth, height: image.naturalHeight, url };
    img.src = url;
    points = [];
    underlay.clear();
    shownTools.hidden = true;
    summary.textContent = `${file.name}: not placed yet.`;
    openDialog();
  }

  function onShow() {
    if (!fitted || fitted.problem) return;
    underlay.show({ image: photo.image, width: photo.width, height: photo.height, transform: fitted.transform, zone: fitted.zone, hemisphere: fitted.hemisphere });
    underlay.setOpacity(Number(opacity.value) / 100);
    summary.textContent = `${photo.name}: ${points.length} points, fits within ${metres(fitted.rms)}.`;
    shownTools.hidden = false;
    dialog.close();
  }

  function remove() {
    underlay.clear();
    if (photo) URL.revokeObjectURL(photo.url);
    photo = null;
    points = [];
    shownTools.hidden = true;
    summary.textContent = 'No photo.';
  }

  return {
    /** For tests and the real-app check: the state of the underlay. */
    state: () => ({ photo: photo?.name ?? null, points: points.length, shown: underlay.isOn(), fit: fitted }),
    destroy() { remove(); underlay.destroy(); dialog.remove(); },
  };
}
