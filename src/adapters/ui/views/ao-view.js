// The area of operations (Epic 6 E6-6, D47): set it from two corners (a box square to the grid), from
// 3 or more points, or from the map view; see it outlined on the map; clear it. Items outside it are
// flagged in the units list, the COA's panel, the unit editor and update previews (never refused).
import { el, describeError } from './dom.js';
import { boxAo } from '../../../domain/area-of-operations.js';
import { parseMgrs, toMgrs } from '../../../domain/mgrs.js';

/** "18S UJ 2000 0000" or "38.9, -77.0" per line → positions, or { bad: line number }. */
function readLines(text) {
  const points = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    const ll = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(lines[i]);
    if (ll) { points.push({ lat: Number(ll[1]), lng: Number(ll[2]) }); continue; }
    const m = parseMgrs(lines[i]);
    if (m.problems) return { bad: i + 1, reason: m.problems[0].reason };
    points.push({ lat: m.lat, lng: m.lng });
  }
  return { points };
}

/**
 * @param {{ client: object, root: HTMLElement, L: object, map: object, aoStore: object }} options
 */
export function mountAoView({ client, root, L, map, aoStore }) {
  let destroyed = false;
  const outline = L.layerGroup().addTo(map);
  const summary = el('p', { dataset: { aoSummary: '' } });
  const name = el('input', { attrs: { name: 'ao-name', autocomplete: 'off', maxlength: 60, placeholder: 'e.g. AO IRON' } });
  const points = el('textarea', { attrs: { name: 'ao-points', rows: 3, spellcheck: 'false', placeholder: '18S UJ 2000 0000\n18S UJ 3000 1000' } });
  const error = el('p', { class: 'field-error' });
  const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
  root.replaceChildren(el('fieldset', { class: 'group', dataset: { ao: '' } }, el('legend', { text: 'Area of operations' }),
    summary,
    field('Name (optional)', name),
    field('Two corners for a box, or 3 or more points (grids or lat, lng; one per line)', points),
    error,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Set', on: { click: onSet } }),
      el('button', { attrs: { type: 'button' }, text: 'Use the map view', on: { click: onView } }),
      el('button', { class: 'link danger', attrs: { type: 'button' }, dataset: { clearAo: '' }, text: 'Clear', on: { click: () => save(null) } })),
    el('p', { class: 'hint', text: 'Units, lines and areas outside it are flagged ⚠, never refused: a point far outside is usually a mistyped grid.' })));

  function render(ao) {
    outline.clearLayers();
    if (!ao) { summary.textContent = 'Not set.'; return; }
    summary.textContent = `${ao.name || 'Set'}: ${ao.points.length} corners, the first at ${toMgrs(ao.points[0], 2) ?? 'outside MGRS'}.`;
    const poly = L.polygon(ao.points.map((p) => [p.lat, p.lng]), { className: 'ao-outline', interactive: false, fill: false, weight: 2.5, dashArray: '10 6' }).addTo(outline);
    if (ao.name) poly.bindTooltip(ao.name, { permanent: true, direction: 'center', className: 'ao-label', interactive: false });
  }

  async function save(ao) {
    const current = await client.ask('settings.get');
    if (destroyed) return;
    if (!current.ok) { error.textContent = describeError(current.error); return; }
    const result = await client.send('settings.update', { expectedRevision: current.value.revision, ao });
    if (destroyed) return;
    if (!result.ok) { error.textContent = describeError(result.error); return; }
    error.textContent = '';
    if (ao) { points.value = ''; }
  }

  function onSet() {
    const read = readLines(points.value);
    if (read.bad) { error.textContent = `Line ${read.bad}: ${read.reason}`; return; }
    if (read.points.length < 2) { error.textContent = 'Give two corners, or 3 or more points.'; return; }
    save({ name: name.value, points: read.points.length === 2 ? boxAo(read.points[0], read.points[1]) : read.points });
  }
  function onView() {
    const b = map.getBounds();
    save({ name: name.value, points: boxAo({ lat: b.getSouth(), lng: b.getWest() }, { lat: b.getNorth(), lng: b.getEast() }) });
  }

  const off = aoStore.subscribe((ao) => { render(ao); if (ao) name.value = ao.name; });
  render(aoStore.get());
  return { destroy() { destroyed = true; off(); outline.remove(); } };
}
