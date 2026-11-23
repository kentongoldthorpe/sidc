// Threat models panel (driving adapter, Epic 3): create, select, rename, describe and delete threat
// models. The selected model's template is edited on the canvas and in the Template section.
import { el, describeError } from './dom.js';
import { coalesce } from './coalesce.js';

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** @param {{ client: object, root: HTMLElement, modelSelection: object, store: object }} options */
export function mountThreatModelsView({ client, root, modelSelection, store }) {
  let destroyed = false;
  let models = [];
  let loadSeq = 0;
  let details = null; // { modelId, touched, title, description }

  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const nameInput = el('input', { attrs: { name: 'model-name', autocomplete: 'off', placeholder: 'New threat model, e.g. MRB in the attack', 'aria-label': 'New threat model name' } });
  const nameError = el('p', { class: 'field-error' });
  const form = el('form', { class: 'new-coa', dataset: { newModel: '' }, attrs: { novalidate: true }, on: { submit: onCreate } },
    el('div', { class: 'row' }, nameInput, el('button', { class: 'primary', attrs: { type: 'submit' }, text: 'Create' })), nameError);
  const empty = el('p', { class: 'placeholder', text: 'No threat models yet. A threat model is how a threat fights, drawn to scale without terrain.' });
  const list = el('ul', { class: 'graphic-items model-items', attrs: { 'aria-label': 'Threat models' } });
  const detailBox = el('div', { class: 'model-details' });
  const confirmText = el('p', {});
  const dialog = el('dialog', { class: 'confirm', attrs: { 'aria-label': 'Confirm delete' } }, confirmText,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onConfirmDelete } })));
  root.replaceChildren(el('div', { class: 'stack' }, alert, form, empty, list, detailBox, dialog));

  function renderList() {
    empty.hidden = models.length > 0;
    const selectedId = modelSelection.get();
    list.replaceChildren(...models.map((m) => el('li', { dataset: { modelId: m.id } },
      el('button', { class: 'list-row system-select', attrs: { type: 'button', 'aria-current': m.id === selectedId ? 'true' : null }, on: { click: () => modelSelection.set(m.id) } },
        el('span', { class: 'system-name model-name', text: m.name }),
        el('span', { class: 'system-meta', text: `${count(m.unitCount, 'unit')} · ${count(m.coaCount, 'COA')}` })))));
  }

  function renderDetails(model) {
    if (!model) { details = null; detailBox.replaceChildren(); return; }
    if (details?.modelId === model.id) { details.sync(model); return; }
    const touched = new Set();
    const title = el('input', { attrs: { name: 'model-title', autocomplete: 'off', maxlength: 120 }, on: { input: () => touched.add('name') } });
    const description = el('textarea', { attrs: { name: 'model-description', rows: 4, placeholder: 'Doctrine source, how it fights, its preferred tactics…' }, on: { input: () => touched.add('description') } });
    const error = el('p', { class: 'field-error' });
    const sync = (m) => {
      if (!touched.has('name')) title.value = m.name;
      if (!touched.has('description')) description.value = m.description;
    };
    async function onSave() {
      const m = store.get();
      if (!m) return;
      const changes = {};
      if (touched.has('name')) changes.name = title.value;
      if (touched.has('description')) changes.description = description.value;
      if (Object.keys(changes).length === 0) return;
      const result = await client.send('threat-model.update', { modelId: m.id, expectedRevision: m.revision, ...changes });
      if (destroyed) return;
      if (result.ok) { touched.clear(); error.textContent = ''; } else error.textContent = describeError(result.error);
    }
    details = { modelId: model.id, sync };
    sync(model);
    detailBox.replaceChildren(el('fieldset', { class: 'group' }, el('legend', { text: 'Selected model' }),
      el('label', { class: 'field' }, el('span', { text: 'Name' }), title),
      el('label', { class: 'field' }, el('span', { text: 'Description and tactics' }), description),
      error,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete model', on: { click: askDelete } }))));
  }

  async function onCreate(event) {
    event.preventDefault();
    const result = await client.send('threat-model.create', { name: nameInput.value });
    if (destroyed) return;
    if (!result.ok) { nameError.textContent = describeError(result.error); return; }
    nameInput.value = '';
    nameError.textContent = '';
    modelSelection.set(result.value.id);
    await load();
  }

  function askDelete() {
    const m = store.get();
    if (!m) return;
    confirmText.textContent = `Delete “${m.name}” and its COAs? This cannot be undone.`;
    dialog.showModal();
  }
  async function onConfirmDelete() {
    dialog.close();
    const selected = store.get();
    if (!selected) return;
    // The user confirmed deleting this model: use its latest revision (a save may have just landed).
    const latest = await client.ask('threat-model.get', { modelId: selected.id });
    const m = latest.ok ? latest.value : selected;
    const result = await client.send('threat-model.delete', { modelId: m.id, expectedRevision: m.revision });
    if (destroyed) return;
    if (!result.ok) { alert.textContent = describeError(result.error); return; }
    modelSelection.set(null);
    await load();
  }

  async function load() {
    const seq = ++loadSeq;
    const result = await client.ask('threat-model.list', {});
    if (destroyed || seq !== loadSeq) return;
    if (!result.ok) { alert.textContent = describeError(result.error); return; }
    models = result.value;
    if (modelSelection.get() !== null && !models.some((m) => m.id === modelSelection.get())) modelSelection.set(null);
    renderList();
  }

  const reload = coalesce(() => { if (!destroyed) load(); });
  const offs = [
    client.subscribe('threat-model.*', reload),
    modelSelection.subscribe(renderList),
    store.subscribe((model) => renderDetails(model)),
  ];

  return {
    ready: Promise.all([load(), store.ready]).then(() => renderDetails(store.get())),
    refresh: () => load(),
    destroy() { destroyed = true; offs.forEach((off) => off()); if (dialog.open) dialog.close(); },
  };
}
