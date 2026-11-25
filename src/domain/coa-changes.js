// Version fingerprints and updates by name (Epic 6 E6-3, D44).
//
//   coaFingerprint(coa)    → "K7Q3-MD2A": a short code from the COA's content (name, description,
//                            units, lines and areas), the same whatever the order or ids, different
//                            after any change. Printed on paper and in files, it ties a copy to the
//                            exact version it came from.
//   planChanges(coa, incoming, options) → what a file would change, item by item, matched by name
//   applyPlan(coa, plan, { transfer, now }) → the updated COA (one new revision) and its event
//
// A file's items are matched to the COA's by name (a unit's label, a line's label), ignoring case.
// Each item's `action` is add, change, remove, or (unset) add-or-change. Only the fields an item
// gives are changed. With mode 'replace', named items of a kind the file covers that the file does
// not list are removed; items without a name are never removed (they cannot be matched).
import { addSymbol, updateSymbol, moveSymbol, removeSymbol, addGraphic, updateGraphic, removeGraphic } from './coa.js';
import { distance } from './geodesy.js';
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { isObject } from '../shared/values.js';
import { deepFreeze } from '../shared/freeze.js';

// ---- fingerprint ----

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base 32: no I, L, O or U to misread
const MASK64 = (1n << 64n) - 1n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

/** JSON with sorted keys and numbers to 7 decimals (≈1 cm), so equal content gives equal text. */
function canonical(value) {
  if (typeof value === 'number') return String(Math.round(value * 1e7) / 1e7);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

function fnv1a64(text) {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) { h ^= BigInt(text.charCodeAt(i)); h = (h * FNV_PRIME) & MASK64; }
  return h;
}

/** The version fingerprint of a COA's content, e.g. "K7Q3-MD2A" (40 bits). */
export function coaFingerprint(coa) {
  const item = ({ id, link, ...rest }) => canonical(rest); // ids and template links are not content on paper
  const units = coa.symbols.map(item).sort();
  const lines = coa.graphics.map(item).sort();
  const text = `${canonical({ name: coa.name, description: coa.description ?? '' })}|${units.join('\n')}|${lines.join('\n')}`;
  let h = fnv1a64(text) >> 24n; // the top 40 bits
  let code = '';
  for (let i = 0; i < 8; i++) { code = ALPHABET[Number(h & 31n)] + code; h >>= 5n; }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** A fingerprint as typed from paper ("k7q3md2a", "K7Q3 MD2A", O for 0, I or L for 1), or null. */
export function readFingerprint(text) {
  if (typeof text !== 'string') return null;
  const t = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(t)) return null;
  return `${t.slice(0, 4)}-${t.slice(4)}`;
}

// ---- change plans ----

export const UPDATE_ACTIONS = Object.freeze(['add', 'change', 'remove']);
export const UPDATE_MODES = Object.freeze(['merge', 'replace']);
const BIG_MOVE_M = 5000; // a move this far is flagged for checking (a transposed grid digit, often)
const key = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');
const KIND_WORD = Object.freeze({ unit: 'unit', line: 'line or area' });

/**
 * What a file would do to a COA.
 * @param {object} coa
 * @param {{ units?: object[], lines?: object[] }} incoming entries { at, action?, name?, newName?, fields }:
 *   units' fields: sidc, position, modifiers (only those given), facing, hvt, weapons, details;
 *   lines' fields: kind, side, color, annotation, points, center, radius, minRadius, bearing, arc
 * @param {{ mode?: 'merge'|'replace', covers?: { units: boolean, lines: boolean }, newId: (prefix: string) => string, now: string }} options
 *   covers: the kinds the file holds (a CSV holds units only); replace never touches the others
 * @returns {{ problems: object[], changes: object[], unchanged: number, kept: number, result: object }}
 */
export function planChanges(coa, { units = [], lines = [] }, { mode = 'merge', covers = { units: true, lines: true }, newId, now }) {
  const problems = [];
  const changes = [];
  let unchanged = 0;
  let working = coa;
  const run = (kind, entries) => {
    const listOf = () => (kind === 'unit' ? working.symbols : working.graphics);
    const byName = new Map();
    for (const item of listOf()) if (key(item.label)) byName.set(key(item.label), [...(byName.get(key(item.label)) ?? []), item.id]);
    const seen = new Set();
    const step = (at, result, mapField = (f) => f) => {
      if (result.ok) { working = result.value.coa; return result.value.events; }
      for (const p of result.error.details?.problems ?? [{ field: '', reason: result.error.message }]) problems.push({ field: `${at}${p.field ? `.${mapField(p.field)}` : ''}`, reason: p.reason });
      return null;
    };
    for (const entry of entries) {
      const { at, name, newName, fields = {} } = entry;
      const action = entry.action ?? null;
      const k = key(name);
      if (k && seen.has(k)) { problems.push({ field: `${at}.name`, reason: `"${name}" is listed twice in the file` }); continue; }
      if (k) seen.add(k);
      const ids = k ? byName.get(k) ?? [] : [];
      if (ids.length > 1) { problems.push({ field: `${at}.name`, reason: `${ids.length} ${KIND_WORD[kind]}s are named "${name}" in the COA: give them different names first` }); continue; }
      const id = ids[0];
      if (!k && (action === 'change' || action === 'remove')) { problems.push({ field: `${at}.name`, reason: `is needed to ${action} a ${KIND_WORD[kind]}` }); continue; }
      if (action === 'add' && id) { problems.push({ field: `${at}.name`, reason: `"${name}" is already in the COA (use change)` }); continue; }
      if ((action === 'change' || action === 'remove') && !id) { problems.push({ field: `${at}.name`, reason: `"${name}" is not in the COA` }); continue; }
      const label = newName ?? name ?? '';
      if (action === 'remove') {
        const before = listOf().find((x) => x.id === id);
        if (step(at, kind === 'unit' ? removeSymbol(working, { symbolId: id }, { now }) : removeGraphic(working, { graphicId: id }, { now }))) {
          changes.push({ kind, name: before.label, action: 'remove', before });
        }
        continue;
      }
      if (!id) { // add
        if (kind === 'unit') {
          const missing = ['sidc', 'position'].filter((f) => !(f in fields));
          if (missing.length) { missing.forEach((f) => problems.push({ field: `${at}.${f}`, reason: 'is required to add a unit' })); continue; }
          if (step(at, addSymbol(working, { symbolId: newId('sym'), ...fields, label }, { now }))) changes.push({ kind, name: label, action: 'add', after: working.symbols.at(-1) });
        } else if (step(at, addGraphic(working, { graphicId: newId('gfx'), ...fields, label }, { now }))) {
          changes.push({ kind, name: label, action: 'add', after: working.graphics.at(-1) });
        }
        continue;
      }
      // change
      const before = listOf().find((x) => x.id === id);
      const changed = [];
      let failed = false;
      if (kind === 'unit') {
        const { position, modifiers, ...rest } = fields;
        if (position !== undefined) {
          const events = step(at, moveSymbol(working, { symbolId: id, position }, { now }));
          if (events === null) failed = true; else if (events.length) changed.push('position');
        }
        const update = { ...rest, ...(modifiers ? { modifiers: { ...before.modifiers, ...modifiers } } : {}), ...(newName !== undefined ? { label: newName } : {}) };
        if (!failed && Object.keys(update).length) {
          const events = step(at, updateSymbol(working, { symbolId: id, ...update }, { now }));
          if (events === null) failed = true; else changed.push(...(events[0]?.payload.changed ?? []));
        }
      } else {
        const update = { ...fields, ...(newName !== undefined ? { label: newName } : {}) };
        if (Object.keys(update).length) {
          const events = step(at, updateGraphic(working, { graphicId: id, ...update }, { now }));
          if (events === null) failed = true; else changed.push(...(events[0]?.payload.changed ?? []));
        }
      }
      if (failed) continue;
      if (!changed.length) { unchanged += 1; continue; }
      const after = listOf().find((x) => x.id === id);
      const record = { kind, name: before.label, action: 'change', fields: changed, before, after };
      if (changed.includes('label')) record.newName = after.label;
      if (kind === 'unit' && changed.includes('position')) {
        record.movedMetres = Math.round(distance(before.position, after.position));
        if (record.movedMetres >= BIG_MOVE_M) record.check = `moved ${(record.movedMetres / 1000).toFixed(1)} km: check the grid`;
      }
      changes.push(record);
    }
    // Replace: named items of this kind that the file does not list go.
    if (mode === 'replace' && covers[kind === 'unit' ? 'units' : 'lines']) {
      for (const item of [...listOf()]) {
        if (!key(item.label) || seen.has(key(item.label))) continue;
        if (step(`${kind === 'unit' ? 'units' : 'lines'}`, kind === 'unit' ? removeSymbol(working, { symbolId: item.id }, { now }) : removeGraphic(working, { graphicId: item.id }, { now }))) {
          changes.push({ kind, name: item.label, action: 'remove', before: item, notInFile: true });
        }
      }
    }
  };
  run('unit', units);
  run('line', lines);
  const kept = mode === 'replace'
    ? (covers.units ? working.symbols.filter((s) => !key(s.label)).length : 0) + (covers.lines ? working.graphics.filter((g) => !key(g.label)).length : 0)
    : 0;
  return { problems, changes, unchanged, kept, result: working };
}

// ---- applying, with a record of the transfer ----

export const TRANSFER_TEXT_MAX = 120;
export const MAX_TRANSFERS = 50;
const TRANSFER_FIELDS = Object.freeze(['file', 'enteredBy', 'checkedBy']);

/** The optional words of a transfer record: { file?, enteredBy?, checkedBy? }, each ≤ 120 characters. */
export function parseTransfer(raw, at = 'transfer') {
  if (raw === undefined || raw === null) return { problems: [], value: {} };
  if (!isObject(raw)) return { problems: [{ field: at, reason: 'must be an object { file?, enteredBy?, checkedBy? }' }] };
  const problems = Object.keys(raw).filter((k) => !TRANSFER_FIELDS.includes(k)).map((k) => ({ field: `${at}.${k}`, reason: 'unknown field' }));
  const value = {};
  for (const f of TRANSFER_FIELDS) {
    if (raw[f] === undefined || raw[f] === '') continue;
    if (typeof raw[f] !== 'string' || raw[f].trim().length > TRANSFER_TEXT_MAX) problems.push({ field: `${at}.${f}`, reason: `must be text of at most ${TRANSFER_TEXT_MAX} characters` });
    else if (raw[f].trim()) value[f] = raw[f].trim();
  }
  return { problems, value };
}

/** A COA's transfer records, as stored (for storage and the project file). */
export function readTransfers(raw, at = 'transfers') {
  if (raw === undefined) return { problems: [], value: undefined };
  if (!Array.isArray(raw) || raw.length > MAX_TRANSFERS) return { problems: [{ field: at, reason: `must be a list of at most ${MAX_TRANSFERS} transfer records` }] };
  const problems = [];
  const value = raw.map((t, i) => {
    const where = `${at}[${i}]`;
    if (!isObject(t) || typeof t.at !== 'string' || typeof t.to !== 'string') { problems.push({ field: where, reason: 'must be a transfer record { at, from, to, … }' }); return null; }
    return { ...t };
  });
  return problems.length ? { problems } : { problems: [], value };
}

const counts = (changes) => ({
  added: changes.filter((c) => c.action === 'add').length,
  changed: changes.filter((c) => c.action === 'change').length,
  removed: changes.filter((c) => c.action === 'remove').length,
});

/**
 * The COA after a plan: one new revision, and a transfer record (when, file, version before and
 * after, counts, who entered and checked it). Publishes coa.changes-applied.
 * @param {{ transfer?: object, basedOn?: string|null, now: string }} context
 */
export function applyPlan(coa, plan, { transfer = {}, basedOn = null, now }) {
  if (plan.problems.length) return err(ErrorCode.IMPORT_INVALID, 'The file has problems', { problems: plan.problems });
  if (plan.changes.length === 0) return ok({ coa, events: [], record: null });
  const before = coaFingerprint(coa);
  const content = { symbols: plan.result.symbols, graphics: plan.result.graphics, ...(plan.result.source ? { source: plan.result.source } : {}) };
  const draft = { ...coa, ...content };
  const record = { at: now, ...transfer, ...(basedOn ? { basedOn } : {}), from: before, to: coaFingerprint(draft), ...counts(plan.changes) };
  const updated = deepFreeze({ ...draft, revision: coa.revision + 1, updatedAt: now, transfers: [...(coa.transfers ?? []), record].slice(-MAX_TRANSFERS) });
  return ok({ coa: updated, record, events: [{ type: 'coa.changes-applied', v: 1, payload: { coa: updated, transfer: record } }] });
}
