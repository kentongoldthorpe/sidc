// M10-2 Projects (D27): a project holds its own COAs, settings, systems and threat models, like an
// ArcGIS Pro project. The app runs inside one project (chosen at start-up); the Default project is
// where everything saved before projects lives. Tested through envelopes at the boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { InMemoryDocumentRepository } from '../../src/adapters/persistence/in-memory-document-repository.js';

const INF = '10031000001211000000';
const shared = () => new InMemoryDocumentRepository();
/** Two windows on the same storage: one in the Default project, one in `projectId`. */
const pair = (documentRepository, projectId) => [createHarness({ documentRepository }), createHarness({ documentRepository, projectId })];

describe('project.list and project.get', () => {
  it('always has the Default project, even before anything is saved; it is the one open by default', async () => {
    const h = createHarness();
    assert.deepEqual(okValue(await h.query('project.list')), [{ id: 'default', name: 'Default', revision: 0, updatedAt: null, current: true }]);
    assert.deepEqual(okValue(await h.query('project.get')), { id: 'default', name: 'Default', revision: 0, createdAt: null, updatedAt: null });
  });
});

describe('project.create', () => {
  it('stores a project with a short id and publishes project.created; the list shows it after Default', async () => {
    const h = createHarness();
    const project = okValue(await h.dispatch('project.create', { name: '  Exercise IRON  ' }));
    assert.match(project.id, /^p[a-z0-9]{1,11}$/);
    assert.deepEqual({ ...project, id: 'x' }, { id: 'x', name: 'Exercise IRON', revision: 1, createdAt: h.clock.now(), updatedAt: h.clock.now() });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload]), [['project.created', { project }]]);
    assert.deepEqual(okValue(await h.query('project.list')).map((p) => [p.name, p.current]), [['Default', true], ['Exercise IRON', false]]);
  });

  it('refuses a blank or long name', async () => {
    const h = createHarness();
    assert.deepEqual(problemFields(errorOf(await h.dispatch('project.create', { name: ' ' }), 'VALIDATION_FAILED')), ['name']);
    assert.deepEqual(problemFields(errorOf(await h.dispatch('project.create', { name: 'x'.repeat(121) }), 'VALIDATION_FAILED')), ['name']);
  });
});

describe('working inside a project', () => {
  it('keeps COAs, settings, systems and threat models apart from the Default project', async () => {
    const docs = shared();
    const project = okValue(await createHarness({ documentRepository: docs }).dispatch('project.create', { name: 'IRON' }));
    const [def, iron] = pair(docs, project.id);
    okValue(await def.dispatch('coa.create', { name: 'Default COA' }));
    okValue(await iron.dispatch('coa.create', { name: 'IRON COA' }));
    okValue(await iron.dispatch('system.create', { name: 'Gun', role: 'direct', maxRange: 2000 }));
    okValue(await iron.dispatch('threat-model.create', { name: 'MRB' }));
    okValue(await iron.dispatch('settings.update', { expectedRevision: 0, marking: { text: 'SECRET', color: '#c8102e' } }));
    assert.deepEqual(okValue(await def.query('coa.list')).map((c) => c.name), ['Default COA']);
    assert.deepEqual(okValue(await iron.query('coa.list')).map((c) => c.name), ['IRON COA']);
    assert.deepEqual(okValue(await def.query('system.list')), []);
    assert.deepEqual(okValue(await def.query('threat-model.list')), []);
    assert.equal(okValue(await def.query('settings.get')).marking.text, 'UNCLASSIFIED');
    assert.equal(okValue(await iron.query('settings.get')).marking.text, 'SECRET');
    assert.equal(okValue(await iron.query('project.get')).name, 'IRON');
    assert.deepEqual(okValue(await iron.query('project.list')).map((p) => [p.name, p.current]), [['Default', false], ['IRON', true]]);
  });

  it('the Default project uses the storage everything was saved in before projects (no migration)', async () => {
    const docs = shared();
    const coa = okValue(await createHarness({ documentRepository: docs }).dispatch('coa.create', { name: 'Old' }));
    assert.equal((await docs.get('coas', coa.id)).ok, true);
  });

  it('refuses to start in a project id that is not a valid one', () => {
    assert.throws(() => createHarness({ projectId: '../etc' }), TypeError);
  });
});

describe('project.rename', () => {
  it('renames a project and publishes project.renamed', async () => {
    const h = createHarness();
    const project = okValue(await h.dispatch('project.create', { name: 'A' }));
    h.takeEvents();
    const renamed = okValue(await h.dispatch('project.rename', { projectId: project.id, expectedRevision: 1, name: 'B' }));
    assert.deepEqual([renamed.name, renamed.revision], ['B', 2]);
    assert.deepEqual(h.takeEvents().map((e) => e.type), ['project.renamed']);
  });

  it('renames the Default project (stored from then on, revision 0 → 1)', async () => {
    const h = createHarness();
    const renamed = okValue(await h.dispatch('project.rename', { projectId: 'default', expectedRevision: 0, name: 'Home' }));
    assert.deepEqual([renamed.id, renamed.name, renamed.revision], ['default', 'Home', 1]);
    assert.equal(okValue(await h.query('project.list'))[0].name, 'Home');
  });

  it('is CONFLICT for a stale revision and NOT_FOUND for an unknown project', async () => {
    const h = createHarness();
    const project = okValue(await h.dispatch('project.create', { name: 'A' }));
    okValue(await h.dispatch('project.rename', { projectId: project.id, expectedRevision: 1, name: 'B' }));
    assert.deepEqual(errorOf(await h.dispatch('project.rename', { projectId: project.id, expectedRevision: 1, name: 'C' }), 'CONFLICT').details, { projectId: project.id, expectedRevision: 1, actualRevision: 2 });
    assert.deepEqual(errorOf(await h.dispatch('project.rename', { projectId: 'pnope', expectedRevision: 1, name: 'C' }), 'NOT_FOUND').details, { projectId: 'pnope' });
  });
});

describe('project.delete', () => {
  it('deletes a project and everything in it, and publishes project.deleted', async () => {
    const docs = shared();
    const h = createHarness({ documentRepository: docs });
    const project = okValue(await h.dispatch('project.create', { name: 'Gone' }));
    const inside = createHarness({ documentRepository: docs, projectId: project.id });
    okValue(await inside.dispatch('coa.create', { name: 'X' }));
    okValue(await inside.dispatch('system.create', { name: 'Gun', role: 'direct', maxRange: 2000 }));
    h.takeEvents();
    okValue(await h.dispatch('project.delete', { projectId: project.id, expectedRevision: 1 }));
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload]), [['project.deleted', { projectId: project.id }]]);
    assert.deepEqual(okValue(await h.query('project.list')).map((p) => p.id), ['default']);
    assert.deepEqual(okValue(await inside.query('coa.list')), []);
    assert.deepEqual(okValue(await inside.query('system.list')), []);
  });

  it('refuses to delete the Default project or the one that is open', async () => {
    const docs = shared();
    const project = okValue(await createHarness({ documentRepository: docs }).dispatch('project.create', { name: 'Open' }));
    const inside = createHarness({ documentRepository: docs, projectId: project.id });
    assert.deepEqual(problemFields(errorOf(await inside.dispatch('project.delete', { projectId: 'default', expectedRevision: 0 }), 'VALIDATION_FAILED')), ['projectId']);
    assert.deepEqual(problemFields(errorOf(await inside.dispatch('project.delete', { projectId: project.id, expectedRevision: 1 }), 'VALIDATION_FAILED')), ['projectId']);
  });
});

describe('project.export and project.import: a whole project as one file (sharing, D20)', () => {
  async function filled() {
    const h = createHarness();
    const gun = okValue(await h.dispatch('system.create', { name: 'Gun', role: 'direct', maxRange: 2000, arc: 60 }));
    let model = okValue(await h.dispatch('threat-model.create', { name: 'MRB' }));
    model = okValue(await h.dispatch('threat-model.set-template', { modelId: model.id, expectedRevision: 1, target: 'formation', template: { units: [{ id: 'u1', sidc: INF, label: 'A', x: 0, y: 0, systems: [gun.id] }], graphics: [] } }));
    const coa = okValue(await h.dispatch('coa.create', { name: 'COA 1', description: 'Main effort north' }));
    okValue(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INF, position: { lat: 1, lng: 2 }, label: 'U' }));
    okValue(await h.dispatch('settings.update', { expectedRevision: 0, marking: { text: 'SECRET', color: '#c8102e' } }));
    return { h, gun, model, coa };
  }

  it('exports the open project: its name, settings, COAs, systems and threat models', async () => {
    const { h, gun, model } = await filled();
    const doc = okValue(await h.query('project.export'));
    assert.equal(doc.format, 'coa-builder/project');
    assert.equal(doc.version, 1);
    assert.equal(doc.name, 'Default');
    assert.deepEqual(doc.settings, { frame: null, marking: { text: 'SECRET', color: '#c8102e' } });
    assert.deepEqual(doc.coas.map((c) => [c.name, c.symbols.length]), [['COA 1', 1]]);
    assert.deepEqual(doc.systems, [gun]);
    assert.deepEqual(doc.threatModels.map((m) => m.id), [model.id]);
    assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc, 'plain JSON');
  });

  it('imports a file as a new project with the same content and ids (references between them still work)', async () => {
    const { h, gun, model, coa } = await filled();
    const doc = okValue(await h.query('project.export'));
    const docs = shared();
    const other = createHarness({ documentRepository: docs });
    const project = okValue(await other.dispatch('project.import', { document: { ...doc, name: 'Shared' } }));
    assert.equal(project.name, 'Shared');
    assert.deepEqual(other.takeEvents().map((e) => [e.type, e.payload]), [['project.imported', { project, counts: { coas: 1, systems: 1, threatModels: 1 } }]]);
    const inside = createHarness({ documentRepository: docs, projectId: project.id });
    const got = okValue(await inside.query('coa.get', { coaId: coa.id }));
    assert.deepEqual([got.name, got.description, got.symbols[0].label], ['COA 1', 'Main effort north', 'U']);
    assert.deepEqual(okValue(await inside.query('system.list')), [gun]);
    assert.deepEqual(okValue(await inside.query('threat-model.get', { modelId: model.id })).formation.units[0].weapons, [{ name: 'Gun', role: 'direct', maxRange: 2000, arc: 60 }]);
    assert.equal(okValue(await inside.query('settings.get')).marking.text, 'SECRET');
    assert.deepEqual(okValue(await other.query('coa.list')), [], 'nothing lands in the open project');
  });

  it('names the new project "<name> (2)" when that name is already taken', async () => {
    const { h } = await filled();
    const doc = okValue(await h.query('project.export'));
    assert.equal(okValue(await h.dispatch('project.import', { document: doc })).name, 'Default (2)');
    assert.equal(okValue(await h.dispatch('project.import', { document: doc })).name, 'Default (3)');
  });

  it('refuses a document with problems, names every one, and creates nothing', async () => {
    const { h } = await filled();
    const doc = okValue(await h.query('project.export'));
    const bad = { ...doc, name: '', coas: [{ ...doc.coas[0], symbols: [{ ...doc.coas[0].symbols[0], sidc: 'nope' }] }], systems: [{ id: 'sys-x' }] };
    const error = errorOf(await h.dispatch('project.import', { document: bad }), 'IMPORT_INVALID');
    assert.deepEqual(error.details.problems.map((p) => p.field), ['name', 'coas[0].symbols[0].sidc', 'systems[0]']);
    assert.deepEqual(okValue(await h.query('project.list')).map((p) => p.id), ['default']);
  });

  it('refuses another format or a newer version', async () => {
    const h = createHarness();
    errorOf(await h.dispatch('project.import', { document: { format: 'coa-builder/import', version: 1 } }), 'IMPORT_INVALID');
    assert.deepEqual(errorOf(await h.dispatch('project.import', { document: { format: 'coa-builder/project', version: 2 } }), 'UNSUPPORTED_VERSION').details, { found: 2, supported: [1] });
  });
});
