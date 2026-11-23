// "Lines & areas" panel section (driving adapter): draw new lines, areas and range rings on the
// active COA, list them, and edit or delete the selected one. Drawing goes through the shared
// drawer (the draw tool on the map collects the clicks); saving goes through the app client.
import { el, describeError } from './dom.js';
import { coalesce } from './coalesce.js';
import { GRAPHIC_KINDS, SIDES, graphicColor, shapeOf } from '../../../domain/graphic.js';

export const KIND_NAMES = Object.freeze({
  phaseLine: 'Phase line', boundary: 'Boundary', axisOfAdvance: 'Axis of advance', route: 'Route', line: 'Line',
  objective: 'Objective', assemblyArea: 'Assembly area', engagementArea: 'Engagement area', area: 'Area',
  rangeRing: 'Range ring',
});
const SIDE_NAMES = Object.freeze({ friendly: 'Friendly', hostile: 'Hostile', neutral: 'Neutral', unknown: 'Unknown' });
const SHAPE_GROUPS = Object.freeze([['line', 'Lines'], ['area', 'Areas'], ['circle', 'Circles']]);
const kindsOf = (shape) => Object.keys(GRAPHIC_KINDS).filter((k) => GRAPHIC_KINDS[k] === shape);
const nameOf = (g) => g.label || KIND_NAMES[g.kind];

/** Radius text in km → metres, '' → undefined, anything else → NaN. */
function parseKm(text) {
  const t = text.trim();
  if (t === '') return undefined;
  const km = Number(t.replace(',', '.'));
  return Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : NaN;
}

function kindSelect(name, kinds) {
  const grouped = SHAPE_GROUPS.map(([shape, label]) => [label, kinds.filter((k) => GRAPHIC_KINDS[k] === shape)]).filter(([, ks]) => ks.length);
  const options = (ks) => ks.map((k) => el('option', { attrs: { value: k }, text: KIND_NAMES[k] }));
  return el('select', { attrs: { name } }, ...(grouped.length > 1 ? grouped.map(([label, ks]) => el('optgroup', { attrs: { label } }, ...options(ks))) : options(kinds)));
}
const sideSelect = (name) => el('select', { attrs: { name } }, ...SIDES.map((s) => el('option', { attrs: { value: s }, text: SIDE_NAMES[s] })));
const field = (label, control) => el('label', { class: 'field' }, el('span', { text: label }), control);

/**
 * @param {{ client: object, root: HTMLElement, selection: object, graphicSelection: object, drawer: object }} options
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountGraphicsView({ client, root, selection, graphicSelection, drawer }) {
  let destroyed = false;
  let coa = null;
  let loadSeq = 0;

  // ---- draw form ----
  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const drawKind = kindSelect('draw-kind', Object.keys(GRAPHIC_KINDS));
  const drawSide = sideSelect('draw-side');
  const drawLabel = el('input', { attrs: { name: 'draw-label', autocomplete: 'off', maxlength: 40, placeholder: 'e.g. PL GOLD' } });
  const drawRadius = el('input', { attrs: { name: 'draw-radius', inputmode: 'decimal', autocomplete: 'off', placeholder: 'or click the edge' } });
  const radiusRow = field('Radius (km)', drawRadius);
  const drawButton = el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Draw', on: { click: onDraw } });
  const drawStatus = el('p', { class: 'placeholder', attrs: { role: 'status' } });
  const drawForm = el('div', { class: 'draw-form stack' },
    el('div', { class: 'position' }, field('Kind', drawKind), field('Side', drawSide)),
    field('Label', drawLabel), radiusRow, drawButton, drawStatus);
  drawKind.addEventListener('change', () => { radiusRow.hidden = shapeOf(drawKind.value) !== 'circle'; });
  radiusRow.hidden = true;

  const list = el('ul', { class: 'graphic-items', attrs: { 'aria-label': 'Lines and areas' } });
  const editor = el('div', { class: 'graphic-editor' });
  const empty = el('p', { class: 'placeholder', text: 'Select a COA to draw lines, areas and range rings.' });
  root.replaceChildren(el('div', { class: 'graphics-panel' }, alert, empty, drawForm, list, editor));

  // ---- list and editor ----
  function renderList() {
    const selectedId = graphicSelection.get();
    list.replaceChildren(...(coa?.graphics ?? []).map((g) => el('li', { dataset: { graphicItem: g.id }, class: g.id === selectedId ? 'is-selected' : '' },
      el('button', { class: 'graphic-select', attrs: { type: 'button', 'aria-current': g.id === selectedId ? 'true' : null }, on: { click: () => graphicSelection.set(g.id) } },
        el('span', { class: `graphic-swatch${g.side === 'hostile' ? ' is-dashed' : ''}`, attrs: { style: `--swatch: ${graphicColor(g)}` } }),
        el('span', { class: 'graphic-name', text: nameOf(g) }),
        el('span', { class: 'graphic-kind', text: g.label ? KIND_NAMES[g.kind] : '' })))));
  }

  function renderEditor() {
    const g = coa?.graphics.find((x) => x.id === graphicSelection.get());
    if (!g) { editor.replaceChildren(); return; }
    const shape = shapeOf(g.kind);
    const kind = kindSelect('graphic-kind', kindsOf(shape));
    kind.value = g.kind;
    const label = el('input', { attrs: { name: 'graphic-label', autocomplete: 'off', maxlength: 40, value: g.label } });
    const side = sideSelect('graphic-side');
    side.value = g.side;
    const custom = el('input', { attrs: { type: 'checkbox', name: 'graphic-custom-color', checked: Boolean(g.color) } });
    const color = el('input', { attrs: { type: 'color', name: 'graphic-color', 'aria-label': 'Colour', value: graphicColor(g) } });
    const syncColor = () => { color.disabled = !custom.checked; if (!custom.checked) color.value = graphicColor({ ...g, color: undefined, side: side.value }); };
    custom.addEventListener('change', syncColor);
    side.addEventListener('change', syncColor);
    syncColor();
    const radius = shape === 'circle' ? el('input', { attrs: { name: 'graphic-radius', inputmode: 'decimal', value: String(g.radius / 1000) } }) : null;
    const error = el('p', { class: 'field-error' });

    async function onSave() {
      const changes = {};
      if (kind.value !== g.kind) changes.kind = kind.value;
      if (label.value.trim() !== g.label) changes.label = label.value;
      if (side.value !== g.side) changes.side = side.value;
      if (custom.checked && color.value !== g.color) changes.color = color.value;
      if (!custom.checked && g.color) changes.color = null;
      if (radius) {
        const metres = parseKm(radius.value);
        if (!(metres > 0)) { error.textContent = 'Radius must be a number of km above 0'; return; }
        if (metres !== g.radius) changes.radius = metres;
      }
      error.textContent = '';
      if (Object.keys(changes).length === 0) return;
      const result = await client.send('graphic.update', { coaId: coa.id, graphicId: g.id, ...changes });
      if (!result.ok && !destroyed) error.textContent = describeError(result.error);
    }
    async function onDelete() {
      const result = await client.send('graphic.remove', { coaId: coa.id, graphicId: g.id });
      if (destroyed) return;
      if (result.ok) graphicSelection.set(null); else error.textContent = describeError(result.error);
    }

    editor.replaceChildren(el('div', { class: 'stack' },
      el('h3', { class: 'editor-heading', text: `Edit ${nameOf(g)}` }),
      el('div', { class: 'position' }, field('Kind', kind), field('Side', side)),
      field('Label', label),
      el('div', { class: 'check' }, el('label', { class: 'check' }, custom, el('span', { text: 'Own colour' })), color),
      radius ? field('Radius (km)', radius) : null,
      error,
      el('div', { class: 'row' },
        el('button', { attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onDelete } })),
      el('p', { class: 'placeholder', text: shape === 'circle'
        ? 'On the map: drag the centre to move the ring, or the edge handle to resize it.'
        : 'On the map: drag a point to move it, drag a small point to add one, right-click a point to remove it.' })));
  }

  function render() {
    if (destroyed) return;
    empty.hidden = coa !== null;
    drawForm.hidden = coa === null;
    renderList();
    renderEditor();
  }

  // ---- drawing ----
  function onDraw() {
    if (drawer.isActive()) { drawer.cancel(); return; }
    if (!coa) return;
    const shape = shapeOf(drawKind.value);
    const radius = shape === 'circle' ? parseKm(drawRadius.value) : undefined;
    if (Number.isNaN(radius)) { drawStatus.textContent = 'Radius must be a number of km above 0, or empty to click the edge.'; return; }
    const target = { coaId: coa.id, kind: drawKind.value, side: drawSide.value, label: drawLabel.value };
    drawer.request({ shape, ...(radius ? { radius } : {}) }, async (geometry) => {
      const result = await client.send('graphic.add', { ...target, ...geometry });
      if (destroyed) return;
      if (!result.ok) { alert.textContent = describeError(result.error); return; }
      alert.textContent = '';
      drawLabel.value = '';
      graphicSelection.set(result.value.graphic.id);
    });
  }
  const offDrawer = drawer.subscribe((request) => {
    drawButton.textContent = request ? 'Cancel drawing' : 'Draw';
    drawStatus.textContent = request ? 'Drawing on the map…' : '';
  });

  async function load(coaId = selection.get()) {
    const seq = ++loadSeq;
    if (coaId === null) { coa = null; render(); return; }
    const result = await client.ask('coa.get', { coaId });
    if (destroyed || seq !== loadSeq) return;
    coa = result.ok ? result.value : null;
    if (!result.ok && result.error.code !== 'NOT_FOUND') alert.textContent = describeError(result.error);
    render();
  }

  const coaIdOf = (event) => event.payload.coaId ?? event.payload.coa?.id;
  const reload = coalesce(() => { if (!destroyed && coa) load(coa.id); });
  const unsubscribes = [
    client.subscribe('graphic.*', (e) => { if (coa && coaIdOf(e) === coa.id) reload(); }),
    client.subscribe('coa.*', (e) => { if (coa && coaIdOf(e) === coa.id) reload(); }),
    selection.subscribe((id) => { if (drawer.isActive()) drawer.cancel(); load(id); }),
    graphicSelection.subscribe(() => render()),
    offDrawer,
  ];

  return {
    ready: load(),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
    },
  };
}
