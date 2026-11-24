// Projects (D27, M10-2): project.list / project.get / project.export queries and project.create,
// project.rename, project.delete and project.import commands. Projects are stored in the shared
// "projects" collection; each project's own documents are in collections scoped to it. The app runs
// inside one project, chosen when it is created (ports.projectId); switching means a new app.
import { defineMessage, checkRevision, validationFailed, checkSidcKnown } from '../message-definition.js';
import {
  DEFAULT_PROJECT, DEFAULT_PROJECT_ID, PROJECT_COLLECTIONS, PROJECT_FORMAT, PROJECT_FORMAT_VERSION,
  createProject as create, renameProject, readProject, projectIdFrom, isProjectId, checkProjectName, scopedCollection,
} from '../../domain/project.js';
import { parseCoaContent, restoreCoa } from '../../domain/coa.js';
import { readSystem } from '../../domain/system.js';
import { readThreatModel } from '../../domain/threat-model.js';
import { DEFAULT_SETTINGS, checkSettingsChange } from '../../domain/settings.js';
import { isObject } from '../../shared/values.js';
import { ok, err } from '../../shared/result.js';
import { ErrorCode } from '../../shared/errors.js';

const PROJECTS = 'projects';
const systemsById = (systems) => new Map(systems.map((s) => [s.id, s]));
const notFound = (projectId) => err(ErrorCode.NOT_FOUND, `Project ${projectId} not found`, { projectId });
const checkProjectId = (value) => (isProjectId(value) ? [] : [{ field: 'projectId', reason: 'must be a project id' }]);

/** Every stored project plus the Default one (which exists before it is stored). */
async function allProjects(documents) {
  const listed = await documents.list(PROJECTS);
  if (!listed.ok) return listed;
  const stored = listed.value.map(readProject).filter(Boolean);
  const others = stored.filter((p) => p.id !== DEFAULT_PROJECT_ID).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  return ok([stored.find((p) => p.id === DEFAULT_PROJECT_ID) ?? DEFAULT_PROJECT, ...others]);
}

async function loadProject(documents, projectId) {
  const got = await documents.get(PROJECTS, projectId);
  if (got.ok) {
    const project = readProject(got.value);
    return project ? ok(project) : err(ErrorCode.STORAGE_UNAVAILABLE, `The stored project ${projectId} is not valid`, { projectId });
  }
  if (got.error.code !== ErrorCode.NOT_FOUND) return got;
  return projectId === DEFAULT_PROJECT_ID ? ok(DEFAULT_PROJECT) : notFound(projectId);
}

function asProjectError(result, projectId) {
  const { code, message, details } = result.error;
  if (code === ErrorCode.CONFLICT) return err(code, 'This project was changed elsewhere; reload and try again', { projectId, expectedRevision: details.expectedRevision, actualRevision: details.actualRevision });
  if (code === ErrorCode.NOT_FOUND) return notFound(projectId);
  return err(code, message, details);
}

/** project.list {} → ok([{ id, name, revision, updatedAt, current }]): Default first, then by name. */
export const listProjects = defineMessage({
  kind: 'query', type: 'project.list', v: 1,
  async handle({ ports: { allDocuments, projectId } }) {
    const all = await allProjects(allDocuments);
    if (!all.ok) return all;
    return ok(all.value.map(({ id, name, revision, updatedAt }) => ({ id, name, revision, updatedAt, current: id === projectId })));
  },
});

/** project.get { projectId? } → ok(Project), the open project when projectId is left out. */
export const getProject = defineMessage({
  kind: 'query', type: 'project.get', v: 1, optional: ['projectId'],
  async handle({ payload: { projectId: wanted }, ports: { allDocuments, projectId } }) {
    const id = wanted ?? projectId;
    const problems = checkProjectId(id);
    if (problems.length) return validationFailed('Invalid project.get payload', problems);
    return loadProject(allDocuments, id);
  },
});

async function newProjectId(documents, ids) {
  const all = await allProjects(documents);
  if (!all.ok) return all;
  return ok(projectIdFrom(ids.next('p'), new Set(all.value.map((p) => p.id))));
}

/** project.create { name } → ok(Project); emits project.created { project }. The app stays in its project. */
export const createProject = defineMessage({
  kind: 'command', type: 'project.create', v: 1, required: ['name'],
  async handle({ payload: { name }, ctx, ports: { allDocuments, ids, clock } }) {
    const problems = checkProjectName(name);
    if (problems.length) return validationFailed('Invalid project.create payload', problems);
    const id = await newProjectId(allDocuments, ids);
    if (!id.ok) return id;
    const created = create({ id: id.value, name }, { now: clock.now() });
    if (!created.ok) return created;
    const saved = await allDocuments.save(PROJECTS, created.value.project, { expectedRevision: 0 });
    if (!saved.ok) return asProjectError(saved, id.value);
    created.value.events.forEach((e) => ctx.emit(e));
    return ok(created.value.project);
  },
});

/** project.rename { projectId, expectedRevision, name } → ok(Project); emits project.renamed. Default starts at revision 0. */
export const renameProjectMessage = defineMessage({
  kind: 'command', type: 'project.rename', v: 1, required: ['projectId', 'expectedRevision', 'name'],
  async handle({ payload: { projectId, expectedRevision, name }, ctx, ports: { allDocuments, clock } }) {
    const problems = [
      ...checkProjectId(projectId),
      ...(Number.isInteger(expectedRevision) && expectedRevision >= 0 ? [] : [{ field: 'expectedRevision', reason: 'must be an integer ≥ 0' }]),
      ...checkProjectName(name),
    ];
    if (problems.length) return validationFailed('Invalid project.rename payload', problems);
    const loaded = await loadProject(allDocuments, projectId);
    if (!loaded.ok) return loaded;
    if (loaded.value.revision !== expectedRevision) {
      return err(ErrorCode.CONFLICT, 'This project was changed elsewhere; reload and try again', { projectId, expectedRevision, actualRevision: loaded.value.revision });
    }
    const renamed = renameProject(loaded.value, { name }, { now: clock.now() });
    if (!renamed.ok) return renamed;
    if (renamed.value.events.length === 0) return ok(renamed.value.project);
    const saved = await allDocuments.save(PROJECTS, renamed.value.project, { expectedRevision });
    if (!saved.ok) return asProjectError(saved, projectId);
    renamed.value.events.forEach((e) => ctx.emit(e));
    return ok(renamed.value.project);
  },
});

/** Remove every document a project owns. */
async function emptyProject(documents, projectId) {
  for (const collection of PROJECT_COLLECTIONS) {
    const name = scopedCollection(collection, projectId);
    const listed = await documents.list(name);
    if (!listed.ok) return listed;
    for (const doc of listed.value) {
      const removed = await documents.remove(name, doc.id, { expectedRevision: doc.revision });
      if (!removed.ok && removed.error.code !== ErrorCode.NOT_FOUND) return removed;
    }
  }
  return ok();
}

/** project.delete { projectId, expectedRevision } → ok(); deletes the project and all it holds; emits project.deleted { projectId }. */
export const deleteProject = defineMessage({
  kind: 'command', type: 'project.delete', v: 1, required: ['projectId', 'expectedRevision'],
  async handle({ payload: { projectId: target, expectedRevision }, ctx, ports: { allDocuments, projectId } }) {
    const problems = [
      ...checkProjectId(target),
      ...(target === DEFAULT_PROJECT_ID ? [{ field: 'projectId', reason: 'the Default project cannot be deleted' }] : checkRevision('expectedRevision', expectedRevision)),
      ...(target === projectId && target !== DEFAULT_PROJECT_ID ? [{ field: 'projectId', reason: 'is the open project; open another one first' }] : []),
    ];
    if (problems.length) return validationFailed('Invalid project.delete payload', [...new Map(problems.map((p) => [p.field, p])).values()]);
    const loaded = await loadProject(allDocuments, target);
    if (!loaded.ok) return loaded;
    if (loaded.value.revision !== expectedRevision) {
      return err(ErrorCode.CONFLICT, 'This project was changed elsewhere; reload and try again', { projectId: target, expectedRevision, actualRevision: loaded.value.revision });
    }
    const emptied = await emptyProject(allDocuments, target);
    if (!emptied.ok) return emptied;
    const removed = await allDocuments.remove(PROJECTS, target, { expectedRevision });
    if (!removed.ok) return asProjectError(removed, target);
    ctx.emit({ type: 'project.deleted', v: 1, payload: { projectId: target } });
    return ok();
  },
});

/** project.export {} → ok(ProjectDocument): the open project as one plain-JSON document. */
export const exportProject = defineMessage({
  kind: 'query', type: 'project.export', v: 1,
  async handle({ ports: { allDocuments, documentRepository, settingsStore, projectId, clock } }) {
    const project = await loadProject(allDocuments, projectId);
    if (!project.ok) return project;
    const settings = await settingsStore.get();
    if (!settings.ok) return settings;
    const lists = await Promise.all(['coas', 'systems', 'threat-models'].map((c) => documentRepository.list(c)));
    const failed = lists.find((r) => !r.ok);
    if (failed) return failed;
    const [coas, systems, models] = lists.map((r) => r.value);
    const { frame, marking } = settings.value ?? DEFAULT_SETTINGS;
    return ok({
      format: PROJECT_FORMAT, version: PROJECT_FORMAT_VERSION, name: project.value.name, exportedAt: clock.now(),
      settings: { frame: frame ?? null, marking },
      coas: JSON.parse(JSON.stringify(coas)),
      systems: systems.map(readSystem).filter(Boolean),
      threatModels: models.map((m) => readThreatModel(m, systemsById(systems.map(readSystem).filter(Boolean)))).filter(Boolean),
    });
  },
});

/** "IRON", or "IRON (2)", "IRON (3)" … when a project already has that name. */
function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, 120 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const DOCUMENT_KEYS = ['format', 'version', 'name', 'exportedAt', 'settings', 'coas', 'systems', 'threatModels'];
const COA_META_KEYS = ['id', 'createdAt', 'updatedAt', 'revision', 'source'];

/** Check a project document; every problem is listed. → { problems, value?: { name, settings, coas, systems, threatModels } } */
function readProjectDocument(doc, { symbolRenderer, now }) {
  const problems = Object.keys(doc).filter((k) => !DOCUMENT_KEYS.includes(k)).map((k) => ({ field: k, reason: 'unknown field' }));
  problems.push(...checkProjectName(doc.name));
  const settings = doc.settings === undefined ? { frame: null, marking: DEFAULT_SETTINGS.marking } : doc.settings;
  if (!isObject(settings)) problems.push({ field: 'settings', reason: 'must be an object { frame, marking }' });
  else problems.push(...checkSettingsChange(settings).map((p) => ({ ...p, field: `settings.${p.field}` })));
  const list = (key) => {
    if (doc[key] === undefined) return [];
    if (Array.isArray(doc[key])) return doc[key];
    problems.push({ field: key, reason: 'must be a list' });
    return [];
  };
  const uniqueIds = (key, items) => {
    const seen = new Set();
    items.forEach((item, i) => { if (item && seen.has(item.id)) problems.push({ field: `${key}[${i}].id`, reason: 'is used twice' }); else if (item) seen.add(item.id); });
  };
  const coas = list('coas').map((raw, i) => {
    const at = `coas[${i}]`;
    if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.trim() === '' || raw.id.length > 128) { problems.push({ field: at, reason: 'must be a COA with an id' }); return null; }
    const content = Object.fromEntries(Object.entries(raw).filter(([k]) => !COA_META_KEYS.includes(k)));
    const parsed = parseCoaContent(content);
    const found = parsed.problems.map((p) => ({ ...p, field: p.field.replace(/^content/, at) }));
    (parsed.value?.symbols ?? []).forEach((s, j) => { if (!checkSidcKnown(symbolRenderer, s.sidc).ok) found.push({ field: `${at}.symbols[${j}].sidc`, reason: 'is not a symbol the app can draw' }); });
    problems.push(...found);
    if (found.length) return null;
    return restoreCoa(null, { id: raw.id, content: parsed.value }, { now }).value.coa;
  });
  const systems = list('systems').map((raw, i) => readSystem(raw) ?? (problems.push({ field: `systems[${i}]`, reason: 'is not a valid system' }), null));
  const threatModels = list('threatModels').map((raw, i) => readThreatModel(raw, systemsById(systems.filter(Boolean))) ?? (problems.push({ field: `threatModels[${i}]`, reason: 'is not a valid threat model' }), null));
  uniqueIds('coas', coas); uniqueIds('systems', systems); uniqueIds('threatModels', threatModels);
  if (problems.length) return { problems };
  return { problems: [], value: { name: doc.name.trim(), settings: { frame: settings.frame ?? null, marking: settings.marking ?? DEFAULT_SETTINGS.marking }, coas, systems, threatModels } };
}

/**
 * project.import { document } → ok(Project): a new project holding the document's settings, COAs,
 * systems and threat models with their ids. Emits project.imported { project, counts }.
 * IMPORT_INVALID { problems } (every problem, nothing stored) | UNSUPPORTED_VERSION { found, supported }.
 */
export const importProject = defineMessage({
  kind: 'command', type: 'project.import', v: 1, required: ['document'],
  async handle({ payload: { document: doc }, ctx, ports: { allDocuments, ids, clock, symbolRenderer } }) {
    if (!isObject(doc) || doc.format !== PROJECT_FORMAT) {
      return err(ErrorCode.IMPORT_INVALID, 'This is not a COA Builder project file', { problems: [{ field: 'format', reason: `must be "${PROJECT_FORMAT}"` }] });
    }
    if (doc.version !== PROJECT_FORMAT_VERSION) {
      if (Number.isInteger(doc.version) && doc.version > PROJECT_FORMAT_VERSION) {
        return err(ErrorCode.UNSUPPORTED_VERSION, `Project file version ${doc.version} is newer than this app supports`, { found: doc.version, supported: [PROJECT_FORMAT_VERSION] });
      }
      return err(ErrorCode.IMPORT_INVALID, 'The project file has problems', { problems: [{ field: 'version', reason: `must be ${PROJECT_FORMAT_VERSION}` }] });
    }
    const now = clock.now();
    const read = readProjectDocument(doc, { symbolRenderer, now });
    if (read.problems.length) return err(ErrorCode.IMPORT_INVALID, 'The project file has problems', { problems: read.problems });
    const all = await allProjects(allDocuments);
    if (!all.ok) return all;
    const id = ok(projectIdFrom(ids.next('p'), new Set(all.value.map((p) => p.id))));
    const { settings, coas, systems, threatModels } = read.value;
    const name = uniqueName(read.value.name, new Set(all.value.map((p) => p.name)));
    const writes = [
      ['settings', { id: 'settings', revision: 1, ...settings }],
      ...coas.map((d) => ['coas', d]), ...systems.map((d) => ['systems', d]), ...threatModels.map((d) => ['threat-models', d]),
    ];
    for (const [collection, doc] of writes) {
      const saved = await allDocuments.save(scopedCollection(collection, id.value), doc, { expectedRevision: 0 });
      if (!saved.ok) { await emptyProject(allDocuments, id.value); return saved; } // the project never appears half-made
    }
    const created = create({ id: id.value, name }, { now });
    const saved = await allDocuments.save(PROJECTS, created.value.project, { expectedRevision: 0 });
    if (!saved.ok) { await emptyProject(allDocuments, id.value); return asProjectError(saved, id.value); }
    const project = created.value.project;
    ctx.emit({ type: 'project.imported', v: 1, payload: { project, counts: { coas: coas.length, systems: systems.length, threatModels: threatModels.length } } });
    return ok(project);
  },
});

export const PROJECT_MESSAGES = Object.freeze([listProjects, getProject, createProject, renameProjectMessage, deleteProject, exportProject, importProject]);
