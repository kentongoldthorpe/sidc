// Project section (driving adapter, M10-2, D27): the projects in this storage, like ArcGIS Pro
// projects. Lists them (the open one marked), opens another, creates, renames the open one, exports
// it as one file and imports a file as a new project, and deletes other projects. Opening a project
// starts the app afresh inside it, which is the composition root's job: this view calls onOpen(id).
import { el, describeError } from './dom.js';
import { formatDtg, slideFileName } from '../../export/slide-layout.js';

/**
 * @param {{ client: object, root: HTMLElement, summary?: HTMLElement|null, headerName?: HTMLElement|null, onOpen: (projectId: string) => void,
 *           saveFile: (blob: Blob, name: string) => Promise<void>|void, now?: () => string }} options
 * @returns {{ ready: Promise<void>, refresh(): Promise<void>, destroy(): void }}
 */
export function mountProjectsView({ client, root, summary = null, headerName = null, onOpen, saveFile, now = () => new Date().toISOString() }) {
  let destroyed = false;
  let projects = [];
  let current = null; // the open project
  let titleTouched = false;
  let loadSeq = 0;

  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const list = el('ul', { class: 'graphic-items', attrs: { 'aria-label': 'Projects' } });

  const title = el('input', { attrs: { name: 'project-title', autocomplete: 'off', maxlength: 120, 'aria-label': 'Name of the open project' }, on: { input: () => { titleTouched = true; } } });
  const renameButton = el('button', { attrs: { type: 'button' }, text: 'Rename', on: { click: onRename } });

  const newName = el('input', { attrs: { name: 'project-name', autocomplete: 'off', maxlength: 120, placeholder: 'e.g. Exercise IRON', 'aria-label': 'New project name' } });
  const newForm = el('form', { class: 'row new-coa-row', dataset: { newProject: '' }, attrs: { novalidate: true }, on: { submit: onCreate } },
    newName, el('button', { class: 'primary', attrs: { type: 'submit' }, text: 'New project' }));

  const fileInput = el('input', {
    attrs: { type: 'file', hidden: true, accept: '.json,application/json', 'aria-label': 'Import a project file', tabindex: '-1' },
    on: { change: onImportFile },
  });

  const confirmText = el('p', {});
  let pendingDelete = null;
  const dialog = el('dialog', { class: 'confirm', attrs: { 'aria-label': 'Confirm delete' } }, confirmText,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: () => dialog.close() } }),
      el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onConfirmDelete } })));

  root.replaceChildren(el('div', { class: 'stack' },
    alert,
    list,
    el('fieldset', { class: 'group' }, el('legend', { text: 'Open project' }),
      el('div', { class: 'row new-coa-row' }, title, renameButton),
      el('div', { class: 'actions' },
        el('button', { attrs: { type: 'button' }, text: 'Export project', on: { click: onExport } }),
        el('button', { attrs: { type: 'button' }, text: 'Import project…', on: { click: () => fileInput.click() } }),
        fileInput),
      el('p', { class: 'hint', text: 'A project file holds the COAs, threat models, systems and slide settings. Importing one makes a new project.' })),
    el('fieldset', { class: 'group' }, el('legend', { text: 'New project' }), newForm),
    status,
    dialog));

  const say = (text) => { status.textContent = text; alert.textContent = ''; };
  const fail = (text) => { alert.textContent = text; status.textContent = ''; };

  function render() {
    list.replaceChildren(...projects.map((p) => el('li', { dataset: { projectId: p.id } },
      el('div', { class: 'list-row', attrs: { 'aria-current': p.current ? 'true' : null } },
        el('span', { class: 'project-name', text: p.name }),
        el('span', { class: 'system-meta', text: p.current ? 'Current' : '' }),
        el('span', { class: 'actions' },
          p.current ? null : el('button', { class: 'link', attrs: { type: 'button', 'aria-label': `Open ${p.name}` }, text: 'Open', on: { click: () => onOpen(p.id) } }),
          p.current || p.id === 'default' ? null : el('button', { class: 'link danger', attrs: { type: 'button', 'aria-label': `Delete ${p.name}` }, text: 'Delete', on: { click: () => askDelete(p) } }))))));
    if (current) {
      if (!titleTouched) title.value = current.name;
      if (summary) summary.textContent = current.name;
      if (headerName) headerName.textContent = current.name;
    }
  }

  async function load() {
    const seq = ++loadSeq;
    const [listed, open] = await Promise.all([client.ask('project.list'), client.ask('project.get')]);
    if (destroyed || seq !== loadSeq) return;
    if (!listed.ok || !open.ok) { fail(describeError((listed.ok ? open : listed).error)); return; }
    projects = listed.value;
    current = open.value;
    render();
  }

  async function onCreate(event) {
    event.preventDefault();
    const name = newName.value;
    const result = await client.send('project.create', { name });
    if (destroyed) return;
    if (!result.ok) { fail(describeError(result.error)); return; }
    newName.value = '';
    say(`Created ${result.value.name}.`);
    onOpen(result.value.id);
  }

  async function onRename() {
    if (!current) return;
    const result = await client.send('project.rename', { projectId: current.id, expectedRevision: current.revision, name: title.value });
    if (destroyed) return;
    if (!result.ok) { fail(describeError(result.error)); return; }
    titleTouched = false;
    say(`Renamed to ${result.value.name}.`);
    await load();
  }

  async function onExport() {
    const result = await client.ask('project.export');
    if (destroyed) return;
    if (!result.ok) { fail(describeError(result.error)); return; }
    const blob = new Blob([JSON.stringify(result.value, null, 2)], { type: 'application/json' });
    await saveFile(blob, slideFileName(`${result.value.name} project`, formatDtg(now()), 'json'));
    say(`Exported ${result.value.name}: ${result.value.coas.length} COAs, ${result.value.threatModels.length} threat models, ${result.value.systems.length} systems.`);
  }

  async function onImportFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let doc;
    try { doc = JSON.parse(await file.text()); } catch { fail(`${file.name} is not a COA Builder project file (it is not JSON).`); return; }
    const result = await client.send('project.import', { document: doc });
    if (destroyed) return;
    if (!result.ok) {
      const problems = result.error.details?.problems ?? [];
      fail(`${file.name}: ${result.error.code === 'IMPORT_INVALID' && problems[0]?.field === 'format' ? 'This is not a COA Builder project file.' : describeError(result.error)}${problems.length > 1 ? ` (${problems.slice(0, 5).map((p) => `${p.field} ${p.reason}`).join('; ')})` : ''}`);
      return;
    }
    say(`Imported ${result.value.name}.`);
    onOpen(result.value.id);
  }

  function askDelete(project) {
    pendingDelete = project;
    confirmText.textContent = `Delete the project ${project.name} and every COA, threat model and system in it? This cannot be undone. Export it first to keep a copy.`;
    dialog.showModal();
  }

  async function onConfirmDelete() {
    dialog.close();
    const project = pendingDelete;
    pendingDelete = null;
    if (!project) return;
    const latest = await client.ask('project.get', { projectId: project.id });
    if (destroyed || !latest.ok) { if (!latest.ok) fail(describeError(latest.error)); return; }
    const result = await client.send('project.delete', { projectId: project.id, expectedRevision: latest.value.revision });
    if (destroyed) return;
    if (!result.ok) { fail(describeError(result.error)); return; }
    say(`Deleted ${project.name}.`);
  }

  const off = client.subscribe('project.*', () => { load(); });
  return {
    ready: load(),
    refresh: load,
    destroy() { destroyed = true; off(); if (dialog.open) dialog.close(); },
  };
}
