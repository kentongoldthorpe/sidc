// M10-3b Unit templates (D29): ready-made units, copied when used. Tested at the boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields, UNKNOWN_SIDC } from '../support/app-harness.js';
import { InMemoryDocumentRepository } from '../../src/adapters/persistence/in-memory-document-repository.js';

const BMP = '10061000001211020000';
const GUN = { name: '30 mm cannon', role: 'direct', maxRange: 2000, arc: 360 };
const TEMPLATE = { name: 'BMP-2 Coy', sidc: BMP, label: 'MRC', weapons: [GUN], details: { strength: '10 BMP-2', equipment: [{ name: 'BMP-2', count: 10 }] } };

describe('unit-template.create / update / delete / list', () => {
  it('stores a template with a fresh id and publishes unit-template.created', async () => {
    const h = createHarness();
    const t = okValue(await h.dispatch('unit-template.create', TEMPLATE));
    assert.deepEqual(t, { id: t.id, revision: 1, ...TEMPLATE });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.payload]), [['unit-template.created', { template: t }]]);
    assert.deepEqual(okValue(await h.query('unit-template.list')), [t]);
  });

  it('needs a name and a symbol the app can draw, and checks weapons and details', async () => {
    const h = createHarness();
    assert.deepEqual(problemFields(errorOf(await h.dispatch('unit-template.create', { label: 'x' }), 'VALIDATION_FAILED')).sort(), ['name', 'sidc']);
    assert.deepEqual(problemFields(errorOf(await h.dispatch('unit-template.create', { ...TEMPLATE, sidc: UNKNOWN_SIDC, weapons: [{ name: 'x', role: 'direct' }] }), 'VALIDATION_FAILED')).sort(),
      ['sidc', 'weapons[0].maxRange']);
    assert.deepEqual(problemFields(errorOf(await h.dispatch('unit-template.create', { ...TEMPLATE, colour: 'red' }), 'VALIDATION_FAILED')), ['colour']);
  });

  it('updates (an empty extra removes it), lists by name, and deletes', async () => {
    const h = createHarness();
    const t = okValue(await h.dispatch('unit-template.create', TEMPLATE));
    okValue(await h.dispatch('unit-template.create', { name: 'AD Bty', sidc: BMP }));
    h.takeEvents();
    const u = okValue(await h.dispatch('unit-template.update', { templateId: t.id, expectedRevision: 1, name: 'BMP-2 company', hvt: true, details: {} }));
    assert.deepEqual([u.name, u.hvt, 'details' in u, u.revision], ['BMP-2 company', true, false, 2]);
    assert.deepEqual(h.takeEvents()[0].payload.changed, ['name', 'hvt', 'details']);
    assert.deepEqual(okValue(await h.query('unit-template.list')).map((x) => x.name), ['AD Bty', 'BMP-2 company']);
    assert.deepEqual(errorOf(await h.dispatch('unit-template.update', { templateId: t.id, expectedRevision: 1, name: 'Late' }), 'CONFLICT').details, { templateId: t.id, expectedRevision: 1, actualRevision: 2 });
    okValue(await h.dispatch('unit-template.delete', { templateId: t.id, expectedRevision: 2 }));
    assert.deepEqual(okValue(await h.query('unit-template.list')).map((x) => x.name), ['AD Bty']);
    assert.deepEqual(errorOf(await h.dispatch('unit-template.delete', { templateId: t.id, expectedRevision: 2 }), 'NOT_FOUND').details, { templateId: t.id });
  });

  it('belongs to the open project', async () => {
    const docs = new InMemoryDocumentRepository();
    const h = createHarness({ documentRepository: docs });
    const project = okValue(await h.dispatch('project.create', { name: 'IRON' }));
    okValue(await createHarness({ documentRepository: docs, projectId: project.id }).dispatch('unit-template.create', TEMPLATE));
    assert.deepEqual(okValue(await h.query('unit-template.list')), []);
  });
});

describe('unit-template.export and unit-template.import (docs/UNIT-TEMPLATES.md)', () => {
  it('exports every template without ids, and imports them as new templates', async () => {
    const h = createHarness();
    okValue(await h.dispatch('unit-template.create', TEMPLATE));
    const doc = okValue(await h.query('unit-template.export'));
    assert.deepEqual(doc, { format: 'coa-builder/unit-templates', version: 1, templates: [TEMPLATE] });
    const other = createHarness();
    const { templates } = okValue(await other.dispatch('unit-template.import', { document: { ...doc, source: 'Unit guide 2025' } }));
    assert.deepEqual(templates.map(({ id, revision, ...t }) => t), [TEMPLATE]);
    assert.deepEqual(other.takeEvents().map((e) => e.type), ['unit-template.created']);
  });

  it('refuses a file with problems, listing every one, and adds nothing', async () => {
    const h = createHarness();
    const error = errorOf(await h.dispatch('unit-template.import', { document: { format: 'coa-builder/unit-templates', version: 1, templates: [TEMPLATE, { sidc: 'x' }, { ...TEMPLATE, hvt: 'y' }] } }), 'IMPORT_INVALID');
    assert.deepEqual(error.details.problems.map((p) => p.field).sort(), ['templates[1].name', 'templates[1].sidc', 'templates[2].hvt']);
    assert.deepEqual(okValue(await h.query('unit-template.list')), []);
    errorOf(await h.dispatch('unit-template.import', { document: { format: 'coa-builder/import', version: 1 } }), 'IMPORT_INVALID');
    assert.deepEqual(errorOf(await h.dispatch('unit-template.import', { document: { format: 'coa-builder/unit-templates', version: 2, templates: [] } }), 'UNSUPPORTED_VERSION').details, { found: 2, supported: [1] });
  });
});

describe('unit-template.from-systems: the systems list becomes templates (D29)', () => {
  it('makes one template per system, carrying it as a weapon, and skips names already used', async () => {
    const h = createHarness();
    okValue(await h.dispatch('system.create', { name: 'SA-15', role: 'airDefence', maxRange: 12000 }));
    okValue(await h.dispatch('system.create', { name: 'T-72 gun', role: 'direct', maxRange: 2500, minRange: 100, arc: 60 }));
    const first = okValue(await h.dispatch('unit-template.from-systems', {}));
    assert.deepEqual(first.templates.map((t) => [t.name, t.weapons]), [
      ['SA-15', [{ name: 'SA-15', role: 'airDefence', maxRange: 12000, arc: 360 }]],
      ['T-72 gun', [{ name: 'T-72 gun', role: 'direct', maxRange: 2500, minRange: 100, arc: 60 }]],
    ]);
    assert.deepEqual(okValue(await h.dispatch('unit-template.from-systems', {})).templates, [], 'running it again adds nothing');
    assert.equal(okValue(await h.query('system.list')).length, 2, 'the systems list is left as it was');
  });
});

describe('projects carry their unit templates', () => {
  it('exports and imports them with the project', async () => {
    const h = createHarness();
    okValue(await h.dispatch('unit-template.create', TEMPLATE));
    const doc = okValue(await h.query('project.export'));
    assert.equal(doc.unitTemplates.length, 1);
    const docs = new InMemoryDocumentRepository();
    const project = okValue(await createHarness({ documentRepository: docs }).dispatch('project.import', { document: doc }));
    const inside = createHarness({ documentRepository: docs, projectId: project.id });
    assert.deepEqual(okValue(await inside.query('unit-template.list')).map((t) => t.name), ['BMP-2 Coy']);
  });
});

describe('docs/UNIT-TEMPLATES.md', () => {
  it('its example imports', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../../docs/UNIT-TEMPLATES.md', import.meta.url), 'utf8');
    const document = JSON.parse(/```json\n([\s\S]*?)```/.exec(text)[1]);
    const { templates } = okValue(await createHarness().dispatch('unit-template.import', { document }));
    assert.deepEqual(templates.map((t) => [t.name, t.weapons.length]), [['BMP-2 Coy', 2]]);
  });
});
