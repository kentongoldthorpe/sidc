// Unit templates panel (driving adapter, M10-3b, D29): ready-made units, like ArcGIS feature
// templates. Each holds a symbol, label, facing, HVT tag, weapons and details; adding a unit from one
// copies them. Templates can be imported and exported as a file (docs/UNIT-TEMPLATES.md). The old
// systems list can be turned into templates in one step.
import { el, describeError } from './dom.js';
import { AFFILIATIONS, UNIT_TYPES, ECHELONS, composeSidc, readSidc } from '../sidc-builder.js';
import { mountWeaponsEditor, describeWeapon } from './weapons-editor.js';

const DEFAULT_SIDC = '10061000001211000000'; // hostile infantry: most templates describe the threat
const toNumber = (text) => { const t = text.trim().replace(',', '.'); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : text; };

/** "MRC · 2 weapons · HVT" */
export const describeTemplate = (t) => [t.label, t.weapons?.length ? `${t.weapons.length} weapon${t.weapons.length === 1 ? '' : 's'}` : '', t.hvt ? 'HVT' : '', t.details?.strength ?? ''].filter(Boolean).join(' · ') || 'No weapons';

/**
 * @param {{ client: object, root: HTMLElement, saveFile: (blob: Blob, name: string) => Promise<void>|void, summary?: HTMLElement|null }} options
 * @returns {{ ready: Promise<void>, refresh(): Promise<void>, destroy(): void }}
 */
export function mountUnitTemplatesView({ client, root, saveFile, summary = null }) {
  let destroyed = false;
  let templates = [];
  let systemsToConvert = 0;
  let editing = null; // { templateId | null }
  let loadSeq = 0;

  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const empty = el('p', { class: 'placeholder', text: 'No unit templates yet. A template is a ready-made unit (symbol, weapons, details) to start units from.' });
  const list = el('ul', { class: 'system-items', attrs: { 'aria-label': 'Unit templates' } });
  const editor = el('div', { class: 'system-editor' });
  const fileInput = el('input', { attrs: { type: 'file', hidden: true, accept: '.json,application/json', 'aria-label': 'Import unit templates from a file', tabindex: '-1' }, on: { change: onImportFile } });
  const convertText = el('span', {});
  const convertButton = el('button', { class: 'link', attrs: { type: 'button' }, text: 'Make templates from them', on: { click: onConvert } });
  const convert = el('p', { class: 'hint', dataset: { fromSystems: '' } }, convertText, ' ', convertButton);
  const confirmText = el('p', {});
  let pendingDelete = null;
  const dialog = el('dialog', { class: 'confirm', attrs: { 'aria-label': 'Confirm delete' } }, confirmText,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onConfirmDelete } })));
  root.replaceChildren(el('div', { class: 'stack' },
    alert,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'New template', on: { click: () => openEditor(null) } }),
      el('button', { class: 'link', attrs: { type: 'button' }, text: 'Import templates…', on: { click: () => fileInput.click() } }),
      el('button', { class: 'link', attrs: { type: 'button' }, text: 'Export templates', on: { click: onExport } }),
      fileInput),
    convert, empty, list, editor, status, dialog));

  const say = (text) => { status.textContent = text; alert.textContent = ''; };
  const fail = (text) => { alert.textContent = text; status.textContent = ''; };

  function renderList() {
    empty.hidden = templates.length > 0;
    convert.hidden = systemsToConvert === 0;
    convertText.textContent = `${systemsToConvert} system${systemsToConvert === 1 ? '' : 's'} from the old systems list ${systemsToConvert === 1 ? 'is' : 'are'} not a template yet.`;
    convertButton.textContent = systemsToConvert === 1 ? 'Make a template from it' : 'Make templates from them';
    if (summary) summary.textContent = templates.length ? String(templates.length) : '';
    list.replaceChildren(...templates.map((t) => el('li', { dataset: { templateId: t.id } },
      el('button', { class: 'list-row system-select', attrs: { type: 'button', 'aria-current': editing?.templateId === t.id ? 'true' : null }, on: { click: () => openEditor(t.id) } },
        el('span', { class: 'system-name', text: t.name }),
        el('span', { class: 'system-meta', text: describeTemplate(t) })))));
  }

  async function load() {
    const seq = ++loadSeq;
    const [listed, systems] = await Promise.all([client.ask('unit-template.list'), client.ask('system.list')]);
    if (destroyed || seq !== loadSeq) return;
    if (!listed.ok) { fail(describeError(listed.error)); return; }
    templates = listed.value;
    const names = new Set(templates.map((t) => t.name));
    systemsToConvert = systems.ok ? systems.value.filter((s) => !names.has(s.name)).length : 0;
    renderList();
    if (editing?.templateId && !templates.some((t) => t.id === editing.templateId)) closeEditor();
  }

  function openEditor(templateId) {
    const t = templateId ? templates.find((x) => x.id === templateId) : null;
    if (templateId && !t) return;
    const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
    const select = (name, options) => el('select', { attrs: { name } }, ...options.map(([v, text]) => el('option', { attrs: { value: v }, text })));
    const name = el('input', { attrs: { name: 'template-name', autocomplete: 'off', maxlength: 60, placeholder: 'e.g. BMP-2 Coy' } });
    const affiliation = select('template-affiliation', AFFILIATIONS);
    const unitType = select('template-unit-type', [['', 'Custom (typed SIDC)'], ...UNIT_TYPES]);
    const echelon = select('template-echelon', ECHELONS);
    const sidc = el('input', { attrs: { name: 'template-sidc', autocomplete: 'off', spellcheck: 'false' } });
    const label = el('input', { attrs: { name: 'template-label', autocomplete: 'off', maxlength: 30 } });
    const facing = el('input', { attrs: { name: 'template-facing', inputmode: 'decimal', autocomplete: 'off', placeholder: 'none' } });
    const hvt = el('input', { attrs: { type: 'checkbox', name: 'template-hvt' } });
    const weapons = mountWeaponsEditor({ templates: templates.filter((x) => x.id !== templateId), name: 'template-weapons' });
    const details = Object.fromEntries(['strength', 'reference', 'notes'].map((k) => [k, el('input', { attrs: { name: `template-${k}`, autocomplete: 'off' } })]));
    const errors = el('ul', { class: 'import-problems' });

    const showSidc = (value) => {
      sidc.value = value;
      const parts = readSidc(value);
      affiliation.value = parts?.affiliation ?? '6';
      unitType.value = parts?.unitType ?? '';
      echelon.value = parts?.echelon ?? '00';
    };
    [affiliation, unitType, echelon].forEach((c) => c.addEventListener('change', () => {
      if (unitType.value) sidc.value = composeSidc({ affiliation: affiliation.value, unitType: unitType.value, echelon: echelon.value, hq: false });
    }));
    name.value = t?.name ?? '';
    showSidc(t?.sidc ?? DEFAULT_SIDC);
    label.value = t?.label ?? '';
    facing.value = t?.facing === undefined ? '' : String(t.facing);
    hvt.checked = t?.hvt === true;
    weapons.set(t?.weapons ?? []);
    for (const k of Object.keys(details)) details[k].value = t?.details?.[k] ?? '';

    async function onSave() {
      const d = Object.fromEntries(Object.entries(details).map(([k, c]) => [k, c.value]).filter(([, v]) => v.trim() !== ''));
      if (t?.details?.equipment) d.equipment = t.details.equipment; // kept as it is (set through import)
      const fields = { name: name.value, sidc: sidc.value, label: label.value, facing: toNumber(facing.value), hvt: hvt.checked, weapons: weapons.value(), details: d };
      const latest = t ? await client.ask('unit-template.list') : null;
      const revision = latest?.ok ? latest.value.find((x) => x.id === t.id)?.revision ?? t.revision : t?.revision;
      const result = t
        ? await client.send('unit-template.update', { templateId: t.id, expectedRevision: revision, ...fields })
        : await client.send('unit-template.create', Object.fromEntries(Object.entries(fields).filter(([k, v]) => !(k === 'facing' && v === null))));
      if (destroyed) return;
      if (!result.ok) {
        const problems = result.error.details?.problems ?? [];
        errors.replaceChildren(...(problems.length ? problems : [{ field: '', reason: describeError(result.error) }]).map((p) => el('li', { text: p.field ? `${p.field}: ${p.reason}` : p.reason })));
        return;
      }
      say(`Saved ${result.value.name}.`);
      closeEditor();
    }

    editing = { templateId };
    editor.replaceChildren(el('fieldset', { class: 'group', dataset: { templateEditor: '' } }, el('legend', { text: t ? `Edit ${t.name}` : 'New unit template' }),
      field('Name', name),
      el('div', { class: 'position' }, field('Affiliation', affiliation), field('Echelon', echelon)),
      field('Unit type', unitType), field('SIDC', sidc), field('Label', label),
      field('Facing (degrees; weapons with an arc point this way)', facing),
      el('label', { class: 'check' }, hvt, el('span', { text: 'High-value target (HVT)' })),
      weapons.element,
      el('details', { class: 'more' }, el('summary', { text: 'Details (strength, source, notes)' }),
        field('Strength', details.strength), field('Source / reference', details.reference), field('Notes', details.notes)),
      errors,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: closeEditor } }),
        t ? el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete template', on: { click: () => askDelete(t) } }) : null)));
    renderList();
  }

  function closeEditor() { editing = null; editor.replaceChildren(); renderList(); }

  function askDelete(t) {
    pendingDelete = t;
    confirmText.textContent = `Delete the template ${t.name}? Units already made from it keep their values.`;
    dialog.showModal();
  }
  async function onConfirmDelete() {
    dialog.close();
    const t = pendingDelete;
    pendingDelete = null;
    if (!t) return;
    const latest = (await client.ask('unit-template.list')).value?.find((x) => x.id === t.id);
    const result = await client.send('unit-template.delete', { templateId: t.id, expectedRevision: latest?.revision ?? t.revision });
    if (destroyed) return;
    if (result.ok) { say(`Deleted ${t.name}.`); closeEditor(); } else fail(describeError(result.error));
  }

  async function onConvert() {
    const result = await client.send('unit-template.from-systems', {});
    if (destroyed) return;
    if (result.ok) say(`Made ${result.value.templates.length} template${result.value.templates.length === 1 ? '' : 's'} from the systems list. Set each one's symbol.`);
    else fail(describeError(result.error));
  }

  async function onExport() {
    const result = await client.ask('unit-template.export');
    if (destroyed) return;
    if (!result.ok) { fail(describeError(result.error)); return; }
    await saveFile(new Blob([`${JSON.stringify(result.value, null, 2)}\n`], { type: 'application/json' }), 'unit-templates.json');
    say(`Exported ${result.value.templates.length} unit templates.`);
  }

  async function onImportFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let doc;
    try { doc = JSON.parse(await file.text()); } catch { fail(`${file.name} is not a unit template file (it is not JSON).`); return; }
    const result = await client.send('unit-template.import', { document: doc });
    if (destroyed) return;
    if (!result.ok) {
      const problems = result.error.details?.problems ?? [];
      fail(`${file.name}: ${describeError(result.error)}${problems.length ? ` (${problems.slice(0, 5).map((p) => `${p.field} ${p.reason}`).join('; ')})` : ''}`);
      return;
    }
    say(`Imported ${result.value.templates.length} unit templates from ${file.name}.`);
  }

  const offs = [client.subscribe('unit-template.*', () => { load(); }), client.subscribe('system.*', () => { load(); })];
  return {
    ready: load(),
    refresh: load,
    destroy() { destroyed = true; offs.forEach((off) => off()); if (dialog.open) dialog.close(); },
  };
}

export { describeWeapon };
