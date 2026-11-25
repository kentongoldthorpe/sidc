// E6-6: the area of operations in settings, the project file, and update previews.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { readImportFile } from '../../src/adapters/files/import-file.js';
import { boxAo } from '../../src/domain/area-of-operations.js';
import { parseMgrs } from '../../src/domain/mgrs.js';

const at = (m) => { const { lat, lng } = parseMgrs(m); return { lat, lng }; };
const BOX = boxAo(at('18S UJ 2000 0000'), at('18S UJ 3000 1000'));

describe('settings.update ao', () => {
  it('sets the area of operations (points may be grids), and null clears it', async () => {
    const h = createHarness();
    const s1 = okValue(await h.dispatch('settings.update', { expectedRevision: 0, ao: { name: 'AO IRON', points: [{ mgrs: '18S UJ 2000 0000' }, { mgrs: '18S UJ 3000 0000' }, { mgrs: '18S UJ 2500 1000' }] } }));
    assert.equal(s1.ao.name, 'AO IRON');
    assert.deepEqual(s1.ao.points[0], at('18S UJ 2000 0000'));
    const s2 = okValue(await h.dispatch('settings.update', { expectedRevision: s1.revision, ao: null }));
    assert.equal('ao' in s2, false);
    assert.deepEqual(problemFields(errorOf(await h.dispatch('settings.update', { expectedRevision: s2.revision, ao: { points: [] } }), 'VALIDATION_FAILED')), ['ao.points']);
  });

  it('travels in the project file', async () => {
    const h = createHarness();
    okValue(await h.dispatch('settings.update', { expectedRevision: 0, ao: { name: 'AO IRON', points: BOX } }));
    const doc = okValue(await h.query('project.export'));
    assert.equal(doc.settings.ao.name, 'AO IRON');
    const project = okValue(await h.dispatch('project.import', { document: doc }));
    assert.ok(project.id);
  });
});

describe('update previews flag items outside the AO', () => {
  it('marks an added or moved unit that lands outside it (a mistyped grid, often)', async () => {
    const h = createHarness();
    okValue(await h.dispatch('settings.update', { expectedRevision: 0, ao: { points: BOX } }));
    const coa = okValue(await h.dispatch('coa.create', { name: 'A' }));
    okValue(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: '10031000001211000000', position: { mgrs: '18S UJ 2500 0500' }, label: '1 MRC' }));
    const { document } = readImportFile('label,action,mgrs,sidc\n1 MRC,change,18S UJ 2500 5000,\nRecon,add,18S UJ 2600 0600,10031000001211000000\n').value;
    const diff = okValue(await h.query('coa.diff', { coaId: coa.id, document }));
    assert.deepEqual(diff.changes.map((c) => [c.name, c.outsideAo ?? false]), [['1 MRC', true], ['Recon', false]]);
  });
});
