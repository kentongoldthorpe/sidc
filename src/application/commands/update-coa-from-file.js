// Updating a COA from a file, by name (Epic 6 E6-3, D44).
//
//   coa.diff { coaId, document, mode?, basedOn? }            query: what the file would change (the preview)
//   coa.update-from-file { coaId, expectedRevision, document, mode?, basedOn?, acceptVersionMismatch?, transfer? }
//                                                           command: apply it, as one new revision with a transfer record
//
// `document` is the import format (docs/IMPORT-FORMAT.md), as CSV, GeoJSON and JSON files are read
// into it. Its units and graphics may also have `action` (add | change | remove; unset: add or
// change) and `newLabel` (a rename), and give only the fields that change (docs/CHANGE-SHEETS.md).
// `basedOn` is the version fingerprint the file was made from (the payload's, else the file
// header's); when the COA has moved on since, applying needs acceptVersionMismatch: true.
import { defineMessage, checkId, checkRevision, validationFailed, staleRevision } from '../message-definition.js';
import { coaFingerprint, readFingerprint, planChanges, applyPlan, parseTransfer, UPDATE_ACTIONS, UPDATE_MODES } from '../../domain/coa-changes.js';
import { parseSymbolFields, MODIFIER_NAMES } from '../../domain/map-symbol.js';
import { UNIT_EXTRAS } from '../../domain/weapon.js';
import { mgrsAgrees, parseMgrs } from '../../domain/mgrs.js';
import { mutateCoa } from './mutate-coa.js';
import { IMPORT_FORMAT, IMPORT_VERSION } from './import-coas.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { isObject } from '../../shared/values.js';

const EXTRA_KEYS = Object.keys(UNIT_EXTRAS);
const UNIT_KEYS = ['sidc', 'lat', 'lng', 'mgrs', 'label', 'action', 'newLabel', ...MODIFIER_NAMES, ...EXTRA_KEYS];
const GRAPHIC_FIELDS = ['kind', 'side', 'color', 'annotation', 'points', 'center', 'radius', 'minRadius', 'bearing', 'arc'];
const GRAPHIC_KEYS = ['label', 'action', 'newLabel', ...GRAPHIC_FIELDS];
const unknownKeys = (obj, allowed, at) => Object.keys(obj).filter((k) => !allowed.includes(k)).map((k) => ({ field: `${at}.${k}`, reason: 'unknown field' }));
/** Domain field names → the file's. */
const unitField = (f) => (f === 'position' || f === 'position.lat' ? 'lat' : f === 'position.lng' ? 'lng' : f === 'position.mgrs' ? 'mgrs' : f.startsWith('modifiers.') ? f.slice(10) : f);

function readCommon(raw, at, problems) {
  if ('action' in raw && !UPDATE_ACTIONS.includes(raw.action)) problems.push({ field: `${at}.action`, reason: `must be one of ${UPDATE_ACTIONS.join(', ')} (or empty: add or change)` });
  if ('newLabel' in raw && (typeof raw.newLabel !== 'string' || raw.newLabel.trim().length > 40)) problems.push({ field: `${at}.newLabel`, reason: 'must be text of at most 40 characters' });
  if ('label' in raw && typeof raw.label !== 'string') problems.push({ field: `${at}.label`, reason: 'must be text (the item\'s name)' });
  return { at, ...('action' in raw ? { action: raw.action } : {}), name: typeof raw.label === 'string' ? raw.label.trim() : '', ...('newLabel' in raw && typeof raw.newLabel === 'string' ? { newName: raw.newLabel.trim() } : {}) };
}

function readUnitEntry(raw, at, symbolRenderer, problems) {
  if (!isObject(raw)) { problems.push({ field: at, reason: 'must be an object' }); return null; }
  problems.push(...unknownKeys(raw, UNIT_KEYS, at));
  const entry = readCommon(raw, at, problems);
  const given = {};
  if ('sidc' in raw) given.sidc = raw.sidc;
  const hasLatLng = 'lat' in raw || 'lng' in raw;
  const hasMgrs = typeof raw.mgrs === 'string' && raw.mgrs.trim() !== '';
  if (hasLatLng && hasMgrs && Number.isFinite(raw.lat) && Number.isFinite(raw.lng)) {
    const agree = mgrsAgrees({ lat: raw.lat, lng: raw.lng }, raw.mgrs);
    if (agree === false) problems.push({ field: `${at}.mgrs`, reason: `does not match lat ${raw.lat}, lng ${raw.lng} (they are in different places; check both)` });
    if (agree === null) problems.push({ field: `${at}.mgrs`, reason: parseMgrs(raw.mgrs).problems[0].reason });
  }
  if (hasLatLng) given.position = { lat: raw.lat, lng: raw.lng };
  else if (hasMgrs) given.position = { mgrs: raw.mgrs };
  const modifiers = Object.fromEntries(MODIFIER_NAMES.filter((m) => m in raw).map((m) => [m, raw[m]]));
  if (Object.keys(modifiers).length) given.modifiers = modifiers;
  for (const k of EXTRA_KEYS) if (k in raw) given[k] = raw[k];
  const parsed = parseSymbolFields(given);
  problems.push(...parsed.problems.map((p) => ({ field: `${at}.${unitField(p.field)}`, reason: p.reason })));
  if (parsed.problems.length) return null;
  if (given.sidc !== undefined && !symbolRenderer.render(parsed.value.sidc, {}).valid) { problems.push({ field: `${at}.sidc`, reason: 'is not a recognised symbol' }); return null; }
  const fields = { ...parsed.value };
  if (given.modifiers) fields.modifiers = Object.fromEntries(Object.keys(modifiers).map((m) => [m, parsed.value.modifiers[m]]).filter(([, v]) => v !== undefined));
  return { ...entry, fields };
}

function readLineEntry(raw, at, problems) {
  if (!isObject(raw)) { problems.push({ field: at, reason: 'must be an object' }); return null; }
  problems.push(...unknownKeys(raw, GRAPHIC_KEYS, at));
  const entry = readCommon(raw, at, problems);
  return { ...entry, fields: Object.fromEntries(GRAPHIC_FIELDS.filter((k) => k in raw).map((k) => [k, raw[k]])) };
}

/**
 * The entries of an update file for one COA. A file with several COAs must have one named like it.
 * @returns {{ problems: object[], units?: object[], lines?: object[], covers?: object, basedOn?: string|null }}
 */
export function readUpdateDocument(doc, coa, symbolRenderer) {
  const problems = [];
  if (!isObject(doc) || doc.format !== IMPORT_FORMAT) return { problems: [{ field: 'document', reason: `must be a ${IMPORT_FORMAT} document (a CSV, GeoJSON or JSON file read for import)` }] };
  if (!Array.isArray(doc.coas) || doc.coas.length === 0) return { problems: [{ field: 'coas', reason: 'must list the COA to update' }] };
  let index = 0;
  if (doc.coas.length > 1) {
    index = doc.coas.findIndex((c) => isObject(c) && typeof c.name === 'string' && c.name.trim().toLowerCase() === coa.name.toLowerCase());
    if (index < 0) return { problems: [{ field: 'coas', reason: `the file has ${doc.coas.length} COAs and none is named "${coa.name}"` }] };
  }
  const raw = doc.coas[index];
  if (!isObject(raw)) return { problems: [{ field: `coas[${index}]`, reason: 'must be an object' }] };
  const at = `coas[${index}]`;
  const units = (Array.isArray(raw.units) ? raw.units : []).map((u, i) => readUnitEntry(u, `${at}.units[${i}]`, symbolRenderer, problems)).filter(Boolean);
  const lines = (Array.isArray(raw.graphics) ? raw.graphics : []).map((g, i) => readLineEntry(g, `${at}.graphics[${i}]`, problems)).filter(Boolean);
  const versions = Array.isArray(doc.header?.versions) ? doc.header.versions : [];
  const stated = versions.length === 1 ? versions[0] : versions.find((v) => typeof v?.coa === 'string' && v.coa.trim().toLowerCase() === (raw.name ?? '').trim().toLowerCase());
  return { problems, units, lines, covers: { units: Array.isArray(raw.units), lines: Array.isArray(raw.graphics) }, basedOn: readFingerprint(stated?.fingerprint ?? '') };
}

/** The plan for a payload, or an error reply. */
async function prepare({ coaId, document: doc, mode = 'merge', basedOn }, { coaStore, symbolRenderer, clock }) {
  const problems = [
    ...checkId('coaId', coaId),
    ...(UPDATE_MODES.includes(mode) ? [] : [{ field: 'mode', reason: `must be one of ${UPDATE_MODES.join(', ')}` }]),
    ...(basedOn === undefined || basedOn === null || readFingerprint(basedOn) ? [] : [{ field: 'basedOn', reason: 'must be a version fingerprint like K7Q3-MD2A' }]),
  ];
  if (problems.length) return { reply: validationFailed('Invalid update payload', problems) };
  if (isObject(doc) && doc.format === IMPORT_FORMAT && Number.isInteger(doc.version) && doc.version > IMPORT_VERSION) {
    return { reply: err(ErrorCode.UNSUPPORTED_VERSION, `Import format version ${doc.version} is newer than this app supports`, { found: doc.version, supported: [IMPORT_VERSION] }) };
  }
  const loaded = await coaStore.get(coaId);
  if (!loaded.ok) return { reply: loaded };
  const coa = loaded.value;
  const read = readUpdateDocument(doc, coa, symbolRenderer);
  if (read.problems.length) return { reply: err(ErrorCode.IMPORT_INVALID, 'The file has problems', { problems: read.problems }) };
  let n = 0;
  const plan = planChanges(coa, read, { mode, covers: read.covers, now: clock.now(), newId: (prefix) => `${prefix}-preview-${++n}` });
  // The domain names an item's name "name"; in the file it is its label.
  if (plan.problems.length) return { reply: err(ErrorCode.IMPORT_INVALID, 'The file has problems', { problems: plan.problems.map((p) => ({ ...p, field: p.field.replace(/\.name$/, '.label') })) }) };
  const stated = basedOn ? readFingerprint(basedOn) : read.basedOn;
  const current = coaFingerprint(coa);
  return { coa, read, plan, mode, basedOn: stated, current, versionMatches: stated ? stated === current : null };
}

const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const summary = (p) => ({
  coaId: p.coa.id, name: p.coa.name, revision: p.coa.revision, fingerprint: p.current, basedOn: p.basedOn, versionMatches: p.versionMatches, mode: p.mode,
  changes: p.plan.changes.map((c) => plain(c)), unchanged: p.plan.unchanged, kept: p.plan.kept,
});

export const diffCoa = defineMessage({
  kind: 'query', type: 'coa.diff', v: 1, required: ['coaId', 'document'], optional: ['mode', 'basedOn'],
  async handle({ payload, ports }) {
    const p = await prepare(payload, ports);
    return p.reply ?? ok(summary(p));
  },
});

export const updateCoaFromFile = defineMessage({
  kind: 'command', type: 'coa.update-from-file', v: 1,
  required: ['coaId', 'expectedRevision', 'document'], optional: ['mode', 'basedOn', 'acceptVersionMismatch', 'transfer'],
  async handle({ payload, ctx, ports }) {
    const { coaId, expectedRevision, acceptVersionMismatch = false, transfer } = payload;
    const t = parseTransfer(transfer);
    const problems = [...checkRevision('expectedRevision', expectedRevision), ...t.problems,
      ...(typeof acceptVersionMismatch === 'boolean' ? [] : [{ field: 'acceptVersionMismatch', reason: 'must be true or false' }])];
    if (problems.length) return validationFailed('Invalid coa.update-from-file payload', problems);
    const p = await prepare(payload, ports);
    if (p.reply) return p.reply;
    // A stale preview first: what the user saw is not the COA as it is now.
    if (p.coa.revision !== expectedRevision) return staleRevision(coaId, expectedRevision, p.coa.revision);
    if (p.versionMatches === false && !acceptVersionMismatch) {
      return err(ErrorCode.VERSION_MISMATCH, `The file was made from version ${p.basedOn}; ${p.coa.name} is now at version ${p.current}`, { basedOn: p.basedOn, current: p.current });
    }
    const result = await mutateCoa({
      coaStore: ports.coaStore, ctx, coaId, expectedRevision,
      // Planned again on the COA as saved (with real ids); the revision check makes it the one previewed.
      change: (coa) => applyPlan(coa, planChanges(coa, p.read, { mode: p.mode, covers: p.read.covers, now: ports.clock.now(), newId: (prefix) => ports.ids.next(prefix) }), { transfer: t.value, basedOn: p.basedOn, now: ports.clock.now() }),
    });
    return result.ok ? ok({ coa: result.value.coa, transfer: result.value.events.length ? result.value.coa.transfers.at(-1) : null }) : result;
  },
});

export const UPDATE_MESSAGES = Object.freeze([diffCoa, updateCoaFromFile]);
