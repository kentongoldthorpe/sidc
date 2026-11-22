// Slice: symbol.add — SIDC, position, label and modifier rules, all observed through envelopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { InMemoryCoaRepository } from '../../src/adapters/persistence/in-memory-coa-repository.js';
import { err } from '../../src/shared/result.js';

const T1 = '2026-11-22T20:41:00.000Z';
const INFANTRY = '10031000001211000000';
const MISSING = Symbol('missing');

async function withCoa(options) {
  const h = createHarness(options);
  const coa = okValue(await h.dispatch('coa.create', { name: 'Envelopment' }));
  h.takeEvents();
  h.clock.advance(60_000);
  return { h, coa };
}

const withoutMissing = (payload) => {
  const body = { ...payload };
  for (const [key, value] of Object.entries(body)) if (value === MISSING) delete body[key];
  return body;
};

/** symbol.add on a fresh COA with sensible defaults overridden by `fields`. */
async function add(fields) {
  const { h, coa } = await withCoa();
  const reply = await h.dispatch('symbol.add', withoutMissing({
    coaId: coa.id, expectedRevision: 1, sidc: INFANTRY, position: { lat: 34.05, lng: -117.6 }, ...fields,
  }));
  return { h, coa, reply };
}

describe('symbol.add', () => {
  it('adds a symbol: replies with it and the new revision, publishes symbol.added, coa.get shows it', async () => {
    const { h, coa, reply } = await add({ label: 'A/1-5', modifiers: { higherFormation: '1-5 INF' } });
    const value = okValue(reply);

    assert.match(value.symbol.id, /^sym-/);
    assert.deepEqual(value, {
      coaId: coa.id, revision: 2,
      symbol: { id: value.symbol.id, sidc: INFANTRY, position: { lat: 34.05, lng: -117.6 }, label: 'A/1-5', modifiers: { higherFormation: '1-5 INF' } },
    });
    assert.deepEqual(h.takeEvents().map((e) => [e.type, e.v, e.payload]), [['symbol.added', 1, value]]);

    const stored = okValue(await h.query('coa.get', { coaId: coa.id }));
    assert.deepEqual([stored.revision, stored.updatedAt, stored.symbols], [2, T1, [value.symbol]]);
    assert.equal(okValue(await h.query('coa.list'))[0].symbolCount, 1);
  });

  it('defaults label to empty and modifiers to none', async () => {
    const { symbol } = okValue((await add({})).reply);
    assert.deepEqual([symbol.label, symbol.modifiers], ['', {}]);
  });

  it('appends symbols in order, each with its own id', async () => {
    const { h, coa } = await withCoa();
    const base = { coaId: coa.id, sidc: INFANTRY, position: { lat: 0, lng: 0 } };
    const first = okValue(await h.dispatch('symbol.add', { ...base, expectedRevision: 1, label: 'first' }));
    const second = okValue(await h.dispatch('symbol.add', { ...base, expectedRevision: 2, label: 'second' }));
    assert.equal(second.revision, 3);
    assert.notEqual(first.symbol.id, second.symbol.id);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })).symbols.map((s) => s.label), ['first', 'second']);
  });

  describe('SIDC', () => {
    for (const [name, sidc, stored] of [
      ['20-digit 2525D/APP-6D', INFANTRY, INFANTRY],
      ['30-digit 2525E/APP-6E', '130310000016110000000000000000', '130310000016110000000000000000'],
      ['15-character 2525C', 'SFGPUCI----D---', 'SFGPUCI----D---'],
      ['2525C with * placeholders', 'SFGP*********** ', 'SFGP***********'],
      ['surrounding whitespace (trimmed)', `  ${INFANTRY}\n`, INFANTRY],
      ['lower-case 2525C (upper-cased)', 'shgpucaa--*****', 'SHGPUCAA--*****'],
    ]) {
      it(`accepts ${name}`, async () => {
        assert.equal(okValue((await add({ sidc })).reply).symbol.sidc, stored);
      });
    }

    for (const [name, sidc] of [
      ['missing', MISSING], ['empty', ''], ['blank', '   '], ['a number', 10031000001211000000], ['null', null],
      ['19 digits', INFANTRY.slice(1)], ['21 digits', `${INFANTRY}0`], ['29 digits', '1'.repeat(29)], ['31 digits', '1'.repeat(31)],
      ['20 characters with a letter', '10031000001211000A00'],
      ['14 characters', 'SFGPUCI----D--'], ['16 characters', 'SFGPUCI----D----'],
      ['15 characters with an illegal character', 'SFGPUCI----D-!-'],
    ]) {
      it(`rejects ${name} with VALIDATION_FAILED on sidc`, async () => {
        const { h, coa, reply } = await add({ sidc });
        assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), ['sidc']);
        assert.deepEqual(h.takeEvents(), []);
        assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })).symbols, []);
      });
    }
  });

  describe('position', () => {
    for (const [name, position, stored] of [
      ['the north pole', { lat: 90, lng: 0 }, { lat: 90, lng: 0 }],
      ['the south pole', { lat: -90, lng: 0 }, { lat: -90, lng: 0 }],
      ['lng just under 180', { lat: 0, lng: 179.999 }, { lat: 0, lng: 179.999 }],
      ['lng 180 (wraps to -180)', { lat: 0, lng: 180 }, { lat: 0, lng: -180 }],
      ['lng -180', { lat: 0, lng: -180 }, { lat: 0, lng: -180 }],
      ['lng 190 (wraps to -170)', { lat: 0, lng: 190 }, { lat: 0, lng: -170 }],
      ['lng -190 (wraps to 170)', { lat: 0, lng: -190 }, { lat: 0, lng: 170 }],
      ['lng 540 (wraps to -180)', { lat: 0, lng: 540 }, { lat: 0, lng: -180 }],
    ]) {
      it(`accepts ${name}`, async () => {
        assert.deepEqual(okValue((await add({ position })).reply).symbol.position, stored);
      });
    }

    for (const [name, position, fields] of [
      ['missing', MISSING, ['position']],
      ['null', null, ['position']],
      ['an array', [34, -117], ['position']],
      ['a string', '34,-117', ['position']],
      ['missing lat', { lng: 0 }, ['position.lat']],
      ['missing lng', { lat: 0 }, ['position.lng']],
      ['string lat', { lat: '34', lng: 0 }, ['position.lat']],
      ['lat above 90', { lat: 90.0001, lng: 0 }, ['position.lat']],
      ['lat below -90', { lat: -91, lng: 0 }, ['position.lat']],
      ['string lng', { lat: 0, lng: 'east' }, ['position.lng']],
      ['an extra key', { lat: 0, lng: 0, alt: 10 }, ['position.alt']],
      ['both coordinates bad', { lat: 100, lng: null }, ['position.lat', 'position.lng']],
    ]) {
      it(`rejects ${name} with VALIDATION_FAILED`, async () => {
        const { reply } = await add({ position });
        assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), fields);
      });
    }
  });

  describe('label', () => {
    it('is trimmed and may be 30 characters', async () => {
      assert.equal(okValue((await add({ label: `  ${'x'.repeat(30)}  ` })).reply).symbol.label, 'x'.repeat(30));
    });

    for (const [name, label] of [['over 30 characters', 'x'.repeat(31)], ['not a string', 5]]) {
      it(`rejects a label ${name}`, async () => {
        assert.deepEqual(problemFields(errorOf((await add({ label })).reply, 'VALIDATION_FAILED')), ['label']);
      });
    }
  });

  describe('modifiers', () => {
    it('accepts every allowed modifier, trimming text and dropping empty ones', async () => {
      const modifiers = {
        higherFormation: ' 1-5 INF ', additionalInformation: 'Recon', staffComments: '',
        dtg: '221940ZNOV26', quantity: '12', direction: 359.5,
      };
      assert.deepEqual(okValue((await add({ modifiers })).reply).symbol.modifiers, {
        higherFormation: '1-5 INF', additionalInformation: 'Recon', dtg: '221940ZNOV26', quantity: '12', direction: 359.5,
      });
    });

    for (const [name, modifiers, fields] of [
      ['not an object', 'fast', ['modifiers']],
      ['an array', [], ['modifiers']],
      ['an unknown modifier', { speed: '10' }, ['modifiers.speed']],
      ['text over 50 characters', { staffComments: 'x'.repeat(51) }, ['modifiers.staffComments']],
      ['non-string text', { higherFormation: 1 }, ['modifiers.higherFormation']],
      ['quantity with letters', { quantity: '1a' }, ['modifiers.quantity']],
      ['quantity over 9 digits', { quantity: '1234567890' }, ['modifiers.quantity']],
      ['numeric quantity', { quantity: 12 }, ['modifiers.quantity']],
      ['direction 360', { direction: 360 }, ['modifiers.direction']],
      ['negative direction', { direction: -1 }, ['modifiers.direction']],
      ['string direction', { direction: '45' }, ['modifiers.direction']],
    ]) {
      it(`rejects ${name}`, async () => {
        assert.deepEqual(problemFields(errorOf((await add({ modifiers })).reply, 'VALIDATION_FAILED')), fields);
      });
    }
  });

  it('reports every problem at once, in payload order', async () => {
    const { reply } = await add({
      coaId: ' ', expectedRevision: 0, sidc: 'nope', position: { lat: 95, lng: 0 }, label: 'x'.repeat(31), modifiers: { foo: 1 },
    });
    assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')),
      ['coaId', 'expectedRevision', 'sidc', 'position.lat', 'label', 'modifiers.foo']);
  });

  it('rejects unknown payload fields and a missing expectedRevision', async () => {
    assert.deepEqual(problemFields(errorOf((await add({ colour: 'red' })).reply, 'VALIDATION_FAILED')), ['colour']);
    assert.deepEqual(problemFields(errorOf((await add({ expectedRevision: MISSING })).reply, 'VALIDATION_FAILED')), ['expectedRevision']);
  });

  it('refuses a stale expectedRevision with CONFLICT and adds nothing', async () => {
    const { h, coa } = await withCoa();
    okValue(await h.dispatch('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'B' }));
    h.takeEvents();
    const error = errorOf(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INFANTRY, position: { lat: 0, lng: 0 } }), 'CONFLICT');
    assert.deepEqual(error.details, { coaId: coa.id, expectedRevision: 1, actualRevision: 2 });
    assert.deepEqual(h.takeEvents(), []);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })).symbols, []);
  });

  it('is NOT_FOUND for an unknown COA', async () => {
    const { reply } = await add({ coaId: 'coa-404' });
    assert.deepEqual(errorOf(reply, 'NOT_FOUND').details, { coaId: 'coa-404' });
  });

  it('validates before looking the COA up', async () => {
    errorOf((await add({ coaId: 'coa-404', sidc: '' })).reply, 'VALIDATION_FAILED');
  });

  it('passes a storage failure through and publishes nothing', async () => {
    const repo = new InMemoryCoaRepository();
    const { h, coa } = await withCoa({ coaRepository: repo });
    repo.save = async () => err('STORAGE_QUOTA_EXCEEDED', 'Storage is full');
    errorOf(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INFANTRY, position: { lat: 0, lng: 0 } }), 'STORAGE_QUOTA_EXCEEDED');
    assert.deepEqual(h.takeEvents(), []);
  });

  it('rejects an unsupported payload version', async () => {
    const { h, coa } = await withCoa();
    errorOf(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INFANTRY, position: { lat: 0, lng: 0 } }, { v: 2 }), 'UNSUPPORTED_VERSION');
  });

  it('carries added symbols into a duplicate with fresh ids', async () => {
    const { h, coa, reply } = await add({ label: 'A' });
    const { symbol } = okValue(reply);
    const copy = okValue(await h.dispatch('coa.duplicate', { coaId: coa.id }));
    assert.deepEqual(copy.symbols.map(({ id, ...rest }) => rest), [{ sidc: symbol.sidc, position: symbol.position, label: 'A', modifiers: {} }]);
    assert.notEqual(copy.symbols[0].id, symbol.id);
  });
});
