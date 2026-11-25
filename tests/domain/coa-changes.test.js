// E6-3: version fingerprints and changes by name (pure domain).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCoa, addSymbol, addGraphic, moveSymbol } from '../../src/domain/coa.js';
import { coaFingerprint, readFingerprint, planChanges, applyPlan, parseTransfer } from '../../src/domain/coa-changes.js';

const NOW = '2026-11-25T08:00:00.000Z';
const INF = '10031000001211000000';
const ARM = '10031000001205000000';
const v = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value.coa; };

function base() {
  let c = v(createCoa({ id: 'c1', name: 'COA 1' }, { now: NOW }));
  c = v(addSymbol(c, { symbolId: 's1', sidc: INF, position: { lat: 38.89, lng: -77.03 }, label: '1 MRC' }, { now: NOW }));
  c = v(addSymbol(c, { symbolId: 's2', sidc: INF, position: { lat: 38.9, lng: -77.0 }, label: '2 MRC', modifiers: { higherFormation: '1 MRB' } }, { now: NOW }));
  c = v(addSymbol(c, { symbolId: 's3', sidc: INF, position: { lat: 38.91, lng: -77.01 }, label: '' }, { now: NOW }));
  c = v(addGraphic(c, { graphicId: 'g1', kind: 'phaseLine', label: 'PL GOLD', points: [{ lat: 38.8, lng: -77.1 }, { lat: 38.8, lng: -76.9 }] }, { now: NOW }));
  return c;
}
let n = 0;
const opts = (more = {}) => ({ newId: (p) => `${p}-new-${++n}`, now: NOW, ...more });

describe('coaFingerprint', () => {
  it('is a short code that is the same for the same content, whatever the order, ids or revision', () => {
    const c = base();
    const fp = coaFingerprint(c);
    assert.match(fp, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const shuffled = { ...c, revision: 99, updatedAt: 'later', symbols: [...c.symbols].reverse().map((s, i) => ({ ...s, id: `x${i}` })) };
    assert.equal(coaFingerprint(shuffled), fp);
  });
  it('changes with any change of content, even a 1 m move', () => {
    const c = base();
    const moved = v(moveSymbol(c, { symbolId: 's1', position: { lat: 38.89001, lng: -77.03 } }, { now: NOW }));
    assert.notEqual(coaFingerprint(moved), coaFingerprint(c));
    assert.notEqual(coaFingerprint({ ...c, name: 'COA 2' }), coaFingerprint(c));
  });
  it('reads a fingerprint as typed from paper', () => {
    assert.equal(readFingerprint(' k7q3 md2a '), 'K7Q3-MD2A');
    assert.equal(readFingerprint('K7Q3-MD2A'), 'K7Q3-MD2A');
    assert.equal(readFingerprint('O1I2L3XX'), '0112-13XX');
    assert.equal(readFingerprint('K7Q3-MD2'), null);
    assert.equal(readFingerprint('K7Q3-MD2U'), null, 'U is not used');
  });
});

describe('planChanges', () => {
  it('matches by name (ignoring case), changes only the fields given, and adds what is new', () => {
    const c = base();
    const plan = planChanges(c, { units: [
      { at: 'u[0]', name: '1 mrc', fields: { position: { lat: 38.891, lng: -77.03 } } },
      { at: 'u[1]', name: '2 MRC', fields: { modifiers: { staffComments: 'reserve' } } },
      { at: 'u[2]', name: 'Recon', fields: { sidc: ARM, position: { lat: 38.95, lng: -77.05 } } },
    ] }, opts());
    assert.deepEqual(plan.problems, []);
    assert.deepEqual(plan.changes.map((ch) => [ch.action, ch.name, ch.fields ?? []]), [['change', '1 MRC', ['position']], ['change', '2 MRC', ['modifiers']], ['add', 'Recon', []]]);
    assert.equal(plan.changes[0].movedMetres, 111);
    const two = plan.result.symbols.find((s) => s.label === '2 MRC');
    assert.deepEqual(two.modifiers, { higherFormation: '1 MRB', staffComments: 'reserve' }, 'other modifiers kept');
    assert.equal(plan.result.symbols.length, 4);
  });

  it('counts items that would not change, and flags a move of 5 km or more for checking', () => {
    const c = base();
    const plan = planChanges(c, { units: [
      { at: 'u[0]', name: '1 MRC', fields: { position: { lat: 38.89, lng: -77.03 }, sidc: INF } },
      { at: 'u[1]', name: '2 MRC', fields: { position: { lat: 39.0, lng: -77.0 } } },
    ] }, opts());
    assert.equal(plan.unchanged, 1);
    assert.match(plan.changes[0].check, /^moved 11\.1 km: check the grid$/);
  });

  it('removes and renames by name, and refuses what does not fit, by path', () => {
    const c = base();
    const plan = planChanges(c, { units: [
      { at: 'u[0]', action: 'remove', name: '2 MRC' },
      { at: 'u[1]', action: 'change', name: '1 MRC', newName: '1 MRC (-)' },
    ], lines: [{ at: 'l[0]', action: 'change', name: 'pl gold', fields: { annotation: 'H+2' } }] }, opts());
    assert.deepEqual(plan.problems, []);
    assert.deepEqual(plan.changes.map((ch) => [ch.kind, ch.action, ch.name, ch.newName ?? null]), [['unit', 'remove', '2 MRC', null], ['unit', 'change', '1 MRC', '1 MRC (-)'], ['line', 'change', 'PL GOLD', null]]);
    const bad = planChanges(c, { units: [
      { at: 'u[0]', action: 'change', name: 'Ghost', fields: {} },
      { at: 'u[1]', action: 'add', name: '1 MRC', fields: { sidc: INF, position: { lat: 1, lng: 1 } } },
      { at: 'u[2]', action: 'add', name: 'New', fields: { sidc: INF } },
      { at: 'u[3]', name: 'Twice', fields: { sidc: INF, position: { lat: 1, lng: 1 } } },
      { at: 'u[4]', name: 'twice', fields: { sidc: INF, position: { lat: 1, lng: 1 } } },
      { at: 'u[5]', action: 'remove', fields: {} },
      { at: 'u[6]', name: '2 MRC', fields: { position: { lat: 99, lng: 0 } } },
    ] }, opts());
    assert.deepEqual(bad.problems.map((p) => p.field), ['u[0].name', 'u[1].name', 'u[2].position', 'u[4].name', 'u[5].name', 'u[6].position.lat']);
    assert.match(bad.problems[0].reason, /"Ghost" is not in the COA/);
  });

  it('refuses to update by a name that two items share', () => {
    let c = base();
    c = v(addSymbol(c, { symbolId: 's9', sidc: INF, position: { lat: 1, lng: 1 }, label: '1 mrc' }, { now: NOW }));
    const plan = planChanges(c, { units: [{ at: 'u[0]', name: '1 MRC', fields: { position: { lat: 2, lng: 2 } } }] }, opts());
    assert.match(plan.problems[0].reason, /^2 units are named "1 MRC" in the COA/);
  });

  it('replace removes named items the file does not list, of the kinds it covers only; unnamed items stay', () => {
    const c = base();
    const plan = planChanges(c, { units: [{ at: 'u[0]', name: '1 MRC', fields: {} }] }, opts({ mode: 'replace', covers: { units: true, lines: false } }));
    assert.deepEqual(plan.changes.map((ch) => [ch.action, ch.name, ch.notInFile ?? false]), [['remove', '2 MRC', true]]);
    assert.equal(plan.kept, 1, 'the unnamed unit');
    assert.equal(plan.result.graphics.length, 1, 'lines untouched: a CSV has none');
  });
});

describe('applyPlan', () => {
  it('saves one new revision with a transfer record (versions before and after, counts, who), and nothing when nothing changes', () => {
    const c = base();
    const plan = planChanges(c, { units: [{ at: 'u[0]', name: '1 MRC', fields: { position: { lat: 38.891, lng: -77.03 } } }] }, opts());
    const applied = applyPlan(c, plan, { transfer: { file: 'sheet.csv', enteredBy: 'SGT A', checkedBy: 'CPL B' }, basedOn: coaFingerprint(c), now: NOW });
    const { coa, record, events } = applied.value;
    assert.equal(coa.revision, c.revision + 1);
    assert.deepEqual(record, { at: NOW, file: 'sheet.csv', enteredBy: 'SGT A', checkedBy: 'CPL B', basedOn: coaFingerprint(c), from: coaFingerprint(c), to: coaFingerprint(coa), added: 0, changed: 1, removed: 0 });
    assert.deepEqual(coa.transfers, [record]);
    assert.deepEqual(events.map((e) => e.type), ['coa.changes-applied']);
    const none = applyPlan(c, planChanges(c, { units: [] }, opts()), { now: NOW });
    assert.equal(none.value.coa, c);
    assert.deepEqual(none.value.events, []);
  });
  it('checks the words of a transfer', () => {
    assert.deepEqual(parseTransfer({ file: ' a.csv ', enteredBy: '' }).value, { file: 'a.csv' });
    assert.deepEqual(parseTransfer({ who: 'x', checkedBy: 'y'.repeat(121) }).problems.map((p) => p.field), ['transfer.who', 'transfer.checkedBy']);
  });
});
