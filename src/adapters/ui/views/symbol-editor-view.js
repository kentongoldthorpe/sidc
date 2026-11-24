// Symbol editor view (driving adapter): lists the selected COA's units and adds, edits and deletes
// them. The SIDC can be built from presets (affiliation, unit type, echelon, HQ) or typed, with a
// live preview. "Pick on map" fills the position from the next map click.
import { el, describeError } from './dom.js';
import { AFFILIATIONS, UNIT_TYPES, ECHELONS, composeSidc, readSidc } from '../sidc-builder.js';
import { createActiveCoa } from '../active-coa.js';
import { mountWeaponsEditor } from './weapons-editor.js';
import { unitFromTemplate } from '../../../domain/unit-template.js';

const TEXT_MODIFIERS = Object.freeze([
  ['higherFormation', 'Higher formation'], ['additionalInformation', 'Additional information'],
  ['staffComments', 'Staff comments'], ['dtg', 'Date-time group'], ['quantity', 'Quantity'],
]);
const PREVIEW_DELAY_MS = 150;
const THUMB_SIZE = 22;
const PREVIEW_SIZE = 56;
const DEFAULT_SIDC = composeSidc({ affiliation: '3', unitType: '121100', echelon: '00', hq: false });
/** Copies made within the same COA are nudged south-east so they don't sit on the originals. */
const SAME_COA_OFFSET = Object.freeze({ lat: -0.005, lng: 0.005 });
const unitsText = (n) => `${n} unit${n === 1 ? '' : 's'}`;

/** "" or not a number → null, so the app reports "must be a number" instead of guessing. */
const toNumber = (text) => {
  if (String(text).trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** Where a reply's problem field is shown in the form. */
function formFieldFor(problemField) {
  if (problemField === 'position' || problemField === 'position.lat') return 'lat';
  if (problemField === 'position.lng') return 'lng';
  if (problemField.startsWith('modifiers.')) return problemField.slice('modifiers.'.length);
  if (problemField.startsWith('weapons')) return 'weapons';
  if (/^details\.(strength|reference|notes)$/.test(problemField)) return problemField.replace('.', '-');
  return problemField;
}

/**
 * @param {{ client: object, root: HTMLElement, selection: object, symbolSelection: object, picker: object, activeCoa?: object }} options
 *   activeCoa: the shared active-COA store (one is created when the view is mounted on its own).
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountSymbolEditorView({ client, root, selection, symbolSelection, picker, activeCoa, onRePlace = null }) {
  let destroyed = false;
  let coa = null;
  const ownStore = activeCoa ? null : createActiveCoa({ client, selection });
  const store = activeCoa ?? ownStore;
  let form = null; // { mode: 'add' | 'edit', symbolId?, element, fields, errors, preview, status }
  const thumbs = new Map();
  const checked = new Set(); // units ticked for group copy / delete
  let pendingDelete = null; // { symbolIds: string[] } awaiting confirmation
  let templates = []; // the project's unit templates: start a unit from one, or copy a weapon (D29)
  const loadTemplates = async () => { const r = await client.ask('unit-template.list'); if (r.ok && !destroyed) templates = r.value; };

  // ---- static structure ----
  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const heading = el('p', { class: 'placeholder', text: 'Select a COA to see and edit its units.' });
  const addButton = el('button', { attrs: { type: 'button' }, text: 'Add unit', on: { click: () => openForm({ mode: 'add' }) } });
  const list = el('ul', { class: 'unit-items', dataset: { units: '' }, attrs: { 'aria-label': 'Units' } });
  const formSlot = el('div');
  const targetSelect = el('select', { attrs: { 'aria-label': 'Copy to' } });
  const bulkCount = el('span', { class: 'bulk-count' });
  const bulk = el('div', { class: 'bulk', dataset: { bulk: '' }, attrs: { hidden: true } },
    bulkCount,
    el('label', { class: 'field' }, el('span', { text: 'Copy to' }), targetSelect),
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Copy', on: { click: copyChecked } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: askDeleteChecked } }),
      el('button', { attrs: { type: 'button' }, text: 'Clear', on: { click: () => { checked.clear(); renderList(); } } })));
  const bulkStatus = el('p', { class: 'status bulk-status', dataset: { bulkStatus: '' }, attrs: { role: 'status' } });
  const confirmText = el('p');
  const dialog = el('dialog', { class: 'confirm', attrs: { 'aria-label': 'Confirm delete' } },
    confirmText,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onConfirmDelete } })));
  // A COA placed from a threat play stays linked to it (D30): say so, and offer to follow the play
  // or to move or turn the whole COA.
  const linkText = el('span', {});
  const linkChanged = el('strong', { class: 'link-changed', text: ' The play has changed since.' });
  const linkStatus = el('p', { class: 'status', attrs: { role: 'status' } });
  const linkBar = el('div', { class: 'linked-coa', dataset: { linkedCoa: '' }, attrs: { hidden: true } },
    el('p', { class: 'hint' }, linkText, linkChanged),
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Update from template', on: { click: onUpdateFromTemplate } }),
      onRePlace ? el('button', { attrs: { type: 'button' }, text: 'Move or turn…', on: { click: () => coa && onRePlace(coa) } }) : null),
    linkStatus);
  let linkSeq = 0;
  async function renderLink() {
    const seq = ++linkSeq;
    if (!coa?.source) { linkBar.hidden = true; return; }
    const got = await client.ask('threat-model.get', { modelId: coa.source.threatModelId });
    if (destroyed || seq !== linkSeq || !coa?.source) return;
    linkBar.hidden = false;
    if (!got.ok) { linkText.textContent = 'Placed from a threat model that no longer exists.'; linkChanged.hidden = true; return; }
    const model = got.value;
    const play = coa.source.play === 'formation' ? 'its formation' : model.coas.find((c) => c.id === coa.source.play)?.name ?? 'a play that no longer exists';
    linkText.textContent = `Placed from ${model.name}, ${play}. Linked units follow the play when you update.`;
    linkChanged.hidden = coa.source.modelRevision === undefined || model.revision <= coa.source.modelRevision;
  }
  async function onUpdateFromTemplate() {
    if (!coa) return;
    const result = await client.send('coa.update-from-template', { coaId: coa.id, expectedRevision: coa.revision });
    if (destroyed) return;
    linkStatus.textContent = result.ok ? 'Updated from the template.' : describeError(result.error);
  }
  root.replaceChildren(el('div', { class: 'symbol-editor', dataset: { symbolEditor: '' } }, alert, heading, linkBar, addButton, list, bulk, bulkStatus, formSlot, dialog));
  const showAlert = (text) => { alert.textContent = text; };

  // ---- previews (thumbnails and the form's live preview) ----
  function thumbnail(symbol) {
    const key = JSON.stringify([symbol.sidc, symbol.modifiers.direction ?? null]);
    if (!thumbs.has(key)) thumbs.set(key, client.ask('symbol.preview', { sidc: symbol.sidc, size: THUMB_SIZE }).then((r) => (r.ok ? r.value.svg : '')));
    return thumbs.get(key);
  }

  // ---- unit list ----
  function renderList() {
    const has = coa !== null;
    heading.hidden = has;
    addButton.hidden = !has;
    list.replaceChildren(...(has ? coa.symbols : []).map((symbol) => {
      const thumb = el('span', { class: 'unit-thumb', dataset: { thumb: '' }, attrs: { 'aria-hidden': 'true' } });
      thumbnail(symbol).then((svg) => { thumb.innerHTML = svg; }); // renderer SVG only (milsymbol escapes text)
      const tick = el('input', {
        dataset: { checkUnit: '' },
        attrs: { type: 'checkbox', 'aria-label': `Select ${symbol.label || symbol.sidc}`, checked: checked.has(symbol.id) },
        on: { change: (e) => { if (e.target.checked) checked.add(symbol.id); else checked.delete(symbol.id); renderBulk(); } },
      });
      return el('li', { class: 'unit-row', dataset: { symbolId: symbol.id } },
        tick,
        el('button', {
          class: 'list-row unit-select', dataset: { selectUnit: '' },
          attrs: { type: 'button', 'aria-current': symbol.id === symbolSelection.get() ? 'true' : null },
          on: { click: () => symbolSelection.set(symbol.id) },
        },
        thumb,
        el('span', { class: 'unit-label', dataset: { unitLabel: '' }, text: symbol.label || symbol.sidc })));
    }));
    renderBulk();
  }

  // ---- group actions on ticked units ----
  async function renderBulk() {
    const ids = coa ? coa.symbols.map((x) => x.id).filter((id) => checked.has(id)) : [];
    bulk.hidden = ids.length === 0;
    bulkCount.textContent = `${ids.length} selected`;
    if (bulk.hidden) return;
    const result = await client.ask('coa.list', {});
    if (!result.ok || destroyed || coa === null) return;
    const previous = targetSelect.value;
    targetSelect.replaceChildren(
      el('option', { attrs: { value: coa.id }, text: 'This COA' }),
      ...result.value.filter((x) => x.id !== coa.id).map((x) => el('option', { attrs: { value: x.id }, text: x.name })));
    if ([...targetSelect.options].some((o) => o.value === previous)) targetSelect.value = previous;
  }

  const checkedInOrder = () => coa.symbols.map((x) => x.id).filter((id) => checked.has(id));

  async function copyChecked() {
    const symbolIds = checkedInOrder();
    const targetId = targetSelect.value || coa.id;
    const targetName = targetSelect.selectedOptions[0]?.textContent ?? '';
    const sameCoa = targetId === coa.id;
    const result = await client.send('symbol.copy', {
      coaId: targetId, fromCoaId: coa.id, symbolIds, ...(sameCoa ? { offset: SAME_COA_OFFSET } : {}),
    });
    if (!result.ok) { showAlert(describeError(result.error)); return; }
    checked.clear();
    bulkStatus.textContent = sameCoa ? `Copied ${unitsText(symbolIds.length)}.` : `Copied ${unitsText(symbolIds.length)} to “${targetName}”.`;
    renderList();
  }

  function askDeleteChecked() {
    pendingDelete = { symbolIds: checkedInOrder() };
    confirmText.textContent = `Delete ${unitsText(pendingDelete.symbolIds.length)}? This cannot be undone.`;
    dialog.showModal();
  }

  /** Show the active COA (from the shared store). */
  function apply(next, { error = null } = {}) {
    if (destroyed) return;
    if (next === null) { coa = null; closeForm(); renderList(); renderLink(); if (error) showAlert(describeError(error)); return; }
    coa = next;
    renderList();
    renderLink();
    const selected = symbolSelection.get();
    if (selected !== null && !coa.symbols.some((s) => s.id === selected)) {
      symbolSelection.set(null); // its unit is gone
    } else if (selected !== null && form?.symbolId !== selected) {
      openForm({ mode: 'edit', symbolId: selected });
    } else if (form?.mode === 'edit') {
      // Follow changes made elsewhere (a drag on the map, another tab) in every field the user
      // has not changed, so Save never puts back stale values.
      fillForm(coa.symbols.find((x) => x.id === form.symbolId), { onlyUntouched: true });
    }
  }

  // ---- the form ----
  function input(name, label, attrs = {}) {
    const control = el('input', { attrs: { name, autocomplete: 'off', 'aria-describedby': `unit-error-${name}`, ...attrs } });
    return { control, row: el('label', { class: 'field' }, el('span', { text: label }), control) };
  }
  const select = (name, label, options) => {
    const control = el('select', { attrs: { name } }, ...options.map(([value, text]) => el('option', { attrs: { value }, text })));
    return { control, row: el('label', { class: 'field' }, el('span', { text: label }), control) };
  };
  const errorSlot = (name) => el('p', { class: 'field-error', dataset: { errorFor: name }, attrs: { id: `unit-error-${name}` } });

  function openForm({ mode, symbolId }) {
    const symbol = mode === 'edit' ? coa?.symbols.find((s) => s.id === symbolId) : null;
    if (mode === 'edit' && !symbol) return;
    picker.cancel();

    const fields = {};
    const errors = {};
    const add = (name, built) => { fields[name] = built.control; errors[name] = errorSlot(name); return [built.row, errors[name]]; };

    const affiliation = select('affiliation', 'Affiliation', AFFILIATIONS);
    const unitType = select('unitType', 'Unit type', [['', 'Custom (typed SIDC)'], ...UNIT_TYPES]);
    const echelon = select('echelon', 'Echelon', ECHELONS);
    const hq = el('input', { attrs: { type: 'checkbox', name: 'hq' } });
    Object.assign(fields, { affiliation: affiliation.control, unitType: unitType.control, echelon: echelon.control, hq });

    const sidcRows = add('sidc', input('sidc', 'SIDC', { spellcheck: 'false', inputmode: 'text' }));
    const preview = el('div', { class: 'unit-preview', dataset: { preview: '' }, attrs: { 'aria-hidden': 'true' } });
    const status = el('p', { class: 'preview-status', dataset: { previewStatus: '' }, attrs: { 'aria-live': 'polite' } });
    const labelRows = add('label', input('label', 'Label (unique designation)'));
    const latRows = add('lat', input('lat', 'Latitude', { inputmode: 'decimal' }));
    const lngRows = add('lng', input('lng', 'Longitude', { inputmode: 'decimal' }));
    const pickButton = el('button', { attrs: { type: 'button' }, text: 'Pick on map', on: { click: pickOnMap } });
    const modifierRows = TEXT_MODIFIERS.flatMap(([name, label]) => add(name, input(name, label)));
    const directionRows = add('direction', input('direction', 'Direction of movement (degrees)', { inputmode: 'decimal' }));
    // Unit extras (D28): HVT tag, facing, weapons (drawn as ranges) and reference details.
    const hvt = el('input', { attrs: { type: 'checkbox', name: 'hvt' } });
    fields.hvt = hvt; errors.hvt = errorSlot('hvt');
    const facingRows = add('facing', input('facing', 'Facing (degrees; weapons with an arc point this way)', { inputmode: 'decimal', placeholder: 'none' }));
    const weapons = mountWeaponsEditor({ templates, name: 'unit-weapons', onChange: () => form?.touched.add('weapons') });
    const startFrom = mode === 'add' && templates.length ? el('select', { attrs: { name: 'unit-template' } },
      el('option', { attrs: { value: '' }, text: 'Start from a unit template…' }),
      ...templates.map((t) => el('option', { attrs: { value: t.id }, text: t.name }))) : null;
    startFrom?.addEventListener('change', () => {
      const t = templates.find((x) => x.id === startFrom.value);
      if (!t) return;
      const { lat, lng } = { lat: form.fields.lat.value, lng: form.fields.lng.value }; // keep where the unit goes
      fillForm({ ...unitFromTemplate(t), modifiers: {}, position: null }, { onlyUntouched: false });
      form.fields.lat.value = lat; form.fields.lng.value = lng;
      schedulePreview(0);
    });
    fields.weapons = weapons.element; errors.weapons = errorSlot('weapons');
    const detailRows = [['details-strength', 'Strength'], ['details-reference', 'Source / reference'], ['details-notes', 'Notes']]
      .flatMap(([name, label]) => add(name, input(name, label)));

    const linkNote = el('div', { class: 'link-note', dataset: { linkNote: '' } });
    const element = el('form', { class: 'unit-form', dataset: { unitForm: '' }, attrs: { novalidate: true }, on: { submit: onSave } },
      el('h3', { class: 'subheading', text: mode === 'add' ? 'New unit' : 'Edit unit' }),
      linkNote,
      startFrom ? el('label', { class: 'field' }, el('span', { text: 'Unit template' }), startFrom) : null,
      el('fieldset', { class: 'builder' }, el('legend', { text: 'Symbol' }),
        affiliation.row, unitType.row, echelon.row,
        el('label', { class: 'check' }, hq, el('span', { text: 'Headquarters' })),
        ...sidcRows, el('div', { class: 'preview-row' }, preview, status)),
      ...labelRows,
      el('div', { class: 'position' }, el('div', {}, ...latRows), el('div', {}, ...lngRows)),
      el('div', { class: 'actions' }, pickButton),
      el('label', { class: 'check' }, hvt, el('span', { text: 'High-value target (HVT)' })), errors.hvt,
      ...facingRows,
      weapons.element, errors.weapons,
      el('details', { class: 'more' }, el('summary', { text: 'More fields' }), ...modifierRows, ...directionRows),
      el('details', { class: 'more' }, el('summary', { text: 'Details (strength, source, notes)' }), ...detailRows),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'submit' }, text: 'Save' }),
        el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: cancel } }),
        mode === 'edit' ? el('button', { attrs: { type: 'button' }, text: 'Copy unit', on: { click: copyEditedUnit } }) : null,
        mode === 'edit' ? el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete unit', on: { click: askDelete } }) : null));

    form = { mode, symbolId, element, fields, errors, preview, status, pickButton, weapons, linkNote, previewTimer: null, touched: new Set() };
    fillForm(symbol ?? { sidc: DEFAULT_SIDC, label: '', position: null, modifiers: {} }, { onlyUntouched: false });

    // Which fields the user has changed (the builder edits the SIDC; Pick on map edits the position).
    const BUILDER = ['affiliation', 'unitType', 'echelon', 'hq'];
    const touch = (event) => {
      const name = event.target.name;
      if (!name || name.startsWith('unit-weapons')) return; // the weapons list says when it changes
      form.touched.add(BUILDER.includes(name) ? 'sidc' : name.startsWith('details-') ? 'details' : name);
    };
    element.addEventListener('input', touch);
    element.addEventListener('change', touch);

    // Builder ⇄ SIDC.
    for (const name of ['affiliation', 'unitType', 'echelon', 'hq']) fields[name].addEventListener('change', onBuilderChange);
    fields.sidc.addEventListener('input', () => { syncBuilderFromSidc(); schedulePreview(); });
    fields.label.addEventListener('input', schedulePreview);
    fields.direction.addEventListener('input', schedulePreview);

    formSlot.replaceChildren(element);
    renderList();
    schedulePreview(0);
  }

  /** Put a unit's values into the form; with onlyUntouched, leave fields the user has changed alone. */
  /** For a unit placed from a threat play (D30): what its link means, and Snap back when it was moved. */
  function renderLinkNote(symbol) {
    if (!form?.linkNote) return;
    const link = form.mode === 'edit' ? symbol.link : null;
    form.linkNote.replaceChildren(...(!link ? [] : link.moved ? [
      el('p', { class: 'hint', text: 'Moved off the template (fitted to the ground): updates from the template keep it here.' }),
      el('div', { class: 'actions' }, el('button', { attrs: { type: 'button' }, text: 'Snap back to template', on: { click: () => snapBack(symbol.id) } })),
    ] : [el('p', { class: 'hint', text: 'Placed from the template: it follows the play when you update. Editing anything but its position makes it your own unit.' })]));
  }
  async function snapBack(symbolId) {
    const result = await client.send('symbol.snap-to-template', { coaId: coa.id, expectedRevision: coa.revision, symbolId });
    if (!destroyed && !result.ok) showAlert(describeError(result.error));
  }

  function fillForm(symbol, { onlyUntouched }) {
    if (!form || !symbol) return;
    renderLinkNote(symbol);
    const f = form.fields;
    const values = {
      sidc: symbol.sidc,
      label: symbol.label,
      lat: symbol.position ? String(symbol.position.lat) : '',
      lng: symbol.position ? String(symbol.position.lng) : '',
      direction: symbol.modifiers.direction === undefined ? '' : String(symbol.modifiers.direction),
      ...Object.fromEntries(TEXT_MODIFIERS.map(([name]) => [name, symbol.modifiers[name] ?? ''])),
      facing: symbol.facing === undefined ? '' : String(symbol.facing),
    };
    if (!(onlyUntouched && form.touched.has('hvt'))) f.hvt.checked = symbol.hvt === true;
    if (!(onlyUntouched && form.touched.has('weapons'))) form.weapons.set(symbol.weapons ?? []);
    if (!(onlyUntouched && form.touched.has('details'))) {
      for (const key of ['strength', 'reference', 'notes']) f[`details-${key}`].value = symbol.details?.[key] ?? '';
      form.equipment = symbol.details?.equipment; // kept as it is (edited through import for now)
    }
    let sidcChanged = false;
    for (const [name, value] of Object.entries(values)) {
      if (onlyUntouched && form.touched.has(name)) continue;
      if (name === 'sidc' && f.sidc.value !== value) sidcChanged = true;
      f[name].value = value;
    }
    if (!onlyUntouched || sidcChanged) { syncBuilderFromSidc(); if (onlyUntouched) schedulePreview(0); }
  }

  function closeForm() {
    if (!form) return;
    clearTimeout(form.previewTimer);
    picker.cancel();
    form = null;
    formSlot.replaceChildren();
  }

  function syncBuilderFromSidc() {
    const parts = readSidc(form.fields.sidc.value);
    form.fields.unitType.value = parts ? parts.unitType : '';
    if (parts) {
      form.fields.affiliation.value = parts.affiliation;
      form.fields.echelon.value = parts.echelon;
      form.fields.hq.checked = parts.hq;
    }
  }

  function onBuilderChange() {
    const f = form.fields;
    if (f.unitType.value === '') return; // custom SIDC: the builder cannot express it
    f.sidc.value = composeSidc({ affiliation: f.affiliation.value, unitType: f.unitType.value, echelon: f.echelon.value, hq: f.hq.checked });
    schedulePreview();
  }

  function schedulePreview(delay = PREVIEW_DELAY_MS) {
    clearTimeout(form.previewTimer);
    const current = form;
    current.previewTimer = setTimeout(async () => {
      const label = current.fields.label.value.trim();
      const direction = toNumber(current.fields.direction.value);
      const payload = { sidc: current.fields.sidc.value, size: PREVIEW_SIZE };
      if (label.length <= 30) payload.label = label;
      if (direction !== null && direction >= 0 && direction < 360) payload.modifiers = { direction };
      const result = await client.ask('symbol.preview', payload);
      if (form !== current || destroyed || !result.ok) return;
      current.preview.innerHTML = result.value.svg; // renderer SVG only
      current.status.textContent = result.value.valid ? 'Valid symbol' : `Not a recognised symbol: ${result.value.warnings.join('; ')}`;
      current.status.classList.toggle('is-invalid', !result.value.valid);
    }, delay);
  }

  function pickOnMap() {
    const current = form;
    current.pickButton.textContent = 'Click the map…';
    picker.request(({ lat, lng }) => {
      if (form !== current) return;
      current.fields.lat.value = lat.toFixed(6);
      current.fields.lng.value = lng.toFixed(6);
      current.touched.add('lat').add('lng');
    });
  }

  // Restore the button text whenever picking ends (picked, cancelled or Escape).
  const offPicker = picker.subscribe((active) => { if (!active && form) form.pickButton.textContent = 'Pick on map'; });

  function clearErrors() {
    for (const [name, slot] of Object.entries(form.errors)) {
      slot.textContent = '';
      form.fields[name].removeAttribute('aria-invalid');
    }
    showAlert('');
  }

  function showErrors(error) {
    if (error.code === 'INVALID_SIDC') {
      form.errors.sidc.textContent = `${error.message}${error.details.warnings?.length ? ` (${error.details.warnings.join('; ')})` : ''}`;
      form.fields.sidc.setAttribute('aria-invalid', 'true');
      return;
    }
    if (error.code !== 'VALIDATION_FAILED') { showAlert(describeError(error)); return; }
    const unplaced = [];
    for (const problem of error.details.problems) {
      const name = formFieldFor(problem.field);
      if (form.errors[name]) {
        form.errors[name].textContent = problem.reason.replace(/^./, (c) => c.toUpperCase());
        form.fields[name].setAttribute('aria-invalid', 'true');
      } else {
        unplaced.push(`${problem.field}: ${problem.reason}`);
      }
    }
    if (unplaced.length) showAlert(unplaced.join('. '));
  }

  function readForm() {
    const f = form.fields;
    const modifiers = Object.fromEntries(TEXT_MODIFIERS.map(([name]) => [name, f[name].value]));
    if (f.direction.value.trim() !== '') modifiers.direction = toNumber(f.direction.value);
    const details = Object.fromEntries(['strength', 'reference', 'notes'].map((k) => [k, f[`details-${k}`].value]).filter(([, v]) => v.trim() !== ''));
    if (form.equipment) details.equipment = form.equipment;
    return {
      sidc: f.sidc.value, label: f.label.value, position: { lat: toNumber(f.lat.value), lng: toNumber(f.lng.value) }, modifiers,
      hvt: f.hvt.checked, facing: f.facing.value.trim() === '' ? null : toNumber(f.facing.value), weapons: form.weapons.value(), details,
    };
  }

  async function onSave(event) {
    event.preventDefault();
    const current = form;
    clearErrors();
    const values = readForm();
    const coaId = coa.id;
    if (current.mode === 'add') {
      const result = await client.send('symbol.add', { coaId, ...values });
      if (form !== current) return;
      if (!result.ok) { showErrors(result.error); return; }
      closeForm();
      symbolSelection.set(result.value.symbol.id);
      return;
    }
    // Edit: send only what the user changed, so changes made meanwhile elsewhere (a drag on the
    // map, another tab) are not undone. Move first, so an invalid position saves nothing.
    const touched = current.touched;
    if (touched.has('lat') || touched.has('lng')) {
      const moved = await client.send('symbol.move', { coaId, symbolId: current.symbolId, position: values.position });
      if (form !== current) return;
      if (!moved.ok) { showErrors(moved.error); return; }
    }
    const changes = {};
    if (touched.has('sidc')) changes.sidc = values.sidc;
    if (touched.has('label')) changes.label = values.label;
    if (['direction', ...TEXT_MODIFIERS.map(([name]) => name)].some((name) => touched.has(name))) changes.modifiers = values.modifiers;
    for (const extra of ['hvt', 'facing', 'weapons', 'details']) if (touched.has(extra)) changes[extra] = values[extra];
    if (Object.keys(changes).length > 0) {
      const updated = await client.send('symbol.update', { coaId, symbolId: current.symbolId, ...changes });
      if (form !== current) return;
      if (!updated.ok) { showErrors(updated.error); return; }
    }
    current.touched.clear(); // saved: from now on the form follows the stored unit again
    showAlert('');
  }

  function cancel() {
    const wasEditing = form?.mode === 'edit';
    closeForm();
    if (wasEditing) symbolSelection.set(null);
    renderList();
  }

  async function copyEditedUnit() {
    const result = await client.send('symbol.copy', { coaId: coa.id, fromCoaId: coa.id, symbolIds: [form.symbolId], offset: SAME_COA_OFFSET });
    if (!result.ok) { showAlert(describeError(result.error)); return; }
    symbolSelection.set(result.value.symbols[0].id); // open the copy, ready to move or edit
  }

  function askDelete() {
    pendingDelete = { symbolIds: [form.symbolId] };
    const symbol = coa.symbols.find((s) => s.id === form.symbolId);
    confirmText.textContent = `Delete “${symbol.label || symbol.sidc}”? This cannot be undone.`;
    dialog.showModal();
  }

  async function onConfirmDelete() {
    dialog.close();
    const target = pendingDelete;
    pendingDelete = null;
    if (!target || coa === null) return;
    const result = target.symbolIds.length === 1
      ? await client.send('symbol.remove', { coaId: coa.id, symbolId: target.symbolIds[0] })
      : await client.send('symbol.remove-many', { coaId: coa.id, symbolIds: target.symbolIds });
    if (!result.ok) { showAlert(describeError(result.error)); return; }
    target.symbolIds.forEach((id) => checked.delete(id));
    // The symbol.removed events reload the list, which clears the selection and closes the form.
  }

  // ---- wiring ----
  const onSymbolSelected = (id) => {
    if (id === null) { if (form?.mode === 'edit') closeForm(); renderList(); return; }
    if (form?.symbolId !== id) openForm({ mode: 'edit', symbolId: id });
  };
  const unsubscribes = [
    store.subscribe(apply),
    selection.subscribe(() => { closeForm(); checked.clear(); bulkStatus.textContent = ''; symbolSelection.set(null); }),
    symbolSelection.subscribe(onSymbolSelected),
    offPicker,
    client.subscribe('unit-template.*', () => { loadTemplates(); }),
  ];

  return {
    ready: Promise.all([store.ready, loadTemplates()]).then(() => apply(store.get())),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      ownStore?.destroy();
      closeForm();
      if (dialog.open) dialog.close();
    },
  };
}
