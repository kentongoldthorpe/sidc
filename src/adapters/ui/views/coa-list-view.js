// COA list view (driving adapter): create, select, rename, duplicate and delete COAs.
// Talks to the app only through the app client; re-reads the list whenever a coa.* or symbol.*
// event is published (by this view, another view or another client), so it always shows the truth.
import { readImportFile } from '../../files/import-file.js';
import { el, describeError } from './dom.js';
import { createMemoryPrefs } from '../prefs.js';
import { coalesce } from './coalesce.js';

const LEVELS = Object.freeze(['active', 'recent', 'all']);
const RECENT_COUNT = 3; // shown besides the active COA at the "recent" level
const HISTORY_LENGTH = 20;

const unitCount = (n) => `${n} unit${n === 1 ? '' : 's'}`;
const when = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * @param {{ client: object, root: HTMLElement, selection: ReturnType<import('../selection.js').createSelection>,
 *           levels?: boolean, prefs?: object, summary?: HTMLElement|null }} options
 *   levels: show the active / recent / all levels with Show more / Show less (layout v2); otherwise all.
 *   prefs: per-viewer memory for the level and the recently used COAs.
 *   summary: an element that shows the active COA's name (the section header).
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mountCoaListView({ client, root, selection, levels = false, prefs = createMemoryPrefs(), summary = null }) {
  let summaries = [];
  let level = levels ? prefs.get('coaLevel', 'recent') : 'all';
  if (!LEVELS.includes(level)) level = 'recent';
  let history = levels ? prefs.get('recentCoas', []) : []; // most recently selected first
  let editing = null; // { coaId, draft, error, input?, errorText? }
  let pendingDelete = null; // summary awaiting confirmation
  let loadSeq = 0;
  let destroyed = false;

  // ---- static structure ----
  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const nameInput = el('input', { attrs: { name: 'name', autocomplete: 'off', placeholder: 'New COA name', 'aria-label': 'New COA name', 'aria-describedby': 'new-coa-error' } });
  const nameError = el('p', { class: 'field-error', dataset: { error: '' }, attrs: { id: 'new-coa-error' } });
  const form = el('form', { class: 'new-coa', dataset: { newCoa: '' }, attrs: { novalidate: true }, on: { submit: onCreate } },
    el('div', { class: 'row' }, nameInput, el('button', { class: 'primary', attrs: { type: 'submit' }, text: 'Add' })),
    nameError);
  // Import COAs…: a file (docs/IMPORT-FORMAT.md, GeoJSON or CSV; see readImportFile) → coa.import.
  const fileInput = el('input', {
    attrs: { type: 'file', hidden: true, accept: '.json,.geojson,.csv,application/json,application/geo+json,text/csv', 'aria-label': 'Import COAs from a file', tabindex: '-1' },
    on: { change: onImportFile },
  });
  const importStatus = el('p', { class: 'import-status', dataset: { importStatus: '' }, attrs: { role: 'status' } });
  const importProblems = el('ul', { class: 'import-problems', dataset: { importProblems: '' } });
  const importer = el('div', { class: 'import', dataset: { import: '' } },
    el('button', { class: 'link', attrs: { type: 'button' }, text: 'Import COAs…', on: { click: () => fileInput.click() } }),
    fileInput, importStatus, importProblems);
  const empty = el('p', { class: 'placeholder', dataset: { empty: '' }, text: 'No COAs yet. Create one above.' });
  const list = el('ul', { class: 'coa-items', attrs: { 'aria-label': 'Courses of action' } });
  const levelControls = el('div', { class: 'list-levels' });
  const confirmText = el('p', { dataset: { message: '' } });
  const dialog = el('dialog', { class: 'confirm', attrs: { 'aria-label': 'Confirm delete' } },
    confirmText,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onConfirmDelete } })));
  root.replaceChildren(el('div', { class: 'coa-list' }, alert, form, importer, empty, list, levelControls, dialog));

  const showAlert = (text) => { alert.textContent = text; };

  // ---- rendering ----
  function renderItem(summary) {
    const selected = summary.id === selection.get();
    const isEditing = editing?.coaId === summary.id;
    const head = isEditing ? renameForm(summary) : el('button', {
      class: 'coa-select', dataset: { select: '' }, attrs: { type: 'button', 'aria-current': selected ? 'true' : null },
      on: { click: () => selection.set(summary.id) },
    },
    el('span', { class: 'coa-name', dataset: { coaName: '' }, text: summary.name }),
    el('span', { class: 'coa-meta', text: `${unitCount(summary.symbolCount)} · ${when(summary.updatedAt)}` }));

    const action = (label, handler) => el('button', {
      class: 'link', attrs: { type: 'button', 'aria-label': `${label} ${summary.name}` }, text: label, on: { click: handler },
    });
    return el('li', { class: `coa-item${selected ? ' is-selected' : ''}`, dataset: { coaId: summary.id } },
      head,
      isEditing ? null : el('div', { class: 'coa-actions' },
        action('Rename', () => startRename(summary)),
        action('Duplicate', () => duplicate(summary)),
        action('Delete', () => askDelete(summary))));
  }

  function renameForm(summary) {
    const input = el('input', {
      attrs: { 'aria-label': `New name for ${summary.name}`, 'aria-invalid': editing.error ? 'true' : null, 'aria-describedby': `rename-error-${summary.id}` },
      on: {
        input: (e) => { editing.draft = e.target.value; },
        keydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); saveRename(summary); }
          if (e.key === 'Escape') { e.preventDefault(); editing = null; render(); } // same as the Cancel button
        },
      },
    });
    input.value = editing.draft;
    const errorText = el('p', { class: 'field-error', dataset: { error: '' }, attrs: { id: `rename-error-${summary.id}` }, text: editing.error ?? '' });
    editing.input = input;
    editing.errorText = errorText;
    const cancel = () => { editing = null; render(); };
    return el('div', { class: 'rename', dataset: { rename: '' } },
      input,
      errorText,
      el('div', { class: 'rename-actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: () => saveRename(summary) } }),
        el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: cancel } })));
  }

  /** The COAs shown at the current level. */
  function visible() {
    if (level === 'all') return summaries;
    const byId = new Map(summaries.map((x) => [x.id, x]));
    const active = byId.get(selection.get());
    if (level === 'active') return active ? [active] : [];
    const ordered = [...new Set([selection.get(), ...history, ...summaries.map((x) => x.id)])];
    return ordered.map((id) => byId.get(id)).filter(Boolean).slice(0, 1 + RECENT_COUNT);
  }

  function setLevel(next) {
    level = next;
    prefs.set('coaLevel', level);
    render();
  }

  function renderLevelControls() {
    if (!levels) return;
    const index = LEVELS.indexOf(level);
    const buttons = [
      index < LEVELS.length - 1 ? el('button', { class: 'link', attrs: { type: 'button' }, text: 'Show more', on: { click: () => setLevel(LEVELS[index + 1]) } }) : null,
      index > 0 ? el('button', { class: 'link', attrs: { type: 'button' }, text: 'Show less', on: { click: () => setLevel(LEVELS[index - 1]) } }) : null,
    ];
    levelControls.replaceChildren(...buttons.filter(Boolean)); // replaceChildren would print a null as the text "null"
  }

  function render() {
    if (destroyed) return;
    empty.hidden = summaries.length > 0;
    list.classList.toggle('is-all', level === 'all');
    list.replaceChildren(...visible().map(renderItem));
    renderLevelControls();
    if (summary) summary.textContent = summaries.find((x) => x.id === selection.get())?.name ?? '';
    editing?.input?.focus(); // focus at once, so no keystroke is lost
  }

  async function refresh() {
    const seq = ++loadSeq;
    const result = await client.ask('coa.list', {});
    if (destroyed || seq !== loadSeq) return; // a newer refresh is on its way
    if (!result.ok) { showAlert(describeError(result.error)); return; }
    summaries = result.value;
    const selectedId = selection.get();
    if (selectedId !== null && !summaries.some((s) => s.id === selectedId)) selection.set(null);
    if (editing && !summaries.some((s) => s.id === editing.coaId)) editing = null;
    render();
  }

  // ---- actions ----
  async function onCreate(event) {
    event.preventDefault();
    const result = await client.send('coa.create', { name: nameInput.value });
    if (result.ok) {
      nameInput.value = '';
      nameInput.removeAttribute('aria-invalid');
      nameError.textContent = '';
      showAlert('');
      selection.set(result.value.id);
      await refresh();
    } else if (result.error.code === 'VALIDATION_FAILED') {
      nameInput.setAttribute('aria-invalid', 'true');
      nameError.textContent = describeError(result.error);
    } else {
      showAlert(describeError(result.error));
    }
  }

  const MAX_PROBLEMS_SHOWN = 20;
  function showImport(text, problems = []) {
    importStatus.textContent = text;
    const shown = problems.slice(0, MAX_PROBLEMS_SHOWN).map((p) => el('li', { text: `${p.field}: ${p.reason}` }));
    if (problems.length > MAX_PROBLEMS_SHOWN) shown.push(el('li', { text: `…and ${problems.length - MAX_PROBLEMS_SHOWN} more` }));
    importProblems.replaceChildren(...shown);
  }

  async function onImportFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = ''; // choosing the same file again still imports it
    showImport(`Reading ${file.name}…`);
    const read = readImportFile(await file.text());
    const result = read.ok ? await client.send('coa.import', { document: read.value.document }) : read;
    if (destroyed) return;
    if (!result.ok) {
      const where = read.ok ? read.value.where : (field) => field; // problems in file terms (CSV row/column, GeoJSON feature)
      const problems = (result.error.details?.problems ?? []).map((p) => ({ ...p, field: where(p.field) }));
      showImport(`Nothing was imported from ${file.name}: ${result.error.message}.`, problems);
      return;
    }
    const { coas } = result.value;
    showImport(`Imported ${coas.length} COA${coas.length === 1 ? '' : 's'} from ${file.name}.`);
    selection.set(coas[0].id);
    await refresh();
  }

  function startRename(summary) {
    editing = { coaId: summary.id, draft: summary.name, error: null };
    render();
  }

  async function saveRename(summary) {
    const result = await client.send('coa.update', { coaId: summary.id, name: editing.draft });
    if (result.ok) {
      editing = null;
      showAlert('');
      await refresh();
    } else if (result.error.code === 'VALIDATION_FAILED') {
      // Update in place: re-rendering would replace the input the user is typing in.
      editing.error = describeError(result.error);
      editing.input.setAttribute('aria-invalid', 'true');
      editing.errorText.textContent = editing.error;
    } else {
      editing = null;
      showAlert(describeError(result.error));
      await refresh();
    }
  }

  async function duplicate(summary) {
    const result = await client.send('coa.duplicate', { coaId: summary.id });
    if (!result.ok) { showAlert(describeError(result.error)); return; }
    selection.set(result.value.id);
    await refresh();
  }

  function askDelete(summary) {
    pendingDelete = summary;
    confirmText.textContent = `Delete “${summary.name}”? This cannot be undone.`;
    dialog.showModal();
  }

  async function onConfirmDelete() {
    dialog.close();
    const target = pendingDelete;
    pendingDelete = null;
    if (!target) return;
    const result = await client.send('coa.delete', { coaId: target.id });
    if (!result.ok) showAlert(describeError(result.error));
    await refresh(); // clears the selection if the selected COA is gone
  }

  // ---- wiring ----
  const refreshSoon = coalesce(() => { if (!destroyed) refresh(); });
  const unsubscribes = [
    client.subscribe('coa.*', () => refreshSoon()),
    client.subscribe('symbol.*', () => refreshSoon()),
    selection.subscribe((id) => {
      if (levels && id !== null) {
        history = [id, ...history.filter((x) => x !== id)].slice(0, HISTORY_LENGTH);
        prefs.set('recentCoas', history);
      }
      render();
    }),
  ];

  const ready = refresh().then(() => {
    if (destroyed || selection.get() !== null || summaries.length === 0) return;
    const lastUsed = history.find((id) => summaries.some((x) => x.id === id));
    selection.set(lastUsed ?? summaries[0].id);
  });

  return {
    ready,
    destroy() {
      destroyed = true;
      unsubscribes.forEach((off) => off());
      if (dialog.open) dialog.close();
    },
  };
}
