// E6-3: version fingerprints in files, and updating a COA from a file by name.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { readImportFile } from '../../src/adapters/files/import-file.js';
import { writeCoaData } from '../../src/adapters/files/coa-data.js';
import { coaFingerprint } from '../../src/domain/coa-changes.js';
import { mgrsOf } from '../../src/domain/mgrs.js';

const INF = '10031000001211000000';
const ARM = '10031000001205000000';

async function setup() {
  const h = createHarness();
  const coa = okValue(await h.dispatch('coa.create', { name: 'COA 1' }));
  let rev = 1;
  const add = async (fields) => { okValue(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: rev, ...fields })); rev += 1; };
  await add({ sidc: INF, position: { mgrs: '18S UJ 2348 0648' }, label: '1 MRC' });
  await add({ sidc: INF, position: { mgrs: '18S UJ 2410 0702' }, label: '2 MRC' });
  okValue(await h.dispatch('graphic.add', { coaId: coa.id, expectedRevision: rev, kind: 'phaseLine', label: 'PL GOLD', points: [{ mgrs: '18S UJ 2200 0600' }, { mgrs: '18S UJ 2600 0600' }] }));
  const get = async () => okValue(await h.query('coa.get', { coaId: coa.id }));
  const header = async (format) => okValue(await h.query('export.header', { format, coaIds: [coa.id] }));
  const read = (text) => { const r = readImportFile(text); assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
  return { h, coaId: coa.id, get, header, read };
}

describe('versions in exported files', () => {
  it('export.header lists each COA\'s fingerprint; the CSV writes them under the marking line', async () => {
    const s = await setup();
    const coa = await s.get();
    const header = await s.header('csv');
    assert.deepEqual(header.versions, [{ coa: 'COA 1', fingerprint: coaFingerprint(coa) }]);
    const csv = writeCoaData('csv', [coa], { header });
    assert.match(csv, new RegExp(`^\\uFEFF# UNCLASSIFIED // .*\\r\\n# version COA 1: ${coaFingerprint(coa)}\\r\\ncoa,sidc`));
    errorOf(await s.h.query('export.header', { format: 'csv', coaIds: 'x' }), 'VALIDATION_FAILED');
  });

  it('a CSV export with its marking and version lines imports again (it did not before E6-3: the marking line has no comma)', async () => {
    const s = await setup();
    const csv = writeCoaData('csv', [await s.get()], { header: await s.header('csv') });
    const { coas } = okValue(await createHarness().dispatch('coa.import', { document: s.read(csv).document }));
    assert.equal(coas.length, 1);
  });
});

describe('coa.diff and coa.update-from-file', () => {
  it('round trip: export a CSV, move a unit in it, preview the change, apply it, with a transfer record', async () => {
    const s = await setup();
    const before = await s.get();
    const csv = writeCoaData('csv', [before], { header: await s.header('csv') }).replace('18S UJ 2410 0702', '18S UJ 2420 0710').replace(/(COA 1,\d+,)[-\d.]+,[-\d.]+,(18S UJ 2420)/, '$1,,$2');
    const { document } = s.read(csv);
    const diff = okValue(await s.h.query('coa.diff', { coaId: s.coaId, document }));
    assert.deepEqual([diff.fingerprint, diff.basedOn, diff.versionMatches], [coaFingerprint(before), coaFingerprint(before), true]);
    assert.deepEqual(diff.changes.map((c) => [c.action, c.name, c.fields, c.movedMetres]), [['change', '2 MRC', ['position'], 128]]);
    assert.equal(diff.unchanged, 1);
    assert.equal((await s.get()).revision, before.revision, 'a preview saves nothing');

    s.h.takeEvents();
    const applied = okValue(await s.h.dispatch('coa.update-from-file', { coaId: s.coaId, expectedRevision: before.revision, document, transfer: { file: 'coa1.csv', enteredBy: 'SGT A', checkedBy: 'CPL B' } }));
    const after = await s.get();
    assert.equal(after.revision, before.revision + 1);
    assert.equal(mgrsOf(after.symbols[1].position), '18S UJ 2420 0710');
    assert.deepEqual(applied.transfer, { at: applied.transfer.at, file: 'coa1.csv', enteredBy: 'SGT A', checkedBy: 'CPL B', basedOn: coaFingerprint(before), from: coaFingerprint(before), to: coaFingerprint(after), added: 0, changed: 1, removed: 0 });
    assert.deepEqual(after.transfers, [applied.transfer]);
    assert.deepEqual(s.h.takeEvents().map((e) => e.type), ['coa.changes-applied']);
    // Undo (coa.restore) puts the content back and keeps the record of what was done.
    const { id, revision, createdAt, updatedAt, transfers, ...content } = before;
    const undone = okValue(await s.h.dispatch('coa.restore', { coaId: s.coaId, expectedRevision: after.revision, content }));
    assert.deepEqual(undone.transfers, after.transfers);
  });

  it('refuses a file made from another version unless told to apply it anyway', async () => {
    const s = await setup();
    const csv = writeCoaData('csv', [await s.get()], { header: await s.header('csv') });
    const latest = okValue(await s.h.dispatch('coa.update', { coaId: s.coaId, expectedRevision: 4, description: 'changed meanwhile' }));
    const { document } = s.read(csv.replace('18S UJ 2410 0702', '18S UJ 2420 0710').replace(/(COA 1,\d+,)[-\d.]+,[-\d.]+,(18S UJ 2420)/, '$1,,$2'));
    const diff = okValue(await s.h.query('coa.diff', { coaId: s.coaId, document }));
    assert.equal(diff.versionMatches, false);
    const e = errorOf(await s.h.dispatch('coa.update-from-file', { coaId: s.coaId, expectedRevision: latest.revision, document }), 'VERSION_MISMATCH');
    assert.deepEqual(e.details, { basedOn: diff.basedOn, current: diff.fingerprint });
    okValue(await s.h.dispatch('coa.update-from-file', { coaId: s.coaId, expectedRevision: latest.revision, document, acceptVersionMismatch: true }));
    errorOf(await s.h.dispatch('coa.update-from-file', { coaId: s.coaId, expectedRevision: latest.revision, document }), 'CONFLICT');
  });

  it('applies a paper change sheet: version line, only the changed rows, add, move, rename and remove by name', async () => {
    const s = await setup();
    const fp = coaFingerprint(await s.get());
    const sheet = [`# version: ${fp.toLowerCase().replace('-', ' ')}`, 'label,action,mgrs,sidc,newLabel', '1 mrc,change,18S UJ 2350 0650,,1 MRC (-)', '2 MRC,remove,,,', 'Recon,add,18S UJ 2380 0700,' + ARM + ','].join('\n');
    const { document } = s.read(sheet);
    const diff = okValue(await s.h.query('coa.diff', { coaId: s.coaId, document }));
    assert.equal(diff.versionMatches, true, 'the fingerprint as written on paper');
    assert.deepEqual(diff.changes.map((c) => [c.action, c.name, c.newName ?? null, c.fields ?? []]), [['change', '1 MRC', '1 MRC (-)', ['position', 'label']], ['remove', '2 MRC', null, []], ['add', 'Recon', null, []]]);
    okValue(await s.h.dispatch('coa.update-from-file', { coaId: s.coaId, expectedRevision: 4, document }));
    const after = await s.get();
    assert.deepEqual(after.symbols.map((u) => [u.label, mgrsOf(u.position)]), [['1 MRC (-)', '18S UJ 2350 0650'], ['Recon', '18S UJ 2380 0700']]);
    assert.equal(after.graphics.length, 1, 'lines untouched');
  });

  it('names every problem by row and column, and saves nothing', async () => {
    const s = await setup();
    const { document, where } = s.read('label,action,mgrs\n1 MRC,change,18S UJ 2350 065\nGhost,change,18S UJ 2350 0650\n2 MRC,move,\n');
    const e = errorOf(await s.h.query('coa.diff', { coaId: s.coaId, document }), 'IMPORT_INVALID');
    assert.deepEqual(e.details.problems.map((p) => where(p.field)), ['row 2, column mgrs', 'row 4, column action']);
    const again = s.read('label,action,mgrs\nGhost,change,18S UJ 2350 0650\n');
    const e2 = errorOf(await s.h.query('coa.diff', { coaId: s.coaId, document: again.document }), 'IMPORT_INVALID');
    assert.equal(again.where(e2.details.problems[0].field), 'row 2, column label');
    assert.match(e2.details.problems[0].reason, /"Ghost" is not in the COA/);
  });

  it('replace: a GeoJSON export without a unit removes it; lines the file lists are kept', async () => {
    const s = await setup();
    const coa = await s.get();
    const geo = JSON.parse(writeCoaData('geojson', [coa], { header: await s.header('geojson') }));
    geo.features = geo.features.filter((f) => f.properties.label !== '1 MRC');
    const { document } = s.read(JSON.stringify(geo));
    const merge = okValue(await s.h.query('coa.diff', { coaId: s.coaId, document }));
    assert.deepEqual(merge.changes, [], 'merge: nothing to change');
    const replace = okValue(await s.h.query('coa.diff', { coaId: s.coaId, document, mode: 'replace' }));
    assert.deepEqual(replace.changes.map((c) => [c.action, c.name, c.notInFile]), [['remove', '1 MRC', true]]);
    assert.equal(replace.versionMatches, true);
  });

  it('checks its payload', async () => {
    const s = await setup();
    const { document } = s.read('label,action\n1 MRC,remove\n');
    assert.deepEqual(problemFields(errorOf(await s.h.query('coa.diff', { coaId: s.coaId, document, mode: 'all', basedOn: 'nope' }), 'VALIDATION_FAILED')), ['mode', 'basedOn']);
    errorOf(await s.h.query('coa.diff', { coaId: 'missing', document }), 'NOT_FOUND');
    assert.deepEqual(problemFields(errorOf(await s.h.dispatch('coa.update-from-file', { coaId: s.coaId, expectedRevision: 4, document, transfer: { who: 1 } }), 'VALIDATION_FAILED')), ['transfer.who']);
  });
});
