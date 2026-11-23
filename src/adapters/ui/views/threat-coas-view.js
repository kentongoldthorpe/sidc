// Threat COAs panel (driving adapter, Epic 3 T-3, IPB step 4): the selected threat model's COAs —
// add, rank (most likely / most dangerous / other), the COA statement (who, what, when, where, why,
// how) and end state — and which play the canvas shows: the formation or one COA's play.
import { el, describeError } from './dom.js';
import { COA_RANKS, STATEMENT_PARTS } from '../../../domain/threat-model.js';

export const RANK_NAMES = Object.freeze({ mostLikely: 'Most likely', mostDangerous: 'Most dangerous', other: 'Other' });
const RANK_BADGES = Object.freeze({ mostLikely: 'MLCOA', mostDangerous: 'MDCOA', other: '' });
const PART_HINTS = Object.freeze({
  who: 'Who: the threat force', what: 'What: the type of operation', when: 'When: time or event',
  where: 'Where: the area or objective', why: 'Why: the purpose', how: 'How: the scheme of manoeuvre',
});

/** @param {{ client: object, root: HTMLElement, store: object }} options */
export function mountThreatCoasView({ client, root, store }) {
  let destroyed = false;
  let editing = null; // { coaId, touched, sync(coa) }
  const playSelection = store.playSelection;

  const empty = el('p', { class: 'placeholder', text: 'Select a threat model to write its COAs.' });
  const list = el('ul', { class: 'graphic-items', attrs: { 'aria-label': 'Plays: formation and threat COAs' } });
  const nameInput = el('input', { attrs: { name: 'coa-name', autocomplete: 'off', placeholder: 'e.g. COA 1 Envelopment', 'aria-label': 'New threat COA name' } });
  const rankSelect = el('select', { attrs: { name: 'coa-rank', 'aria-label': 'Rank' } }, ...COA_RANKS.map((r) => el('option', { attrs: { value: r }, text: RANK_NAMES[r] })));
  rankSelect.value = 'other';
  const addError = el('p', { class: 'field-error' });
  const form = el('form', { class: 'stack', dataset: { newThreatCoa: '' }, attrs: { novalidate: true }, on: { submit: onAdd } },
    el('div', { class: 'row new-coa-row' }, nameInput, rankSelect, el('button', { class: 'primary', attrs: { type: 'submit' }, text: 'Add COA' })),
    el('p', { class: 'hint', text: 'A new COA starts as a copy of the formation; draw its play on the canvas.' }),
    addError);
  const editor = el('div', { class: 'system-editor' });
  const confirmText = el('p', {});
  const dialog = el('dialog', { class: 'confirm', attrs: { 'aria-label': 'Confirm delete' } }, confirmText,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onConfirmDelete } })));
  const content = el('div', { class: 'stack' }, list, form, editor);
  root.replaceChildren(el('div', { class: 'stack' }, empty, content, dialog));

  const row = (id, name, meta, badge) => el('li', { dataset: { playId: id } },
    el('button', { class: 'list-row system-select', attrs: { type: 'button', 'aria-current': playSelection.get() === id ? 'true' : null }, on: { click: () => playSelection.set(id) } },
      el('span', { class: 'system-name play-name' }, name, badge ? el('span', { class: `rank-badge rank-${badge.toLowerCase()}`, text: badge }) : null),
      el('span', { class: 'system-meta', text: meta })));

  function render(model) {
    empty.hidden = model !== null;
    content.hidden = model === null;
    if (!model) { list.replaceChildren(); closeEditor(); return; }
    list.replaceChildren(
      row('formation', 'Formation', 'The doctrinal template', ''),
      ...model.coas.map((c) => row(c.id, c.name, RANK_NAMES[c.rank], RANK_BADGES[c.rank])));
    const coa = model.coas.find((c) => c.id === playSelection.get());
    if (!coa) closeEditor();
    else if (editing?.coaId === coa.id) editing.sync(coa);
    else openEditor(coa);
  }

  function openEditor(coa) {
    const touched = new Set();
    const track = (key, control) => { ['input', 'change'].forEach((t) => control.addEventListener(t, () => touched.add(key))); return control; };
    const name = track('name', el('input', { attrs: { name: 'coa-title', autocomplete: 'off', maxlength: 120 } }));
    const rank = track('rank', el('select', { attrs: { name: 'coa-title-rank' } }, ...COA_RANKS.map((r) => el('option', { attrs: { value: r }, text: RANK_NAMES[r] }))));
    const parts = Object.fromEntries(STATEMENT_PARTS.map((p) => [p, track(`statement.${p}`, el('textarea', { attrs: { name: `statement-${p}`, rows: 2, placeholder: PART_HINTS[p] } }))]));
    const endState = track('endState', el('textarea', { attrs: { name: 'coa-end-state', rows: 2, placeholder: 'What the threat has achieved when the COA succeeds' } }));
    const error = el('p', { class: 'field-error' });
    const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);

    function sync(c) {
      if (!touched.has('name')) name.value = c.name;
      if (!touched.has('rank')) rank.value = c.rank;
      for (const p of STATEMENT_PARTS) if (!touched.has(`statement.${p}`)) parts[p].value = c.statement[p];
      if (!touched.has('endState')) endState.value = c.endState;
    }

    async function onSave() {
      const model = store.get();
      if (!model) return;
      const changes = {};
      if (touched.has('name')) changes.name = name.value;
      if (touched.has('rank')) changes.rank = rank.value;
      const statement = Object.fromEntries(STATEMENT_PARTS.filter((p) => touched.has(`statement.${p}`)).map((p) => [p, parts[p].value]));
      if (Object.keys(statement).length) changes.statement = statement;
      if (touched.has('endState')) changes.endState = endState.value;
      if (Object.keys(changes).length === 0) return;
      const result = await client.send('threat-coa.update', { modelId: model.id, expectedRevision: model.revision, coaId: coa.id, ...changes });
      if (destroyed) return;
      if (result.ok) { touched.clear(); error.textContent = ''; } else error.textContent = describeError(result.error);
    }

    editing = { coaId: coa.id, sync };
    sync(coa);
    editor.replaceChildren(el('fieldset', { class: 'group' }, el('legend', { text: `${coa.name}: COA statement` }),
      el('div', { class: 'position' }, field('Name', name), field('Rank', rank)),
      ...STATEMENT_PARTS.map((p) => field(PART_HINTS[p].split(':')[0], parts[p])),
      field('End state', endState),
      error,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete COA', on: { click: () => askDelete(coa) } }))));
  }

  function closeEditor() { editing = null; editor.replaceChildren(); }

  async function onAdd(event) {
    event.preventDefault();
    const selected = store.get();
    if (!selected) return;
    const fields = { name: nameInput.value, rank: rankSelect.value }; // read now: the form may be reset while this waits
    // Adding a COA cannot clash with another change: use the model's latest revision.
    const latest = await client.ask('threat-model.get', { modelId: selected.id });
    const model = latest.ok ? latest.value : selected;
    const result = await client.send('threat-coa.add', { modelId: model.id, expectedRevision: model.revision, ...fields });
    if (destroyed) return;
    if (!result.ok) { addError.textContent = describeError(result.error); return; }
    addError.textContent = '';
    nameInput.value = '';
    rankSelect.value = 'other';
    await store.refresh(); // the store must hold the new COA before its play is shown
    if (!destroyed) playSelection.set(result.value.coas.at(-1).id); // show the new COA's play
  }

  let pendingDelete = null;
  function askDelete(coa) {
    pendingDelete = coa;
    confirmText.textContent = `Delete ${coa.name}, its statement and its play? This cannot be undone.`;
    dialog.showModal();
  }
  async function onConfirmDelete() {
    dialog.close();
    const coa = pendingDelete;
    pendingDelete = null;
    const latest = coa && await client.ask('threat-model.get', { modelId: store.get()?.id });
    if (!latest?.ok) return;
    const result = await client.send('threat-coa.remove', { modelId: latest.value.id, expectedRevision: latest.value.revision, coaId: coa.id });
    if (destroyed) return;
    if (result.ok) playSelection.set('formation');
    else editor.append(el('p', { class: 'field-error', text: describeError(result.error) }));
  }

  const offs = [store.subscribe((model) => render(model)), playSelection.subscribe(() => render(store.get()))];
  return {
    ready: store.ready.then(() => render(store.get())),
    destroy() { destroyed = true; offs.forEach((off) => off()); if (dialog.open) dialog.close(); },
  };
}
