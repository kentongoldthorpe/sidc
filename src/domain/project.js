// A project (D27, like an ArcGIS Pro project): a named workspace holding its own COAs, settings,
// systems and threat models. The Default project is where everything saved before projects lives;
// it exists without being stored until it is renamed. A project's documents live in collections
// named "<collection>--<projectId>", so project ids are short, lower-case and safe in a file name.
import { ok, err } from '../shared/result.js';
import { ErrorCode } from '../shared/errors.js';
import { deepFreeze } from '../shared/freeze.js';
import { isObject } from '../shared/values.js';

export const PROJECT_NAME_MAX = 120;
export const DEFAULT_PROJECT_ID = 'default';
export const PROJECT_FORMAT = 'coa-builder/project';
export const PROJECT_FORMAT_VERSION = 1;
/** The collections each project has its own copy of. */
export const PROJECT_COLLECTIONS = Object.freeze(['coas', 'settings', 'systems', 'threat-models']);

const ID_PATTERN = /^p[a-z0-9]{1,11}$/;
export const isProjectId = (id) => id === DEFAULT_PROJECT_ID || (typeof id === 'string' && ID_PATTERN.test(id));

export const DEFAULT_PROJECT = deepFreeze({ id: DEFAULT_PROJECT_ID, name: 'Default', revision: 0, createdAt: null, updatedAt: null });

/** The collection that holds `collection`'s documents for a project. */
export const scopedCollection = (collection, projectId) =>
  (projectId === DEFAULT_PROJECT_ID ? collection : `${collection}--${projectId}`);

/** A short project id from a fresh unique id ("p-1b2c…" → "p1b2c3d4e5f6"), avoiding `taken`. */
export function projectIdFrom(unique, taken = new Set()) {
  const base = `p${String(unique).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^p/, '')}`.slice(0, 12);
  let id = base.length > 1 ? base : 'p0';
  for (let n = 1; taken.has(id); n += 1) id = `${base.slice(0, 12 - String(n).length)}${n}`;
  return id;
}

export function checkProjectName(name, field = 'name') {
  if (typeof name !== 'string' || name.trim() === '') return [{ field, reason: 'must not be blank' }];
  if (name.trim().length > PROJECT_NAME_MAX) return [{ field, reason: `must be at most ${PROJECT_NAME_MAX} characters` }];
  return [];
}

const invalid = (problems) => err(ErrorCode.VALIDATION_FAILED, 'Invalid project', { problems });

/** A new project → { project, events: [project.created] }. */
export function createProject({ id, name }, { now }) {
  const problems = checkProjectName(name);
  if (problems.length) return invalid(problems);
  const project = deepFreeze({ id, name: name.trim(), revision: 1, createdAt: now, updatedAt: now });
  return ok({ project, events: [{ type: 'project.created', v: 1, payload: { project } }] });
}

/** The project renamed → { project, events: [project.renamed] } (none when the name is the same). */
export function renameProject(project, { name }, { now }) {
  const problems = checkProjectName(name);
  if (problems.length) return invalid(problems);
  if (name.trim() === project.name && project.revision > 0) return ok({ project, events: [] });
  const renamed = deepFreeze({ ...project, name: name.trim(), revision: project.revision + 1, createdAt: project.createdAt ?? now, updatedAt: now });
  return ok({ project: renamed, events: [{ type: 'project.renamed', v: 1, payload: { project: renamed } }] });
}

/** A stored document as a project, or null when it is not a valid one. */
export function readProject(doc) {
  if (!isObject(doc) || !isProjectId(doc.id) || !Number.isInteger(doc.revision) || doc.revision < 1 || checkProjectName(doc.name).length) return null;
  return deepFreeze({ id: doc.id, name: doc.name, revision: doc.revision, createdAt: doc.createdAt ?? null, updatedAt: doc.updatedAt ?? null });
}
