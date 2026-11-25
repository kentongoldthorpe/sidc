// Template editor (driving adapter, Epic 3 T-2b/T-3): the template shown on the canvas — the threat
// model's formation or a threat COA's play (where units also get an end position, D26) — units
// (symbol, label, position in metres, facing, weapons, HVT tag) and lines and areas drawn on the
// template canvas. Every change replaces the formation (threat-model.set-template) through the store.
import { el, describeError } from './dom.js';
import { AFFILIATIONS, UNIT_TYPES, ECHELONS, composeSidc, readSidc } from '../sidc-builder.js';
import { GRAPHIC_KINDS, shapeOf } from '../../../domain/graphic.js';
import { KIND_NAMES } from './graphics-view.js';
import { mountWeaponsEditor } from './weapons-editor.js';

const DEFAULT_SIDC = '10061000001211000000'; // hostile infantry: a threat model's units are the threat's
const FIELD_NAMES = Object.freeze({ sidc: 'SIDC', label: 'Label', x: 'Across (x)', y: 'Along (y)', facing: 'Facing', weapons: 'Weapons', hvt: 'HVT', end: 'End position' });

const numberFrom = (text) => { const t = String(text).trim().replace(',', '.'); const n = Number(t); return t !== '' && Number.isFinite(n) ? n : t; };

/** @param {{ client: object, root: HTMLElement, store: object, unitSelection: object, canvas: object }} options */
export function mountTemplateEditorView({ client, root, store, unitSelection, canvas }) {
  let destroyed = false;
  let editing = null; // { unitId | null, sync(unit) }

  const empty = el('p', { class: 'placeholder', text: 'Select or create a threat model to edit its template.' });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const unitList = el('ul', { class: 'graphic-items', attrs: { 'aria-label': 'Template units' } });
  const unitEditor = el('div', { class: 'system-editor' });
  const graphicList = el('ul', { class: 'graphic-items', attrs: { 'aria-label': 'Template lines and areas' } });
  const drawKind = el('select', { attrs: { name: 'template-draw-kind' } }, ...Object.keys(GRAPHIC_KINDS).map((k) => el('option', { attrs: { value: k }, text: KIND_NAMES[k] })));
  const drawLabel = el('input', { attrs: { name: 'template-draw-label', autocomplete: 'off', maxlength: 40, placeholder: 'e.g. AXIS, OBJ' } });
  const drawAnnotation = el('input', { attrs: { name: 'template-draw-annotation', autocomplete: 'off', maxlength: 40, placeholder: 'e.g. H+2' } });
  const drawAnnotationField = el('label', { class: 'field' }, el('span', { text: 'Text above the line' }), drawAnnotation);
  const showDrawAnnotation = () => { drawAnnotationField.hidden = shapeOf(drawKind.value) !== 'line'; };
  drawKind.addEventListener('change', showDrawAnnotation);
  const graphicEditor = el('div', { class: 'system-editor' });
  let editingGraphic = null; // the id of the line or area being edited
  const drawButton = el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Draw', on: { click: onDraw } });
  const playLabel = el('p', { class: 'hint', dataset: { playLabel: '' } });
  const content = el('div', { class: 'stack' }, playLabel,
    el('div', { class: 'actions' }, el('button', { attrs: { type: 'button' }, text: 'Add unit', on: { click: () => openEditor(null) } })),
    unitList, unitEditor,
    el('fieldset', { class: 'group' }, el('legend', { text: 'Lines and areas' }),
      el('div', { class: 'position' },
        el('label', { class: 'field' }, el('span', { text: 'Kind' }), drawKind),
        el('label', { class: 'field' }, el('span', { text: 'Label' }), drawLabel)),
      drawAnnotationField,
      el('div', { class: 'actions' }, drawButton), graphicList, graphicEditor),
    status);
  root.replaceChildren(el('div', { class: 'template-editor' }, empty, content));

  const say = (text) => { status.textContent = text; };

  function render(model) {
    empty.hidden = model !== null;
    content.hidden = model === null;
    const formation = (model ? store.template() : null) ?? { units: [], graphics: [] };
    const play = model?.coas.find((c) => c.id === store.play());
    playLabel.textContent = play ? `Editing the play of ${play.name}. Give units an end position to show their moves.` : 'Editing the formation (the doctrinal template).';
    const selected = unitSelection.get();
    unitList.replaceChildren(...formation.units.map((u) => el('li', { dataset: { unitRow: u.id } },
      el('button', { class: 'list-row system-select', attrs: { type: 'button', 'aria-current': u.id === selected ? 'true' : null }, on: { click: () => unitSelection.set(u.id) } },
        el('span', { class: 'system-name unit-name', text: u.label || u.sidc }),
        el('span', { class: 'system-meta', text: `${u.x}, ${u.y} m${u.end ? ` → ${u.end.x}, ${u.end.y} m` : ''}${u.facing ? ` · facing ${u.facing}°` : ''}${u.weapons?.length ? ` · ${u.weapons.length} weapon${u.weapons.length === 1 ? '' : 's'}` : ''}${u.hvt ? ' · HVT' : ''}` })))));
    graphicList.replaceChildren(...formation.graphics.map((g) => el('li', { class: 'actions', dataset: { graphicRow: g.id } },
      el('span', { class: 'system-name', text: g.label || KIND_NAMES[g.kind] }),
      g.annotation ? el('span', { class: 'system-meta', text: g.annotation }) : null,
      el('button', { class: 'link', attrs: { type: 'button', 'aria-label': `Edit ${g.label || KIND_NAMES[g.kind]}` }, text: 'Edit', on: { click: () => openGraphicEditor(g.id) } }),
      el('button', { class: 'link', attrs: { type: 'button', 'aria-label': `Remove ${g.label || KIND_NAMES[g.kind]}` }, text: 'Remove', on: { click: () => removeGraphic(g.id) } }))));
    if (editingGraphic && !formation.graphics.some((g) => g.id === editingGraphic)) closeGraphicEditor();
    if (editing?.unitId) {
      const unit = formation.units.find((u) => u.id === editing.unitId);
      if (unit) editing.sync(unit); else closeEditor();
    }
  }

  // ---- unit editor ----
  function openEditor(unitId) {
    const model = store.get();
    if (!model) return;
    const template = store.template();
    if (!template) return; // the play shown is still loading
    const unit = unitId ? template.units.find((u) => u.id === unitId) : null;
    const inPlay = store.play() !== 'formation';
    const touched = new Set();
    const track = (key, control) => { ['input', 'change'].forEach((t) => control.addEventListener(t, () => touched.add(key))); return control; };
    const select = (name, options) => el('select', { attrs: { name } }, ...options.map(([v, t]) => el('option', { attrs: { value: v }, text: t })));
    const affiliation = select('affiliation', AFFILIATIONS);
    const unitType = select('unitType', [['', 'Custom (typed SIDC)'], ...UNIT_TYPES]);
    const echelon = select('echelon', ECHELONS);
    const hq = el('input', { attrs: { type: 'checkbox', name: 'hq' } });
    const sidc = track('sidc', el('input', { attrs: { name: 'unit-sidc', autocomplete: 'off', spellcheck: 'false' } }));
    const label = track('label', el('input', { attrs: { name: 'unit-label', autocomplete: 'off', maxlength: 30 } }));
    const x = track('x', el('input', { attrs: { name: 'unit-x', inputmode: 'decimal', autocomplete: 'off' } }));
    const y = track('y', el('input', { attrs: { name: 'unit-y', inputmode: 'decimal', autocomplete: 'off' } }));
    const facing = track('facing', el('input', { attrs: { name: 'unit-facing', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' } }));
    const hvt = track('hvt', el('input', { attrs: { type: 'checkbox', name: 'unit-hvt' } }));
    const endX = track('end', el('input', { attrs: { name: 'end-x', inputmode: 'decimal', autocomplete: 'off', placeholder: 'no move' } }));
    const endY = track('end', el('input', { attrs: { name: 'end-y', inputmode: 'decimal', autocomplete: 'off', placeholder: 'no move' } }));
    const weaponsEditor = mountWeaponsEditor({ templates: store.templates(), name: 'unit-weapons', onChange: () => touched.add('weapons') });
    // A new unit can start from a unit template (D29): its symbol, label, HVT tag, weapons and details are copied.
    let fromTemplate = null;
    const startFrom = unit || store.templates().length === 0 ? null : el('select', { attrs: { name: 'unit-template' } },
      el('option', { attrs: { value: '' }, text: 'Start from a unit template…' }),
      ...store.templates().map((t) => el('option', { attrs: { value: t.id }, text: t.name })));
    startFrom?.addEventListener('change', () => {
      const t = store.templates().find((x) => x.id === startFrom.value);
      if (!t) return;
      fromTemplate = t;
      showSidc(t.sidc);
      label.value = t.label;
      hvt.checked = t.hvt === true;
      weaponsEditor.set(t.weapons ?? []);
      ['sidc', 'label', 'hvt', 'weapons'].forEach((k) => touched.add(k));
    });
    const errors = el('ul', { class: 'import-problems' });

    const fromBuilder = () => {
      touched.add('sidc');
      if (unitType.value) sidc.value = composeSidc({ affiliation: affiliation.value, unitType: unitType.value, echelon: echelon.value, hq: hq.checked });
    };
    [affiliation, unitType, echelon, hq].forEach((c) => c.addEventListener('change', fromBuilder));
    const showSidc = (value) => {
      sidc.value = value;
      const parts = readSidc(value);
      affiliation.value = parts?.affiliation ?? '6';
      unitType.value = parts?.unitType ?? '';
      echelon.value = parts?.echelon ?? '00';
      hq.checked = parts?.hq ?? false;
    };

    function sync(u) {
      if (!touched.has('sidc')) showSidc(u.sidc);
      if (!touched.has('label')) label.value = u.label;
      if (!touched.has('x')) x.value = String(u.x);
      if (!touched.has('y')) y.value = String(u.y);
      if (!touched.has('facing')) facing.value = String(u.facing);
      if (!touched.has('hvt')) hvt.checked = u.hvt;
      if (!touched.has('weapons')) weaponsEditor.set(u.weapons ?? []);
      if (!touched.has('end')) { endX.value = u.end ? String(u.end.x) : ''; endY.value = u.end ? String(u.end.y) : ''; }
    }

    async function onSave() {
      const fields = {
        sidc: sidc.value, label: label.value, x: numberFrom(x.value), y: numberFrom(y.value),
        facing: facing.value.trim() === '' ? 0 : numberFrom(facing.value), hvt: hvt.checked,
        weapons: weaponsEditor.value(),
      };
      const noEnd = endX.value.trim() === '' && endY.value.trim() === '';
      if (inPlay && !noEnd) fields.end = { x: numberFrom(endX.value), y: numberFrom(endY.value) };
      if (!unitId && fromTemplate?.details) fields.details = fromTemplate.details;
      let index = -1;
      const result = await store.saveTemplate((t) => {
        const merge = (u) => { const next = { ...u, ...fields }; if (inPlay && noEnd) delete next.end; return next; };
        const units = unitId ? t.units.map((u) => (u.id === unitId ? merge(u) : u)) : [...t.units, fields];
        index = unitId ? units.findIndex((u) => u.id === unitId) : units.length - 1;
        return { ...t, units };
      });
      if (destroyed) return;
      if (result.ok) { say(`Saved ${fields.label || 'the unit'}.`); closeEditor(); return; }
      const prefix = `template.units[${index}]`;
      const mine = (result.error.details?.problems ?? []).filter((p) => p.field.startsWith(prefix));
      errors.replaceChildren(...(mine.length ? mine : [{ field: '', reason: describeError(result.error) }]).map((p) => {
        const key = p.field.slice(prefix.length + 1).split(/[.[]/)[0];
        return el('li', { text: key ? `${FIELD_NAMES[key] ?? key}: ${p.reason}` : p.reason });
      }));
    }

    async function onRemove() {
      const result = await store.saveTemplate((t) => ({ ...t, units: t.units.filter((u) => u.id !== unitId) }));
      if (destroyed) return;
      if (!result.ok) { errors.replaceChildren(el('li', { text: describeError(result.error) })); return; }
      unitSelection.set(null);
      closeEditor();
    }

    const pick = () => canvas.picker.request((p) => {
      x.value = String(p.x); y.value = String(p.y);
      touched.add('x'); touched.add('y');
    });

    const pickEnd = () => canvas.picker.request((p) => {
      endX.value = String(p.x); endY.value = String(p.y);
      touched.add('end');
    });
    const clearEnd = () => { endX.value = ''; endY.value = ''; touched.add('end'); };

    editing = { unitId, sync };
    if (unit) sync(unit); else { showSidc(DEFAULT_SIDC); x.value = '0'; y.value = '0'; facing.value = '0'; }
    const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
    unitEditor.replaceChildren(el('fieldset', { class: 'group' }, el('legend', { text: unit ? `Edit ${unit.label || 'unit'}` : 'New unit' }),
      startFrom ? field('Unit template', startFrom) : null,
      el('div', { class: 'position' }, field('Affiliation', affiliation), field('Echelon', echelon)),
      field('Unit type', unitType),
      el('label', { class: 'check' }, hq, el('span', { text: 'Headquarters' })),
      field('SIDC', sidc), field('Label', label),
      el('div', { class: 'position' }, field('Across, x (m)', x), field('Along, y (m)', y)),
      el('div', { class: 'actions' }, el('button', { attrs: { type: 'button' }, text: 'Pick on canvas', on: { click: pick } })),
      inPlay ? el('fieldset', { class: 'group' }, el('legend', { text: 'Move in this play (end position)' }),
        el('div', { class: 'position' }, field('End x (m)', endX), field('End y (m)', endY)),
        el('div', { class: 'actions' },
          el('button', { attrs: { type: 'button' }, text: 'Pick end on canvas', on: { click: pickEnd } }),
          el('button', { class: 'link', attrs: { type: 'button' }, text: 'No movement', on: { click: clearEnd } }))) : null,
      field('Facing (°, 0 = direction of attack)', facing),
      weaponsEditor.element,
      el('label', { class: 'check' }, hvt, el('span', { text: 'High-value target (HVT)' })),
      errors,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: closeEditor } }),
        unit ? el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Remove unit', on: { click: onRemove } }) : null)));
    render(store.get());
  }

  function closeEditor() {
    editing = null;
    canvas.picker.cancel();
    unitEditor.replaceChildren();
  }

  // ---- lines and areas ----
  function onDraw() {
    if (canvas.drawer.isActive()) { canvas.drawer.cancel(); return; }
    const kind = drawKind.value;
    const label = drawLabel.value;
    const annotation = shapeOf(kind) === 'line' ? drawAnnotation.value.trim() : '';
    canvas.drawer.request({ shape: shapeOf(kind) }, async (geometry) => {
      const toMetres = (p) => ({ x: Math.round(p.lng), y: Math.round(p.lat) });
      const shape = geometry.points ? { points: geometry.points.map(toMetres) } : { center: toMetres(geometry.center), radius: geometry.radius };
      const result = await store.saveTemplate((t) => ({ ...t, graphics: [...t.graphics, { kind, label, ...(annotation ? { annotation } : {}), side: 'hostile', ...shape }] }));
      if (destroyed) return;
      if (result.ok) { drawLabel.value = ''; drawAnnotation.value = ''; say(''); } else say(describeError(result.error));
    });
  }
  function openGraphicEditor(id) {
    const g = store.template()?.graphics.find((x) => x.id === id);
    if (!g) return;
    editingGraphic = id;
    const line = shapeOf(g.kind) === 'line';
    const label = el('input', { attrs: { name: 'template-graphic-label', autocomplete: 'off', maxlength: 40 } });
    const annotation = line ? el('input', { attrs: { name: 'template-graphic-annotation', autocomplete: 'off', maxlength: 40, placeholder: 'e.g. H+2' } }) : null;
    label.value = g.label;
    if (annotation) annotation.value = g.annotation ?? '';
    const error = el('p', { class: 'field-error' });
    async function onSave() {
      const text = annotation?.value.trim() ?? '';
      const result = await store.saveTemplate((t) => ({ ...t, graphics: t.graphics.map((x) => {
        if (x.id !== id) return x;
        const { annotation: _old, ...rest } = x;
        return { ...rest, label: label.value, ...(text ? { annotation: text } : {}) };
      }) }));
      if (destroyed) return;
      if (result.ok) closeGraphicEditor();
      else error.textContent = (result.error.details?.problems ?? []).map((p) => `${p.field.replace(/^.*\]\./, '')}: ${p.reason}`).join('; ') || describeError(result.error);
    }
    const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
    graphicEditor.replaceChildren(el('fieldset', { class: 'group', dataset: { templateGraphicEditor: '' } }, el('legend', { text: `Edit ${g.label || KIND_NAMES[g.kind]}` }),
      field('Label', label), annotation ? field('Text above the line', annotation) : null, error,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: closeGraphicEditor } }))));
  }
  function closeGraphicEditor() { editingGraphic = null; graphicEditor.replaceChildren(); }

  async function removeGraphic(id) {
    const result = await store.saveTemplate((t) => ({ ...t, graphics: t.graphics.filter((g) => g.id !== id) }));
    if (!result.ok && !destroyed) say(describeError(result.error));
  }

  const offs = [
    store.subscribe((model, { switched }) => { if (switched) { closeEditor(); closeGraphicEditor(); unitSelection.set(null); } render(model); }),
    unitSelection.subscribe((id) => { if (id === null) { if (editing?.unitId) closeEditor(); render(store.get()); } else if (editing?.unitId !== id) openEditor(id); }),
    canvas.drawer.subscribe((request) => { drawButton.textContent = request ? 'Cancel drawing' : 'Draw'; }),
  ];

  return {
    ready: store.ready.then(() => { showDrawAnnotation(); render(store.get()); }),
    destroy() { destroyed = true; offs.forEach((off) => off()); },
  };
}
