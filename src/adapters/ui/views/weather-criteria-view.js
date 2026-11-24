// Critical values section (driving adapter, Epic 4, D36): per operation or system, the values at
// which weather becomes marginal (amber) or unfavourable (red). The starter set is offered as
// examples to check and edit, never added without being asked.
import { el, describeError } from './dom.js';
import { RULE_FACTORS, FACTOR_LABELS, FACTOR_UNITS, PRECIPITATION_TYPES } from '../../../domain/weather.js';

const LOWER_WORSE = new Set(['visibilityKm', 'ceilingFt', 'temperatureMinC', 'illuminationPct']);
const TYPE_NAMES = Object.freeze({ freezingRain: 'freezing rain' });
const listText = (v) => (Array.isArray(v) ? v.join(', ') : v);
const typesText = (v) => v.map((t) => TYPE_NAMES[t] ?? t).join(', ');
/** "Ceiling ≤ 1000 / 500 ft" */
export const describeRule = (r) => {
  if (r.factor === 'precipitation') return `${FACTOR_LABELS.precipitation}: ${[r.amber ? `amber ${typesText(r.amber)}` : '', r.red ? `red ${typesText(r.red)}` : ''].filter(Boolean).join('; ')}`;
  const sign = LOWER_WORSE.has(r.factor) ? '≤' : '≥';
  return `${FACTOR_LABELS[r.factor]} ${sign} ${[r.amber ?? '–', r.red ?? '–'].join(' / ')} ${FACTOR_UNITS[r.factor]}`.trim();
};
const toNumber = (text) => { const t = text.trim().replace(',', '.'); if (t === '') return undefined; const n = Number(t); return Number.isFinite(n) ? n : text; };
const toTypes = (text) => (text.trim() === '' ? undefined : text.split(/[,;]\s*/).map((t) => t.trim()).filter(Boolean));

/**
 * @param {{ client: object, root: HTMLElement, summary?: HTMLElement|null }} options
 * @returns {{ ready: Promise<void>, refresh(): Promise<void>, destroy(): void }}
 */
export function mountWeatherCriteriaView({ client, root, summary = null }) {
  let destroyed = false;
  let criteria = [];
  let editing = null;
  let seq = 0;

  const alert = el('div', { class: 'alert', attrs: { role: 'alert' } });
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const empty = el('p', { class: 'placeholder', text: 'No critical values yet. Add your own, or add the example values to start from.' });
  const list = el('ul', { class: 'system-items', attrs: { 'aria-label': 'Critical values' } });
  const editor = el('div', { class: 'system-editor' });
  root.replaceChildren(el('div', { class: 'stack' },
    alert,
    el('div', { class: 'actions' },
      el('button', { attrs: { type: 'button' }, text: 'New', on: { click: () => openEditor(null) } }),
      el('button', { class: 'link', dataset: { addExamples: '' }, attrs: { type: 'button' }, text: 'Add example values', on: { click: onExamples } })),
    el('p', { class: 'hint', text: 'Example values show how the matrix works. They are examples, not doctrine: check each against your unit\'s references and edit it.' }),
    empty, list, editor, status));

  const say = (text) => { status.textContent = text; alert.textContent = ''; };
  const fail = (text) => { alert.textContent = text; status.textContent = ''; };

  function render() {
    empty.hidden = criteria.length > 0;
    if (summary) summary.textContent = criteria.length ? String(criteria.length) : '';
    list.replaceChildren(...criteria.map((c) => el('li', { dataset: { criterionId: c.id } },
      el('button', { class: 'list-row system-select', attrs: { type: 'button', 'aria-current': editing?.id === c.id ? 'true' : null }, on: { click: () => openEditor(c.id) } },
        el('span', { class: 'system-name' }, c.name, c.example ? el('span', { class: 'example-badge', text: 'Example' }) : null),
        el('span', { class: 'system-meta', text: `${c.group ? `${c.group} · ` : ''}${c.rules.map(describeRule).join(' · ') || 'no values yet'}` })))));
  }

  async function load() {
    const mine = ++seq;
    const listed = await client.ask('weather-criterion.list');
    if (destroyed || mine !== seq) return;
    if (!listed.ok) { fail(describeError(listed.error)); return; }
    criteria = listed.value;
    render();
  }

  function ruleRow(rule = { factor: 'windSpeedKt' }) {
    const factor = el('select', { attrs: { name: 'rule-factor', 'aria-label': 'Weather factor' } }, ...RULE_FACTORS.map((f) => el('option', { attrs: { value: f }, text: `${FACTOR_LABELS[f]}${FACTOR_UNITS[f] ? ` (${FACTOR_UNITS[f]})` : ''}` })));
    factor.value = rule.factor;
    const amber = el('input', { attrs: { name: 'rule-amber', autocomplete: 'off', 'aria-label': 'Amber at', size: 6 } });
    const red = el('input', { attrs: { name: 'rule-red', autocomplete: 'off', 'aria-label': 'Red at', size: 6 } });
    amber.value = listText(rule.amber ?? '');
    red.value = listText(rule.red ?? '');
    const hint = el('span', { class: 'hint rule-hint' });
    const showHint = () => {
      hint.textContent = factor.value === 'precipitation' ? `Types: ${PRECIPITATION_TYPES.filter((t) => t !== 'none').join(', ')}` : LOWER_WORSE.has(factor.value) ? 'at or below' : 'at or above';
    };
    factor.addEventListener('change', showHint);
    showHint();
    const row = el('li', { class: 'rule-row', dataset: { rule: '' } }, factor, el('label', { class: 'field' }, el('span', { text: 'Amber' }), amber), el('label', { class: 'field' }, el('span', { text: 'Red' }), red),
      el('button', { class: 'link danger', attrs: { type: 'button', 'aria-label': 'Remove this value' }, text: 'Remove', on: { click: () => row.remove() } }), hint);
    row.read = () => {
      const precip = factor.value === 'precipitation';
      const a = precip ? toTypes(amber.value) : toNumber(amber.value);
      const r = precip ? toTypes(red.value) : toNumber(red.value);
      return { factor: factor.value, ...(a === undefined ? {} : { amber: a }), ...(r === undefined ? {} : { red: r }) };
    };
    return row;
  }

  function openEditor(id) {
    const c = id ? criteria.find((x) => x.id === id) : null;
    editing = { id };
    const name = el('input', { attrs: { name: 'criterion-name', autocomplete: 'off', maxlength: 60, placeholder: 'e.g. Rotary-wing aviation' } });
    const group = el('input', { attrs: { name: 'criterion-group', autocomplete: 'off', maxlength: 40, placeholder: 'e.g. Aviation' } });
    name.value = c?.name ?? '';
    group.value = c?.group ?? '';
    const rules = el('ul', { class: 'rule-items' }, ...(c?.rules ?? [{ factor: 'windSpeedKt' }]).map(ruleRow));
    const errors = el('ul', { class: 'import-problems' });
    const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
    async function onSave() {
      const fields = { name: name.value, group: group.value, rules: [...rules.children].map((r) => r.read()) };
      const result = c
        ? await client.send('weather-criterion.update', { criterionId: c.id, expectedRevision: c.revision, ...fields })
        : await client.send('weather-criterion.create', fields);
      if (destroyed) return;
      if (!result.ok) { errors.replaceChildren(...(result.error.details?.problems ?? [{ field: '', reason: describeError(result.error) }]).map((p) => el('li', { text: p.field ? `${p.field}: ${p.reason}` : p.reason }))); return; }
      say(`Saved ${result.value.name}.`);
      closeEditor();
    }
    async function onDelete() {
      const result = await client.send('weather-criterion.delete', { criterionId: c.id, expectedRevision: c.revision });
      if (destroyed) return;
      if (result.ok) { say(`Deleted ${c.name}.`); closeEditor(); } else fail(describeError(result.error));
    }
    editor.replaceChildren(el('fieldset', { class: 'group', dataset: { criterionEditor: '' } }, el('legend', { text: c ? `Edit ${c.name}` : 'New critical values' }),
      c?.example ? el('p', { class: 'hint', text: 'Example values: check them against your references. Once edited they are your own.' }) : null,
      field('Operation or system', name), field('Group', group),
      rules,
      el('div', { class: 'actions' }, el('button', { class: 'link', attrs: { type: 'button' }, text: 'Add a value', on: { click: () => rules.append(ruleRow()) } })),
      errors,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', attrs: { type: 'button' }, text: 'Save', on: { click: onSave } }),
        el('button', { attrs: { type: 'button' }, text: 'Cancel', on: { click: closeEditor } }),
        c ? el('button', { class: 'danger', attrs: { type: 'button' }, text: 'Delete', on: { click: onDelete } }) : null)));
    render();
  }
  function closeEditor() { editing = null; editor.replaceChildren(); render(); }

  async function onExamples() {
    const result = await client.send('weather-criterion.add-examples', {});
    if (destroyed) return;
    if (result.ok) say(result.value.criteria.length ? `Added ${result.value.criteria.length} example critical values. Check them against your references.` : 'The example values are already there.');
    else fail(describeError(result.error));
  }

  const off = client.subscribe('weather-criterion.*', () => { load(); });
  return { ready: load(), refresh: load, destroy() { destroyed = true; off(); } };
}
