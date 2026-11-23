// Systems panel (driving adapter, T-1, decision D22): the user's list of weapon and sensor systems,
// reused by threat models for fields of fire and air-defence coverage. Ranges are typed in km and
// stored in metres. The editor follows changes made elsewhere in the fields you have not touched.
import { el, describeError } from './dom.js';
import { coalesce } from './coalesce.js';
import { SYSTEM_ROLES } from '../../../domain/system.js';

export const ROLE_NAMES = Object.freeze({ direct: 'Direct fire', indirect: 'Indirect fire', airDefence: 'Air defence', sensor: 'Sensor', other: 'Other' });

const km = (metres) => String(Number((metres / 1000).toFixed(3)));
/** "12 km" or "0.1–2.5 km", plus the arc. */
export const describeSystem = (s) => `${ROLE_NAMES[s.role]} · ${s.minRange ? `${km(s.minRange)}–` : ''}${km(s.maxRange)} km · ${s.arc === 360 ? 'all round' : `${s.arc}°`}`;

/** Typed km → metres; '' → undefined; anything else is passed on as typed, so the core reports it. */
function metresFrom(text) {
  const t = text.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 1000) : text;
}
function numberFrom(text) {
  const t = text.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : text;
}

/** Problem wording in the form's own terms (km, degrees). */
const MESSAGES = Object.freeze({
  name: (reason) => `Name ${reason}`,
  role: () => 'Choose a role',
  maxRange: () => 'Maximum range must be a number of km above 0',
  minRange: (reason) => (/less than/.test(reason) ? 'Minimum range must be less than the maximum range' : 'Minimum range must be a number of km (or empty)'),
  arc: () => 'Arc must be more than 0 and at most 360 degrees (360 = all round)',
});

/** @param {{ client: object, root: HTMLElement }} options @returns {{ ready: Promise<void>, destroy(): void }} */
export function mountSystemsView({ client, root }) {
  let destroyed = false;
  let systems = [];
  let editing = null; // { systemId | null, touched, controls, errors, sync(system) }
  let loadSeq = 0;

  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const empty = el('p', { class: 'placeholder', text: 'No systems yet. Add the weapons and sensors your threat models use, with their ranges.' });
  const list = el('ul', { class: 'system-items', attrs: { 'aria-label': 'Systems' } });
  const editor = el('div', { class: 'system-editor' });
  const addButton = el('button', { attrs: { type: 'button' }, text: 'Add system', on: { click: () => openEditor(null) } });
  root.replaceChildren(el('div', { class: 'systems-panel stack' }, alert, el('div', { class: 'actions' }, addButton), empty, list, editor, status));

  function renderList() {
    empty.hidden = systems.length > 0;
    list.replaceChildren(...systems.map((s) => el('li', { dataset: { systemId: s.id } },
      el('button', { class: 'list-row system-select', attrs: { type: 'button', 'aria-current': editing?.systemId === s.id ? 'true' : null }, on: { click: () => openEditor(s.id) } },
        el('span', { class: 'system-name', text: s.name }),
        el('span', { class: 'system-meta', text: describeSystem(s) })))));
  }

  function openEditor(systemId) {
    const current = () => systems.find((s) => s.id === systemId) ?? null;
    const touched = new Set();
    const field = (name, label, control, key) => {
      const error = el('p', { class: 'field-error', attrs: { id: `${name}-error` } });
      control.setAttribute('aria-describedby', `${name}-error`);
      ['input', 'change'].forEach((t) => control.addEventListener(t, () => touched.add(key)));
      return { key, control, error, row: el('div', { class: 'stack' }, el('label', { class: 'field' }, el('span', { text: label }), control), error) };
    };
    const name = field('system-name', 'Name', el('input', { attrs: { name: 'system-name', autocomplete: 'off', maxlength: 60, placeholder: 'e.g. SA-15, T-72 main gun' } }), 'name');
    const role = field('system-role', 'Role', el('select', { attrs: { name: 'system-role' } }, ...SYSTEM_ROLES.map((r) => el('option', { attrs: { value: r }, text: ROLE_NAMES[r] }))), 'role');
    const max = field('system-max', 'Maximum range (km)', el('input', { attrs: { name: 'system-max', inputmode: 'decimal', autocomplete: 'off' } }), 'maxRange');
    const min = field('system-min', 'Minimum range (km, optional)', el('input', { attrs: { name: 'system-min', inputmode: 'decimal', autocomplete: 'off' } }), 'minRange');
    const arc = field('system-arc', 'Arc (°, 360 = all round)', el('input', { attrs: { name: 'system-arc', inputmode: 'decimal', autocomplete: 'off', placeholder: '360' } }), 'arc');
    const fields = [name, role, max, min, arc];

    function sync(system) {
      if (!system) return;
      if (!touched.has('name')) name.control.value = system.name;
      if (!touched.has('role')) role.control.value = system.role;
      if (!touched.has('maxRange')) max.control.value = km(system.maxRange);
      if (!touched.has('minRange')) min.control.value = system.minRange ? km(system.minRange) : '';
      if (!touched.has('arc')) arc.control.value = String(system.arc);
    }

    async function onSave() {
      fields.forEach((f) => { f.error.textContent = ''; f.control.removeAttribute('aria-invalid'); });
      const typed = {
        name: name.control.value, role: role.control.value,
        maxRange: metresFrom(max.control.value), minRange: metresFrom(min.control.value), arc: numberFrom(arc.control.value),
      };
      const latest = current();
      let result;
      if (!latest) {
        const payload = Object.fromEntries(Object.entries(typed).filter(([, v]) => v !== undefined));
        if (!('maxRange' in payload)) payload.maxRange = '';
        result = await client.send('system.create', payload);
      } else {
        const changes = {};
        for (const key of touched) {
          const value = key === 'minRange' && typed.minRange === undefined ? null : typed[key];
          if (value !== undefined && value !== (latest[key] ?? null)) changes[key] = value;
        }
        if (Object.keys(changes).length === 0) { closeEditor(); return; }
        result = await client.send('system.update', { systemId: latest.id, expectedRevision: latest.revision, ...changes });
      }
      if (destroyed) return;
      if (result.ok) {
        status.textContent = `Saved ${result.value.name}.`;
        closeEditor();
        await load();
        return;
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        for (const p of result.error.details.problems) {
          const f = fields.find((x) => x.key === p.field) ?? name;
          f.error.textContent = (MESSAGES[p.field] ?? ((r) => `${p.field} ${r}`))(p.reason);
          f.control.setAttribute('aria-invalid', 'true');
        }
      } else {
        alert.textContent = describeError(result.error);
      }
    }

    async function onDelete() {
      const latest = current();
      if (!latest) return;
      const result = await client.send('system.delete', { systemId: latest.id, expectedRevision: latest.revision });
      if (destroyed) return;
      if (!result.ok) { alert.textContent = describeError(result.error); return; }
      status.textContent = `Deleted ${latest.name}.`;
      closeEditor();
      await load();
    }

    editing = { systemId, sync };
    if (systemId) sync(current()); else { role.control.value = 'direct'; }
    alert.textContent = '';
    editor.replaceChildren(el('fieldset', { class: 'group' },
      el('legend', { text: systemId ? `Edit ${current()?.name ?? 'system'}` : 'New system' }),
      name.row, role.row, el('div', { class: 'position' }, max.row, min.row), arc.row,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: closeEditor } }),
        systemId ? el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onDelete } }) : null)));
    renderList();
    name.control.focus();
  }

  function closeEditor() {
    editing = null;
    editor.replaceChildren();
    renderList();
  }

  async function load() {
    const seq = ++loadSeq;
    const result = await client.ask('system.list', {});
    if (destroyed || seq !== loadSeq) return;
    if (!result.ok) { alert.textContent = describeError(result.error); return; }
    systems = result.value;
    if (editing?.systemId) {
      const latest = systems.find((s) => s.id === editing.systemId);
      if (latest) editing.sync(latest); else closeEditor();
    }
    renderList();
  }

  const reload = coalesce(() => { if (!destroyed) load(); });
  const off = client.subscribe('system.*', reload);

  return {
    ready: load(),
    /** Reload the list (e.g. after a change in another window). */
    refresh: () => load(),
    destroy() { destroyed = true; off(); },
  };
}
