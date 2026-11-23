// "Lines & areas" panel section (driving adapter): draw new lines, areas and range rings on the
// active COA, list them, and edit or delete the selected one. Drawing goes through the shared
// drawer (the draw tool on the map collects the clicks); saving goes through the app client.
import { el, describeError } from './dom.js';
import { GRAPHIC_KINDS, SIDES, graphicColor, shapeOf } from '../../../domain/graphic.js';
import { createActiveCoa } from '../active-coa.js';

export const KIND_NAMES = Object.freeze({
  phaseLine: 'Phase line', boundary: 'Boundary', axisOfAdvance: 'Axis of advance', route: 'Route', line: 'Line',
  objective: 'Objective', assemblyArea: 'Assembly area', engagementArea: 'Engagement area', area: 'Area',
  rangeRing: 'Range ring', sector: 'Sector of fire',
});
const SIDE_NAMES = Object.freeze({ friendly: 'Friendly', hostile: 'Hostile', neutral: 'Neutral', unknown: 'Unknown' });
const SHAPE_GROUPS = Object.freeze([['line', 'Lines'], ['area', 'Areas'], ['circle', 'Circles'], ['sector', 'Fields of fire']]);
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
 * @param {{ client: object, root: HTMLElement, selection: object, graphicSelection: object, drawer: object, activeCoa?: object }} options
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountGraphicsView({ client, root, selection, graphicSelection, drawer, activeCoa }) {
  let destroyed = false;
  let coa = null;
  const ownStore = activeCoa ? null : createActiveCoa({ client, selection });
  const store = activeCoa ?? ownStore;

  // ---- draw form ----
  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const drawKind = kindSelect('draw-kind', Object.keys(GRAPHIC_KINDS));
  const drawSide = sideSelect('draw-side');
  const drawLabel = el('input', { attrs: { name: 'draw-label', autocomplete: 'off', maxlength: 40, placeholder: 'e.g. PL GOLD' } });
  const drawRadius = el('input', { attrs: { name: 'draw-radius', inputmode: 'decimal', autocomplete: 'off', placeholder: 'or click the edge' } });
  const radiusRow = field('Radius (km)', drawRadius);
  const drawArc = el('input', { attrs: { name: 'draw-arc', inputmode: 'decimal', autocomplete: 'off', value: '60' } });
  const drawBearing = el('input', { attrs: { name: 'draw-bearing', inputmode: 'decimal', autocomplete: 'off', placeholder: 'or click the direction' } });
  const sectorRow = el('div', { class: 'position' }, field('Arc (°)', drawArc), field('Bearing (°, typed points)', drawBearing));
  const drawButton = el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Draw', on: { click: onDraw } });
  const drawStatus = el('p', { class: 'status', attrs: { role: 'status' } });
  // Typed points: drawing without a mouse (keyboard and screen-reader users, coordinates from orders).
  const drawPoints = el('textarea', { attrs: { name: 'draw-points', rows: 3, spellcheck: 'false', placeholder: '34.05, -118.25\n34.10, -118.20' } });
  const typedRow = el('details', { class: 'more typed-points' },
    el('summary', { text: 'Or type the points' }),
    el('label', { class: 'field' }, el('span', { text: 'One "latitude, longitude" per line (a ring: its centre)' }), drawPoints),
    el('div', { class: 'actions' }, el('button', { attrs: { type: 'button' }, text: 'Add from points', on: { click: onAddTyped } })));
  const drawForm = el('fieldset', { class: 'group draw-form' }, el('legend', { text: 'New line, area or ring' }),
    el('div', { class: 'position' }, field('Kind', drawKind), field('Side', drawSide)),
    field('Label', drawLabel), radiusRow, sectorRow, el('div', { class: 'actions' }, drawButton), typedRow, drawStatus);
  const showShapeFields = () => {
    const shape = shapeOf(drawKind.value);
    radiusRow.hidden = shape !== 'circle' && shape !== 'sector';
    sectorRow.hidden = shape !== 'sector';
  };
  drawKind.addEventListener('change', showShapeFields);
  showShapeFields();
  const degreesFrom = (text) => { const t = text.trim().replace(',', '.'); return t === '' ? undefined : Number(t); };

  const list = el('ul', { class: 'graphic-items', attrs: { 'aria-label': 'Lines and areas' } });
  const editor = el('div', { class: 'graphic-editor' });
  const empty = el('p', { class: 'placeholder', text: 'Select a COA to draw lines, areas and range rings.' });
  root.replaceChildren(el('div', { class: 'graphics-panel' }, alert, empty, drawForm, list, editor));

  // ---- list and editor ----
  function renderList() {
    const selectedId = graphicSelection.get();
    list.replaceChildren(...(coa?.graphics ?? []).map((g) => el('li', { dataset: { graphicItem: g.id }, class: g.id === selectedId ? 'is-selected' : '' },
      el('button', { class: 'list-row graphic-select', attrs: { type: 'button', 'aria-current': g.id === selectedId ? 'true' : null }, on: { click: () => graphicSelection.set(g.id) } },
        el('span', { class: `graphic-swatch${g.side === 'hostile' ? ' is-dashed' : ''}`, attrs: { style: `--swatch: ${graphicColor(g)}` } }),
        el('span', { class: 'graphic-name', text: nameOf(g) }),
        el('span', { class: 'graphic-kind', text: g.label ? KIND_NAMES[g.kind] : '' })))));
  }

  // The editor is built once per selected graphic. When that graphic changes elsewhere (a drag on
  // the map, another tab) the fields you have not touched follow it; what you are typing stays.
  let editing = null; // { graphicId, touched: Set<string>, sync(graphic) }

  function renderEditor() {
    const g = coa?.graphics.find((x) => x.id === graphicSelection.get());
    if (!g) { editing = null; editor.replaceChildren(); return; }
    if (editing?.graphicId === g.id) { editing.sync(g); return; }

    const shape = shapeOf(g.kind);
    const touched = new Set();
    const current = () => coa.graphics.find((x) => x.id === g.id);
    const track = (name, control) => { ['input', 'change'].forEach((type) => control.addEventListener(type, () => touched.add(name))); return control; };
    const heading = el('h3', { class: 'subheading' });
    const kind = track('kind', kindSelect('graphic-kind', kindsOf(shape)));
    const label = track('label', el('input', { attrs: { name: 'graphic-label', autocomplete: 'off', maxlength: 40 } }));
    const side = track('side', sideSelect('graphic-side'));
    const custom = track('color', el('input', { attrs: { type: 'checkbox', name: 'graphic-custom-color' } }));
    const color = track('color', el('input', { attrs: { type: 'color', name: 'graphic-color', 'aria-label': 'Colour' } }));
    const centred = shape === 'circle' || shape === 'sector';
    const radius = centred ? track('radius', el('input', { attrs: { name: 'graphic-radius', inputmode: 'decimal' } })) : null;
    const sectorInputs = shape === 'sector' ? {
      minRadius: track('minRadius', el('input', { attrs: { name: 'graphic-min-radius', inputmode: 'decimal', placeholder: 'none' } })),
      bearing: track('bearing', el('input', { attrs: { name: 'graphic-bearing', inputmode: 'decimal' } })),
      arc: track('arc', el('input', { attrs: { name: 'graphic-arc', inputmode: 'decimal' } })),
    } : null;
    const error = el('p', { class: 'field-error' });
    const syncColor = () => {
      color.disabled = !custom.checked;
      if (!custom.checked) color.value = graphicColor({ ...current(), color: undefined, side: side.value });
    };
    custom.addEventListener('change', syncColor);
    side.addEventListener('change', syncColor);

    function sync(latest) {
      heading.textContent = `Edit ${nameOf(latest)}`;
      if (!touched.has('kind')) kind.value = latest.kind;
      if (!touched.has('label')) label.value = latest.label;
      if (!touched.has('side')) side.value = latest.side;
      if (!touched.has('color')) { custom.checked = Boolean(latest.color); color.value = graphicColor(latest); }
      if (radius && !touched.has('radius')) radius.value = String(latest.radius / 1000);
      if (sectorInputs) {
        if (!touched.has('minRadius')) sectorInputs.minRadius.value = latest.minRadius ? String(latest.minRadius / 1000) : '';
        if (!touched.has('bearing')) sectorInputs.bearing.value = String(latest.bearing);
        if (!touched.has('arc')) sectorInputs.arc.value = String(latest.arc);
      }
      syncColor();
    }

    async function onSave() {
      const latest = current();
      if (!latest) return;
      const changes = {};
      if (kind.value !== latest.kind) changes.kind = kind.value;
      if (label.value.trim() !== latest.label) changes.label = label.value;
      if (side.value !== latest.side) changes.side = side.value;
      if (custom.checked && color.value !== latest.color) changes.color = color.value;
      if (!custom.checked && latest.color) changes.color = null;
      if (radius) {
        const metres = parseKm(radius.value);
        if (!(metres > 0)) { error.textContent = 'Radius must be a number of km above 0'; return; }
        if (metres !== latest.radius) changes.radius = metres;
      }
      if (sectorInputs) {
        const min = parseKm(sectorInputs.minRadius.value);
        if (Number.isNaN(min)) { error.textContent = 'Minimum range must be a number of km, or empty'; return; }
        if ((min ?? null) !== (latest.minRadius ?? null)) changes.minRadius = min ?? null;
        for (const key of ['bearing', 'arc']) {
          const value = degreesFrom(sectorInputs[key].value);
          if (value !== latest[key]) changes[key] = value ?? sectorInputs[key].value;
        }
      }
      error.textContent = '';
      if (Object.keys(changes).length === 0) return;
      const result = await client.send('graphic.update', { coaId: coa.id, graphicId: g.id, ...changes });
      if (destroyed) return;
      if (result.ok) touched.clear(); else error.textContent = describeError(result.error);
    }
    async function onDelete() {
      const result = await client.send('graphic.remove', { coaId: coa.id, graphicId: g.id });
      if (destroyed) return;
      if (result.ok) graphicSelection.set(null); else error.textContent = describeError(result.error);
    }

    editing = { graphicId: g.id, sync };
    sync(g);
    editor.replaceChildren(el('div', { class: 'stack graphic-editor-body' },
      heading,
      el('div', { class: 'position' }, field('Kind', kind), field('Side', side)),
      field('Label', label),
      el('div', { class: 'check' }, el('label', { class: 'check' }, custom, el('span', { text: 'Own colour' })), color),
      radius ? field(shape === 'sector' ? 'Range (km)' : 'Radius (km)', radius) : null,
      sectorInputs ? field('Minimum range (km, optional)', sectorInputs.minRadius) : null,
      sectorInputs ? el('div', { class: 'position' }, field('Bearing (° true)', sectorInputs.bearing), field('Arc (°)', sectorInputs.arc)) : null,
      error,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onDelete } })),
      el('p', { class: 'hint', text: shape === 'sector'
        ? 'On the map: drag the centre to move the sector; drag the handle on its rim to change its range and direction.'
        : shape === 'circle'
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
    const radius = shape === 'circle' || shape === 'sector' ? parseKm(drawRadius.value) : undefined;
    if (Number.isNaN(radius)) { drawStatus.textContent = 'Radius must be a number of km above 0, or empty to click the edge.'; return; }
    const arc = degreesFrom(drawArc.value) ?? 60;
    if (shape === 'sector' && !(arc > 0 && arc <= 360)) { drawStatus.textContent = 'Arc must be more than 0 and at most 360 degrees.'; return; }
    const target = { coaId: coa.id, kind: drawKind.value, side: drawSide.value, label: drawLabel.value };
    drawer.request({ shape, ...(radius ? { radius } : {}), ...(shape === 'sector' ? { arc } : {}) }, async (geometry) => {
      const result = await client.send('graphic.add', { ...target, ...geometry });
      if (destroyed) return;
      if (!result.ok) { alert.textContent = describeError(result.error); return; }
      alert.textContent = '';
      drawLabel.value = '';
      graphicSelection.set(result.value.graphic.id);
    });
  }
  /** "34.1, -118.2" lines → points, or the number of the first line that is not a pair of numbers. */
  function parsePoints(text) {
    const points = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') continue;
      const m = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(line);
      if (!m) return { badLine: i + 1 };
      points.push({ lat: Number(m[1]), lng: Number(m[2]) });
    }
    return { points };
  }

  async function onAddTyped() {
    if (!coa) return;
    const parsed = parsePoints(drawPoints.value);
    if (parsed.badLine) { drawStatus.textContent = `Line ${parsed.badLine} is not "latitude, longitude" (decimal degrees).`; return; }
    const shape = shapeOf(drawKind.value);
    let geometry;
    if (shape === 'circle') {
      const radius = parseKm(drawRadius.value);
      if (parsed.points.length !== 1 || !(radius > 0)) { drawStatus.textContent = 'A ring needs one centre line and a radius in km.'; return; }
      geometry = { center: parsed.points[0], radius };
    } else if (shape === 'sector') {
      const radius = parseKm(drawRadius.value);
      const bearing = degreesFrom(drawBearing.value);
      if (parsed.points.length !== 1 || !(radius > 0) || bearing === undefined) { drawStatus.textContent = 'A sector needs one centre line, a radius in km, a bearing and an arc.'; return; }
      geometry = { center: parsed.points[0], radius, bearing, arc: degreesFrom(drawArc.value) ?? 60 };
    } else {
      geometry = { points: parsed.points };
    }
    const result = await client.send('graphic.add', { coaId: coa.id, kind: drawKind.value, side: drawSide.value, label: drawLabel.value, ...geometry });
    if (destroyed) return;
    if (!result.ok) { drawStatus.textContent = describeError(result.error); return; }
    drawStatus.textContent = '';
    drawPoints.value = '';
    drawLabel.value = '';
    graphicSelection.set(result.value.graphic.id);
  }

  const offDrawer = drawer.subscribe((request) => {
    drawButton.textContent = request ? 'Cancel drawing' : 'Draw';
    drawStatus.textContent = request ? 'Drawing on the map…' : '';
  });

  function apply(next, { error } = {}) {
    if (destroyed) return;
    coa = next;
    alert.textContent = error ? describeError(error) : '';
    render();
  }

  const unsubscribes = [
    store.subscribe(apply),
    selection.subscribe(() => { if (drawer.isActive()) drawer.cancel(); }),
    graphicSelection.subscribe(() => render()),
    offDrawer,
  ];

  return {
    ready: store.ready.then(() => apply(store.get())),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      ownStore?.destroy();
    },
  };
}
