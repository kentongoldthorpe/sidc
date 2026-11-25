// E6-2: printable worksheets and their CSV templates, and typing them back in.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { worksheetHtml, worksheetCsvTemplate, paginate, rowsPerPage, splitGrid, KIND_CODES } from '../../../src/adapters/export/worksheets.js';
import { readImportFile } from '../../../src/adapters/files/import-file.js';
import { createHarness, okValue, errorOf } from '../../support/app-harness.js';
import { parseMgrs, mgrsOf } from '../../../src/domain/mgrs.js';
import { coaFingerprint } from '../../../src/domain/coa-changes.js';

const HEADER = { classification: 'SECRET//NOFORN', classificationColor: '#c8102e', project: 'Exercise <IRON>', dtg: '251400ZNOV26', application: 'COA Builder 0.2.0' };
const at = (mgrs) => { const { lat, lng } = parseMgrs(mgrs); return { lat, lng }; };
const unit = (i) => ({ id: `u${i}`, sidc: '10061000001211000000', label: `${i} MRC`, position: at(`18S UJ ${2300 + i * 10} 0648`), modifiers: { higherFormation: '1 MRB' }, ...(i === 1 ? { hvt: true, facing: 45 } : {}) });
const COA = { id: 'c1', name: 'COA 1 <North>', description: '', symbols: Array.from({ length: 20 }, (_, i) => unit(i + 1)),
  graphics: [{ id: 'g1', kind: 'phaseLine', side: 'friendly', label: 'PL GOLD', annotation: 'H+2', points: [at('18S UJ 2200 0600'), at('18S UJ 2600 0600')] },
    { id: 'g2', kind: 'rangeRing', side: 'hostile', label: 'Arty', center: at('18S UJ 2400 0500'), radius: 12000 }] };
const pages = (html) => html.split('<section class="page">').length - 1;
const count = (html, re) => (html.match(re) ?? []).length;

describe('worksheet layout', () => {
  it('fits rows to the paper, keeping room for the sign-off on the last page', () => {
    // Letter landscape: 215.9 mm − 20 mm margins − 64 mm of headings = 131.9 mm of rows; the sign-off takes 30 mm.
    assert.deepEqual(rowsPerPage('units', 'letter'), { full: 14, last: 11 });
    assert.deepEqual(rowsPerPage('units', 'a4'), { full: 14, last: 10 });
    assert.deepEqual(rowsPerPage('lines', 'letter'), { full: 8, last: 6 });
  });

  it('paginates: blank is one page; pre-filled keeps blank lines for additions and fills its last page', () => {
    assert.deepEqual(paginate([], { full: 15, last: 12 }).map((p) => p.length), [12]);
    const p = paginate(Array.from({ length: 20 }, (_, i) => i), { full: 15, last: 12 });
    assert.deepEqual(p.map((x) => x.length), [15, 12]);
    assert.equal(p[1].filter((x) => x === null).length, 7);
    assert.deepEqual(paginate([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { full: 15, last: 12 }).map((x) => x.length), [15, 12], 'fewer than 3 blank lines left: a page more');
    assert.deepEqual(paginate([1, 2], { full: 15, last: 12 }).map((x) => x.length), [12]);
  });

  it('splits a grid the way it is written on the form', () => {
    assert.deepEqual(splitGrid(at('18S UJ 2348 0648')), { square: '18S UJ', e: '2348', n: '0648' });
    assert.deepEqual(splitGrid(null), { square: '', e: '', n: '' });
  });
});

describe('worksheetHtml', () => {
  const html = worksheetHtml({ kinds: ['units', 'lines', 'changes'], coa: COA, header: HEADER, fingerprint: coaFingerprint(COA), paper: 'a4' });

  it('is a print-ready document with no script, on the paper chosen', () => {
    assert.match(html, /^<!doctype html>/);
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /@page \{ size: A4 landscape; margin: 10mm; \}/);
    assert.match(html, /print-color-adjust: exact/);
  });

  it('puts the marking at the top and bottom of every page, with page n of m per worksheet', () => {
    const n = pages(html);
    assert.equal(n, 2 + 1 + 1, 'units: 2 pages; lines: 1; changes: 1');
    assert.equal(count(html, /<div class="banner">SECRET\/\/NOFORN<\/div>/g), n);
    assert.equal(count(html, /<div class="banner bottom">SECRET\/\/NOFORN<\/div>/g), n);
    assert.match(html, /<h1>Unit worksheet<\/h1><span class="pageno">Page 1 of 2<\/span>/);
    assert.match(html, /<h1>Unit worksheet<\/h1><span class="pageno">Page 2 of 2<\/span>/);
    assert.match(html, /<h1>Change sheet<\/h1><span class="pageno">Page 1 of 1<\/span>/);
    assert.equal(count(html, /class="signoff"/g), 3, 'a sign-off on the last page of each worksheet');
  });

  it('names the project, COA, version and DTG, escaping text from data', () => {
    assert.match(html, /Project: <b>Exercise &lt;IRON&gt;<\/b>/);
    assert.match(html, /COA: <b>COA 1 &lt;North&gt;<\/b>/);
    assert.match(html, new RegExp(`Version: <b class="fp">${coaFingerprint(COA)}</b>`));
    assert.match(html, /Printed: 251400ZNOV26/);
    assert.doesNotMatch(html, /<North>|<IRON>/);
  });

  it('shows the CSV column under each heading, and fills rows from the COA in grids as written', () => {
    assert.match(html, /<th>Name<small>label<\/small><\/th>/);
    assert.match(html, /<th>Unit template or symbol code<small>template \/ sidc<\/small><\/th>/);
    assert.match(html, /<td class="num">1<\/td><td>1 MRC<\/td><td>10061000001211000000<\/td><td class="grid">18S UJ<\/td><td class="grid">2310<\/td><td class="grid">0648<\/td><td>45<\/td><td>X<\/td><td>1 MRB<\/td>/);
    assert.match(html, /<td>PL GOLD<\/td><td>PL<\/td><td>F<\/td><td>H\+2<\/td><td>18S UJ 2200 0600; 18S UJ 2600 0600<\/td>/);
    assert.match(html, /<td>Arty<\/td><td>RING<\/td><td>H<\/td><td><\/td><td>18S UJ 2400 0500<\/td><td>12000<\/td>/);
    assert.match(html, /Printed with <b>20<\/b> units\. Count now:/);
    assert.match(html, /☐ add<\/span> <span>☐ change<\/span> <span>☐ remove/);
  });

  it('leaves COA and version to fill in on a blank worksheet', () => {
    const blank = worksheetHtml({ kinds: ['units'], header: HEADER });
    assert.equal(pages(blank), 1);
    assert.match(blank, /COA: <span class="blank wide"><\/span>/);
    assert.match(blank, /Version: <span class="blank"><\/span>/);
    assert.match(blank, /Number of units:/);
    assert.match(blank, /@page \{ size: letter landscape/);
  });
});

describe('CSV templates, filled in and typed back', () => {
  it('has the marking, the version, and the columns the importer reads', () => {
    const t = worksheetCsvTemplate('units', { header: HEADER, coa: COA, fingerprint: 'K7Q3-MD2A' });
    assert.equal(t, '﻿# SECRET//NOFORN // Exercise <IRON> // Unit worksheet template // 251400ZNOV26\r\n# version COA 1 <North>: K7Q3-MD2A\r\ncoa,label,template,sidc,mgrs,facing,hvt,higherFormation,staffComments\r\n');
    assert.match(worksheetCsvTemplate('changes', { header: HEADER, fingerprint: 'K7Q3-MD2A' }), /\r\n# version: K7Q3-MD2A\r\nlabel,action,mgrs,newLabel,template,sidc\r\n$/);
  });

  it('a filled-in unit and lines worksheet imports: template names, worksheet codes, grids', async () => {
    const h = createHarness();
    okValue(await h.dispatch('unit-template.create', { name: 'BMP-2 Coy', sidc: '10061000001211020000', label: 'MRC', hvt: false, weapons: [{ name: '30 mm', role: 'direct', maxRange: 2000 }] }));
    const units = worksheetCsvTemplate('units', { header: HEADER }) + 'COA 2,1 MRC,bmp-2 coy,,18S UJ 2348 0648,90,,,\r\nCOA 2,Recon,,10031000001213000000,18S UJ 2380 0700,,X,,screen\r\n';
    const read = readImportFile(units);
    assert.equal(read.ok, true, JSON.stringify(read.error));
    const lines = worksheetCsvTemplate('lines', { header: HEADER }) + 'COA 2,PL GOLD,pl,f,H+2,18S UJ 2200 0600; 18S UJ 2600 0600,\r\nCOA 2,Arty,RING,H,,18S UJ 2400 0500,12000\r\nCOA 2,Box,obj,,,"38.88 -77.03; 38.89 -77.03; 38.89 -77.02",\r\n';
    const readLines = readImportFile(lines);
    assert.equal(readLines.ok, true, JSON.stringify(readLines.error));
    const doc = { ...read.value.document, coas: [{ ...read.value.document.coas[0], graphics: readLines.value.document.coas[0].graphics }] };
    const { coas } = okValue(await h.dispatch('coa.import', { document: doc })); // HVT ticked "X" on the sheet
    const coa = okValue(await h.query('coa.get', { coaId: coas[0].id }));
    assert.deepEqual(coa.symbols.map((u) => [u.label, u.sidc, mgrsOf(u.position), u.facing ?? null, u.weapons?.length ?? 0]),
      [['1 MRC', '10061000001211020000', '18S UJ 2348 0648', 90, 1], ['Recon', '10031000001213000000', '18S UJ 2380 0700', null, 0]]);
    assert.deepEqual(coa.symbols.map((u) => u.hvt === true), [false, true]);
    assert.deepEqual(coa.graphics.map((g) => [g.label, g.kind, g.side, g.annotation ?? null]), [['PL GOLD', 'phaseLine', 'friendly', 'H+2'], ['Arty', 'rangeRing', 'hostile', null], ['Box', 'objective', 'friendly', null]]);
    assert.equal(mgrsOf(coa.graphics[1].center), '18S UJ 2400 0500');
    assert.deepEqual(KIND_CODES.PL, 'phaseLine');
  });

  it('names the row and column of a problem in a line row, and refuses a row that is both', async () => {
    const bad = readImportFile('coa,label,kind,points\nA,PL X,PL,18S UJ 2200 0600; 18S UJ 22 06 0\n');
    const e = errorOf(await createHarness().dispatch('coa.import', { document: bad.value.document }), 'IMPORT_INVALID');
    assert.equal(bad.value.where(e.details.problems[0].field), 'row 2, column points');
    const both = readImportFile('coa,label,kind,sidc,mgrs\nA,X,PL,10031000001211000000,18S UJ 2200 0600\n');
    assert.equal(both.ok, false);
    assert.deepEqual(both.error.details.problems.map((p) => p.field), ['row 2, column sidc']);
    const unknown = errorOf(await createHarness().dispatch('coa.import', { document: readImportFile('coa,label,template,mgrs\nA,X,Nope,18S UJ 2200 0600\n').value.document }), 'IMPORT_INVALID');
    assert.match(unknown.details.problems[0].reason, /no unit template is named "Nope" \(the project has none\)/);
  });

  it('a filled-in change sheet updates a COA, adding a unit by template name', async () => {
    const h = createHarness();
    okValue(await h.dispatch('unit-template.create', { name: 'BMP-2 Coy', sidc: '10061000001211020000', label: 'MRC' }));
    const coa = okValue(await h.dispatch('coa.create', { name: 'A' }));
    okValue(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: '10061000001211000000', position: { mgrs: '18S UJ 2348 0648' }, label: '1 MRC' }));
    const fp = coaFingerprint(okValue(await h.query('coa.get', { coaId: coa.id })));
    const sheet = worksheetCsvTemplate('changes', { header: HEADER, fingerprint: fp }) + '1 MRC,change,18S UJ 2350 0650,,,\r\n3 MRC,add,18S UJ 2400 0700,,BMP-2 Coy,\r\n';
    const { document } = readImportFile(sheet).value;
    const diff = okValue(await h.query('coa.diff', { coaId: coa.id, document }));
    assert.equal(diff.versionMatches, true);
    okValue(await h.dispatch('coa.update-from-file', { coaId: coa.id, expectedRevision: 2, document }));
    const after = okValue(await h.query('coa.get', { coaId: coa.id }));
    assert.deepEqual(after.symbols.map((u) => [u.label, u.sidc, mgrsOf(u.position)]), [['1 MRC', '10061000001211000000', '18S UJ 2350 0650'], ['3 MRC', '10061000001211020000', '18S UJ 2400 0700']]);
  });
});
