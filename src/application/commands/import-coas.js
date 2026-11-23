// coa.import: the documented import format (docs/IMPORT-FORMAT.md, docs/import/coa-import.schema.json).
//
//   { "format": "coa-builder/import", "version": 1, "source"?: "…",
//     "coas": [ { "name", "description"?, "frame"?, "units"?: [
//         { "sidc", "lat", "lng", "label"?, …modifiers (flat) } ],
//       "graphics"?: [ { "kind", "side"?, "color"?, "label"?, "points"? | "center"?, "radius"? } ] } ] }
//
// Everything is checked before anything is saved (all problems reported, by path). Imports always
// create new COAs with fresh ids. Other file formats are converted to this one by adapters.
import { defineMessage } from '../message-definition.js';
import { importCoa, checkCoaFields } from '../../domain/coa.js';
import { parseSymbolFields, MODIFIER_NAMES } from '../../domain/map-symbol.js';
import { parseNewGraphic } from '../../domain/graphic.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';
import { isObject } from '../../shared/values.js';

export const IMPORT_FORMAT = 'coa-builder/import';
export const IMPORT_VERSION = 1;
export const MAX_COAS = 100;
export const MAX_UNITS = 1000;
export const MAX_GRAPHICS = 500;

const TOP_KEYS = ['format', 'version', 'source', 'coas'];
const COA_KEYS = ['name', 'description', 'frame', 'units', 'graphics'];
const GRAPHIC_KEYS = ['kind', 'side', 'color', 'label', 'points', 'center', 'radius', 'minRadius', 'bearing', 'arc'];
const UNIT_KEYS = ['sidc', 'lat', 'lng', 'label', ...MODIFIER_NAMES];
const unknownKeys = (obj, allowed, at) => Object.keys(obj).filter((k) => !allowed.includes(k)).map((k) => ({ field: `${at}${k}`, reason: 'unknown field' }));

/** Domain field names → import document field names. */
function unitField(field) {
  if (field === 'position' || field === 'position.lat') return 'lat';
  if (field === 'position.lng') return 'lng';
  if (field.startsWith('modifiers.')) return field.slice('modifiers.'.length);
  return field;
}

/** @returns {{ problems: object[], symbol?: object }} */
function readUnit(raw, at, symbolRenderer) {
  if (!isObject(raw)) return { problems: [{ field: at.slice(0, -1), reason: 'must be an object' }] };
  const problems = unknownKeys(raw, UNIT_KEYS, at);
  if (!('sidc' in raw)) problems.push({ field: `${at}sidc`, reason: 'is required' });
  const modifiers = Object.fromEntries(MODIFIER_NAMES.filter((m) => m in raw).map((m) => [m, raw[m]]));
  const parsed = parseSymbolFields({
    ...('sidc' in raw ? { sidc: raw.sidc } : {}),
    position: { lat: raw.lat, lng: raw.lng },
    label: raw.label ?? '',
    modifiers,
  });
  problems.push(...parsed.problems.map((p) => ({ field: `${at}${unitField(p.field)}`, reason: p.reason })));
  if (problems.length) return { problems };
  const rendered = symbolRenderer.render(parsed.value.sidc, {});
  if (!rendered.valid) return { problems: [{ field: `${at}sidc`, reason: `is not a recognised symbol (${rendered.warnings.join('; ')})` }] };
  return { problems: [], symbol: parsed.value };
}

/** @returns {{ problems: object[], graphic?: object }} */
function readGraphic(raw, at) {
  if (!isObject(raw)) return { problems: [{ field: at.slice(0, -1), reason: 'must be an object' }] };
  const unknown = unknownKeys(raw, GRAPHIC_KEYS, at);
  const parsed = parseNewGraphic(raw);
  const problems = [...unknown, ...parsed.problems.filter((p) => !unknown.some((u) => u.field === `${at}${p.field}`)).map((p) => ({ field: `${at}${p.field}`, reason: p.reason }))];
  return problems.length ? { problems } : { problems: [], graphic: parsed.value };
}

/** @returns {{ problems: object[], coas: object[] }} parsed COAs (symbols and graphics without ids) */
function readDocument(doc, symbolRenderer) {
  if (!isObject(doc)) return { problems: [{ field: 'document', reason: `must be a ${IMPORT_FORMAT} object` }], coas: [] };
  const problems = unknownKeys(doc, TOP_KEYS, '');
  if (doc.format !== IMPORT_FORMAT) problems.push({ field: 'format', reason: `must be "${IMPORT_FORMAT}"` });
  if (!Number.isInteger(doc.version) || doc.version < 1) problems.push({ field: 'version', reason: `must be an integer (current: ${IMPORT_VERSION})` });
  if ('source' in doc && (typeof doc.source !== 'string' || doc.source.length > 200)) problems.push({ field: 'source', reason: 'must be text of at most 200 characters' });
  if (!Array.isArray(doc.coas) || doc.coas.length === 0 || doc.coas.length > MAX_COAS) {
    problems.push({ field: 'coas', reason: `must list 1 to ${MAX_COAS} COAs` });
    return { problems, coas: [] };
  }

  const coas = doc.coas.map((raw, i) => {
    const at = `coas[${i}].`;
    if (!isObject(raw)) { problems.push({ field: `coas[${i}]`, reason: 'must be an object' }); return null; }
    problems.push(...unknownKeys(raw, COA_KEYS, at));
    const fields = { name: raw.name, ...('description' in raw ? { description: raw.description } : {}), ...('frame' in raw ? { frame: raw.frame } : {}) };
    problems.push(...checkCoaFields(fields).map((p) => ({ field: `${at}${p.field}`, reason: p.reason })));
    const units = raw.units ?? [];
    if (!Array.isArray(units) || units.length > MAX_UNITS) {
      problems.push({ field: `${at}units`, reason: `must be a list of at most ${MAX_UNITS} units` });
      return null;
    }
    const symbols = units.map((u, j) => {
      const read = readUnit(u, `${at}units[${j}].`, symbolRenderer);
      problems.push(...read.problems);
      return read.symbol;
    });
    const rawGraphics = raw.graphics ?? [];
    if (!Array.isArray(rawGraphics) || rawGraphics.length > MAX_GRAPHICS) {
      problems.push({ field: `${at}graphics`, reason: `must be a list of at most ${MAX_GRAPHICS} lines, areas and range rings` });
      return null;
    }
    const graphics = rawGraphics.map((g, j) => {
      const read = readGraphic(g, `${at}graphics[${j}].`);
      problems.push(...read.problems);
      return read.graphic;
    });
    return { ...fields, symbols, graphics };
  });
  return { problems, coas };
}

/** coa.import { document } → ok({ coas }); emits coa.imported per COA. */
export const importCoas = defineMessage({
  kind: 'command', type: 'coa.import', v: 1,
  required: ['document'],
  async handle({ payload: { document: doc }, ctx, ports: { coaStore, clock, ids, symbolRenderer } }) {
    if (isObject(doc) && doc.format === IMPORT_FORMAT && Number.isInteger(doc.version) && doc.version > IMPORT_VERSION) {
      return err(ErrorCode.UNSUPPORTED_VERSION, `Import format version ${doc.version} is newer than this app supports`, {
        found: doc.version, supported: [IMPORT_VERSION],
      });
    }
    const read = readDocument(doc, symbolRenderer);
    if (read.problems.length) return err(ErrorCode.IMPORT_INVALID, 'The import document has problems', { problems: read.problems });

    const now = clock.now();
    const imported = [];
    for (const parsed of read.coas) {
      const built = importCoa({
        ...parsed, id: ids.next('coa'), symbols: parsed.symbols.map((s) => ({ id: ids.next('sym'), ...s })),
        graphics: parsed.graphics.map((g) => ({ id: ids.next('gfx'), ...g })),
      }, { now });
      if (!built.ok) return built; // cannot happen after readDocument, kept as the domain's own guard
      const saved = await coaStore.save(built.value.coa, { expectedRevision: 0 });
      if (!saved.ok) return saved; // COAs saved before a storage failure remain
      built.value.events.forEach((e) => ctx.emit(e));
      imported.push(built.value.coa);
    }
    return ok({ coas: imported });
  },
});
