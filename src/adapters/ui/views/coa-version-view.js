// The selected COA's version and updates from files (Epic 6 E6-3, D44).
// Shows the version fingerprint (to match against paper) and the last update recorded, and offers
// Update from file…: a CSV change sheet, or an edited CSV / GeoJSON / JSON export, previewed item by
// item (added, changed with the move in metres, removed) before anything is saved. When the file was
// made from another version, applying needs a deliberate tick. docs/CHANGE-SHEETS.md
import { el, describeError } from './dom.js';
import { readImportFile } from '../../files/import-file.js';
import { coaFingerprint, readFingerprint } from '../../../domain/coa-changes.js';
import { mgrsOf } from '../../../domain/mgrs.js';
import { itemsOutside } from '../../../domain/area-of-operations.js';

const KIND = Object.freeze({ unit: 'Unit', line: 'Line' });
const FIELD_NAMES = Object.freeze({ position: 'grid', sidc: 'symbol', label: 'name', modifiers: 'text', facing: 'facing', hvt: 'HVT', weapons: 'weapons', details: 'details', points: 'points', center: 'centre', radius: 'radius', annotation: 'text above', side: 'side', kind: 'kind', color: 'colour', bearing: 'bearing', arc: 'arc', minRadius: 'minimum range' });
const metres = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const dtgOf = (iso) => { const d = new Date(iso); const two = (n) => String(n).padStart(2, '0'); return `${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}Z`; };

/** One line saying what a change does, e.g. "grid 18S UJ 2410 0702 → 18S UJ 2420 0710 (128 m)". */
export function describeChange(c) {
  if (c.action === 'add') return c.kind === 'unit' && c.after?.position ? `new, at ${mgrsOf(c.after.position)}` : 'new';
  if (c.action === 'remove') return c.notInFile ? 'not in the file' : 'removed';
  return (c.fields ?? []).map((f) => {
    if (f === 'position') return `grid ${mgrsOf(c.before.position)} → ${mgrsOf(c.after.position)} (${metres(c.movedMetres)})`;
    if (f === 'label') return `renamed ${c.newName}`;
    return FIELD_NAMES[f] ?? f;
  }).join('; ');
}

/**
 * @param {{ client: object, root: HTMLElement, activeCoa: object }} options
 * @returns {{ destroy(): void }}
 */
export function mountCoaVersionView({ client, root, activeCoa, aoStore = null }) {
  let destroyed = false;
  let session = null; // { file, document, where, diff }

  const version = el('p', { class: 'coa-version', dataset: { coaVersion: '' } });
  const last = el('p', { class: 'hint', dataset: { lastTransfer: '' } });
  const outsideNote = el('p', { class: 'ao-warning', dataset: { outsideAo: '' } });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const fileInput = el('input', { attrs: { type: 'file', hidden: true, accept: '.csv,.json,.geojson,text/csv,application/json,application/geo+json', 'aria-label': 'Update the selected COA from a file', tabindex: '-1' }, on: { change: onFile } });
  const updateButton = el('button', { class: 'link', dataset: { updateFromFile: '' }, attrs: { type: 'button' }, text: 'Update from file…', on: { click: () => fileInput.click() } });
  const box = el('div', { class: 'coa-version-box' }, version, last, outsideNote, el('div', { class: 'actions' }, updateButton, fileInput), status);

  // The preview dialog.
  const title = el('h3', { class: 'subheading' });
  const versionNote = el('p', { dataset: { versionNote: '' } });
  const basedOn = el('input', { attrs: { name: 'based-on', autocomplete: 'off', spellcheck: 'false', size: 11, placeholder: 'K7Q3-MD2A', 'aria-label': 'Version the file or sheet was made from' } });
  const mode = el('select', { attrs: { name: 'update-mode', 'aria-label': 'How to update' } },
    el('option', { attrs: { value: 'merge' }, text: 'Change only what the file lists' }),
    el('option', { attrs: { value: 'replace' }, text: 'Match the file (also remove what it does not list)' }));
  const table = el('table', { class: 'change-table', dataset: { changes: '' } });
  const counts = el('p', { dataset: { changeCounts: '' } });
  const problems = el('ul', { class: 'import-problems' });
  const enteredBy = el('input', { attrs: { name: 'entered-by', autocomplete: 'off', maxlength: 120, placeholder: 'e.g. SGT Smith' } });
  const checkedBy = el('input', { attrs: { name: 'checked-by', autocomplete: 'off', maxlength: 120, placeholder: 'e.g. CPL Jones' } });
  const accept = el('input', { attrs: { type: 'checkbox', name: 'accept-mismatch' } });
  const acceptRow = el('label', { class: 'check accept-mismatch' }, accept, el('span', { text: 'Apply anyway: I have checked every change against the COA as it is now' }));
  const applyButton = el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Apply', on: { click: onApply } });
  const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
  const dialog = el('dialog', { class: 'update-dialog', attrs: { 'aria-label': 'Update from file' } },
    el('div', { class: 'stack' }, title, versionNote,
      el('div', { class: 'position' }, field('Made from version', basedOn), field('How', mode)),
      counts, table, problems,
      el('div', { class: 'position' }, field('Entered by (optional)', enteredBy), field('Read back by (optional)', checkedBy)),
      acceptRow,
      el('div', { class: 'actions' }, applyButton, el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: close } }))));
  // The dialog belongs to the page, not the panel section: it must show even when the section is collapsed.
  root.replaceChildren(box);
  root.ownerDocument.body.append(dialog);
  basedOn.addEventListener('change', () => preview());
  mode.addEventListener('change', () => preview());
  accept.addEventListener('change', () => { applyButton.disabled = !canApply(); });

  function render(coa) {
    box.hidden = !coa;
    if (!coa) return;
    version.replaceChildren(el('span', { text: 'Version ' }), el('strong', { class: 'fingerprint', text: coaFingerprint(coa) }));
    const ao = aoStore?.get();
    const out = itemsOutside(coa, ao);
    outsideNote.textContent = out.length ? `⚠ ${out.length} outside ${ao.name || 'the area of operations'}: ${out.slice(0, 6).map((x) => x.name || (x.kind === 'unit' ? 'a unit' : 'a line')).join(', ')}${out.length > 6 ? ', …' : ''}. Check their grids.` : '';
    const t = coa.transfers?.at(-1);
    last.textContent = t
      ? `Last updated from ${t.file ?? 'a file'} at ${dtgOf(t.at)}: ${t.added} added, ${t.changed} changed, ${t.removed} removed${t.enteredBy ? `; entered by ${t.enteredBy}` : ''}${t.checkedBy ? `, read back by ${t.checkedBy}` : ''}.`
      : 'Write this version on paper copies; a change sheet names it.';
  }

  async function onFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    const coa = activeCoa.get();
    if (!file || !coa) return;
    const read = readImportFile(await file.text());
    if (!read.ok) { status.textContent = `${file.name}: ${describeError(read.error)}${read.error.details?.problems?.length ? ` (${read.error.details.problems.slice(0, 3).map((p) => `${p.field} ${p.reason}`).join('; ')})` : ''}`; return; }
    session = { file: file.name, document: read.value.document, where: read.value.where };
    title.textContent = `Update ${coa.name} from ${file.name}`;
    basedOn.value = '';
    mode.value = 'merge';
    accept.checked = false;
    enteredBy.value = '';
    checkedBy.value = '';
    status.textContent = '';
    await preview();
    if (!destroyed && !dialog.open) dialog.showModal();
  }

  function canApply() {
    const d = session?.diff;
    return Boolean(d && d.changes.length && (d.versionMatches !== false || accept.checked));
  }

  async function preview() {
    if (!session) return;
    const coa = activeCoa.get();
    const typed = basedOn.value.trim();
    if (typed && !readFingerprint(typed)) { versionNote.textContent = `"${typed}" is not a version like K7Q3-MD2A.`; return; }
    const result = await client.ask('coa.diff', { coaId: coa.id, document: session.document, mode: mode.value, ...(typed ? { basedOn: typed } : {}) });
    if (destroyed) return;
    session.diff = result.ok ? result.value : null;
    problems.replaceChildren();
    table.replaceChildren();
    if (!result.ok) {
      counts.textContent = `${session.file} cannot be applied: ${describeError(result.error)}`;
      const list = result.error.details?.problems ?? [];
      problems.replaceChildren(...list.slice(0, 20).map((p) => el('li', { text: `${session.where(p.field)}: ${p.reason}` })), ...(list.length > 20 ? [el('li', { text: `… and ${list.length - 20} more` })] : []));
      versionNote.textContent = '';
      acceptRow.hidden = true;
      applyButton.disabled = true;
      return;
    }
    const d = result.value;
    if (!typed && d.basedOn) basedOn.value = d.basedOn;
    versionNote.className = d.versionMatches === false ? 'alert' : 'hint';
    versionNote.textContent = d.versionMatches === true ? `Made from version ${d.basedOn}: the COA's version now. ✓`
      : d.versionMatches === false ? `Made from version ${d.basedOn}, but ${d.name} is now at version ${d.fingerprint}: it has changed since. Check each change below against the COA as it is now.`
        : `The file does not say which version it was made from. ${d.name} is at version ${d.fingerprint}; type the version written on the sheet to check it.`;
    acceptRow.hidden = d.versionMatches !== false;
    const n = (a) => d.changes.filter((c) => c.action === a).length;
    counts.textContent = d.changes.length
      ? `${n('add')} to add, ${n('change')} to change, ${n('remove')} to remove${d.unchanged ? `; ${d.unchanged} already the same` : ''}${d.kept ? `; ${d.kept} without a name kept` : ''}.`
      : `Nothing to change${d.unchanged ? `: ${d.unchanged} already the same` : ''}.`;
    if (d.changes.length) {
      table.replaceChildren(
        el('thead', {}, el('tr', {}, ...['', 'Item', 'Change'].map((t) => el('th', { attrs: { scope: 'col' }, text: t })))),
        el('tbody', {}, ...d.changes.map((c) => el('tr', { class: `change-${c.action}${c.check || c.outsideAo ? ' needs-check' : ''}`, dataset: { change: c.action } },
          el('td', { class: 'change-action', text: { add: 'Add', change: 'Change', remove: 'Remove' }[c.action] }),
          el('td', { text: `${KIND[c.kind]} ${c.name || '(no name)'}` }),
          el('td', { text: `${describeChange(c)}${c.check ? ` ⚠ ${c.check}` : ''}${c.outsideAo ? ' ⚠ outside the area of operations' : ''}` })))));
    }
    applyButton.textContent = d.changes.length ? `Apply ${d.changes.length} change${d.changes.length === 1 ? '' : 's'}` : 'Apply';
    applyButton.disabled = !canApply();
  }

  async function onApply() {
    const d = session?.diff;
    if (!canApply()) return;
    applyButton.disabled = true;
    const typed = basedOn.value.trim();
    const result = await client.send('coa.update-from-file', {
      coaId: d.coaId, expectedRevision: d.revision, document: session.document, mode: mode.value,
      ...(typed ? { basedOn: typed } : {}), acceptVersionMismatch: accept.checked,
      transfer: { file: session.file, enteredBy: enteredBy.value, checkedBy: checkedBy.value },
    });
    if (destroyed) return;
    if (!result.ok) {
      counts.textContent = result.error.code === 'CONFLICT' ? 'The COA changed while you were looking: check the changes again.' : describeError(result.error);
      await preview();
      return;
    }
    const t = result.value.transfer;
    status.textContent = `Updated ${result.value.coa.name} from ${session.file}: ${t.added} added, ${t.changed} changed, ${t.removed} removed. Version ${t.to}. Undo puts it back.`;
    close();
  }

  function close() { session = null; if (dialog.open) dialog.close(); }

  const off = activeCoa.subscribe((coa) => render(coa));
  const offAo = aoStore?.subscribe(() => render(activeCoa.get())) ?? (() => {});
  render(activeCoa.get());
  return { destroy() { destroyed = true; off(); offAo(); close(); dialog.remove(); } };
}
