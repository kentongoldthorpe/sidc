// Symbol editor view (driving adapter): lists the selected COA's units and adds, edits and deletes
// them. The SIDC can be built from presets (affiliation, unit type, echelon, HQ) or typed, with a
// live preview. "Pick on map" fills the position from the next map click.
import { el, describeError } from './dom.js';
import { AFFILIATIONS, UNIT_TYPES, ECHELONS, composeSidc, readSidc } from '../sidc-builder.js';
import { coalesce } from './coalesce.js';

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
  return problemField;
}

/**
 * @param {{ client: object, root: HTMLElement, selection: object, symbolSelection: object, picker: object }} options
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountSymbolEditorView({ client, root, selection, symbolSelection, picker }) {
  let destroyed = false;
  let coa = null;
  let loadSeq = 0;
  let form = null; // { mode: 'add' | 'edit', symbolId?, element, fields, errors, preview, status }
  const thumbs = new Map();
  const checked = new Set(); // units ticked for group copy / delete
  let pendingDelete = null; // { symbolIds: string[] } awaiting confirmation

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
  const bulkStatus = el('p', { class: 'bulk-status', dataset: { bulkStatus: '' }, attrs: { role: 'status' } });
  const confirmText = el('p');
  const dialog = el('dialog', { class: 'confirm', attrs: { 'aria-label': 'Confirm delete' } },
    confirmText,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onConfirmDelete } })));
  root.replaceChildren(el('div', { class: 'symbol-editor', dataset: { symbolEditor: '' } }, alert, heading, addButton, list, bulk, bulkStatus, formSlot, dialog));
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
          class: 'unit-select', dataset: { selectUnit: '' },
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

  async function load(coaId) {
    const seq = ++loadSeq;
    if (coaId === null) { coa = null; closeForm(); renderList(); return; }
    const result = await client.ask('coa.get', { coaId });
    if (destroyed || seq !== loadSeq) return;
    if (!result.ok) { coa = null; closeForm(); renderList(); if (result.error.code !== 'NOT_FOUND') showAlert(describeError(result.error)); return; }
    coa = result.value;
    renderList();
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

    const element = el('form', { class: 'unit-form', dataset: { unitForm: '' }, attrs: { novalidate: true }, on: { submit: onSave } },
      el('h3', { class: 'panel-subtitle', text: mode === 'add' ? 'New unit' : 'Edit unit' }),
      el('fieldset', { class: 'builder' }, el('legend', { text: 'Symbol' }),
        affiliation.row, unitType.row, echelon.row,
        el('label', { class: 'check' }, hq, el('span', { text: 'Headquarters' })),
        ...sidcRows, el('div', { class: 'preview-row' }, preview, status)),
      ...labelRows,
      el('div', { class: 'position' }, el('div', {}, ...latRows), el('div', {}, ...lngRows)),
      pickButton,
      el('details', { class: 'more' }, el('summary', { text: 'More fields' }), ...modifierRows, ...directionRows),
      el('div', { class: 'actions' },
        el('button', { attrs: { type: 'submit' }, text: 'Save' }),
        el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: cancel } }),
        mode === 'edit' ? el('button', { attrs: { type: 'button' }, text: 'Copy unit', on: { click: copyEditedUnit } }) : null,
        mode === 'edit' ? el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete unit', on: { click: askDelete } }) : null));

    form = { mode, symbolId, element, fields, errors, preview, status, pickButton, previewTimer: null, touched: new Set() };
    fillForm(symbol ?? { sidc: DEFAULT_SIDC, label: '', position: null, modifiers: {} }, { onlyUntouched: false });

    // Which fields the user has changed (the builder edits the SIDC; Pick on map edits the position).
    const BUILDER = ['affiliation', 'unitType', 'echelon', 'hq'];
    const touch = (event) => { const name = event.target.name; if (name) form.touched.add(BUILDER.includes(name) ? 'sidc' : name); };
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
  function fillForm(symbol, { onlyUntouched }) {
    if (!form || !symbol) return;
    const f = form.fields;
    const values = {
      sidc: symbol.sidc,
      label: symbol.label,
      lat: symbol.position ? String(symbol.position.lat) : '',
      lng: symbol.position ? String(symbol.position.lng) : '',
      direction: symbol.modifiers.direction === undefined ? '' : String(symbol.modifiers.direction),
      ...Object.fromEntries(TEXT_MODIFIERS.map(([name]) => [name, symbol.modifiers[name] ?? ''])),
    };
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
    return { sidc: f.sidc.value, label: f.label.value, position: { lat: toNumber(f.lat.value), lng: toNumber(f.lng.value) }, modifiers };
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
  const reload = coalesce(() => { if (!destroyed && coa !== null) load(coa.id); });
  const onEvent = (event) => {
    const id = event.payload.coaId ?? event.payload.coa?.id;
    if (coa !== null && id === coa.id) reload();
  };
  const unsubscribes = [
    client.subscribe('symbol.*', onEvent),
    client.subscribe('coa.*', onEvent),
    selection.subscribe((id) => { closeForm(); checked.clear(); bulkStatus.textContent = ''; symbolSelection.set(null); load(id); }),
    symbolSelection.subscribe(onSymbolSelected),
    offPicker,
  ];

  return {
    ready: load(selection.get()),
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      closeForm();
      if (dialog.open) dialog.close();
    },
  };
}
