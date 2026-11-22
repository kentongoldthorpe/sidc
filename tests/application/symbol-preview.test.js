// Slice: symbol.preview, and renderer-backed INVALID_SIDC in symbol.add / symbol.update.
// Tested through envelopes; the renderer is the StubRenderer driven port double.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields, UNKNOWN_SIDC } from '../support/app-harness.js';
import { StubRenderer } from '../support/stub-renderer.js';

const INFANTRY = '10031000001211000000';

describe('symbol.preview', () => {
  it('renders a recognised SIDC: svg, valid, no warnings, size and anchor', async () => {
    const preview = okValue(await createHarness().query('symbol.preview', { sidc: INFANTRY, label: 'A/1-5', modifiers: { higherFormation: '1-5 INF' } }));
    assert.deepEqual(Object.keys(preview).sort(), ['anchor', 'height', 'svg', 'valid', 'warnings', 'width']);
    assert.equal(preview.valid, true);
    assert.deepEqual(preview.warnings, []);
    assert.ok(preview.svg.includes('A/1-5') && preview.svg.includes('1-5 INF'), 'label and modifiers reach the renderer');
  });

  it('normalises the SIDC before rendering', async () => {
    const preview = okValue(await createHarness().query('symbol.preview', { sidc: ` ${'sfgpuci----d---'} ` }));
    assert.equal(preview.valid, true);
    assert.ok(preview.svg.includes('SFGPUCI----D---'));
  });

  it('reports a well-formed but unrecognised SIDC as invalid, with the renderer\'s warnings', async () => {
    const preview = okValue(await createHarness().query('symbol.preview', { sidc: UNKNOWN_SIDC }));
    assert.equal(preview.valid, false);
    assert.ok(preview.warnings.length > 0);
    assert.match(preview.svg, /^<svg/);
  });

  for (const sidc of ['nope', '', '1234']) {
    it(`still previews a malformed SIDC (${JSON.stringify(sidc)}), invalid with a format warning`, async () => {
      const preview = okValue(await createHarness().query('symbol.preview', { sidc }));
      assert.equal(preview.valid, false);
      assert.ok(preview.warnings.some((w) => /sidc/i.test(w)), JSON.stringify(preview.warnings));
      assert.match(preview.svg, /^<svg/);
    });
  }

  it('defaults size to 40 and draws bigger for a bigger size', async () => {
    const h = createHarness();
    const byDefault = okValue(await h.query('symbol.preview', { sidc: INFANTRY }));
    assert.deepEqual(okValue(await h.query('symbol.preview', { sidc: INFANTRY, size: 40 })), byDefault);
    assert.ok(okValue(await h.query('symbol.preview', { sidc: INFANTRY, size: 120 })).width > byDefault.width);
  });

  for (const [name, payload, fields] of [
    ['a non-string sidc', { sidc: 5 }, ['sidc']],
    ['a label over 30 characters', { sidc: INFANTRY, label: 'x'.repeat(31) }, ['label']],
    ['an unknown modifier', { sidc: INFANTRY, modifiers: { speed: '1' } }, ['modifiers.speed']],
    ['size below 10', { sidc: INFANTRY, size: 9 }, ['size']],
    ['size above 200', { sidc: INFANTRY, size: 201 }, ['size']],
    ['a non-number size', { sidc: INFANTRY, size: '40' }, ['size']],
    ['a position (not part of a preview)', { sidc: INFANTRY, position: { lat: 0, lng: 0 } }, ['position']],
    ['a missing sidc', {}, ['sidc']],
  ]) {
    it(`rejects ${name} with VALIDATION_FAILED`, async () => {
      assert.deepEqual(problemFields(errorOf(await createHarness().query('symbol.preview', payload), 'VALIDATION_FAILED')), fields);
    });
  }

  it('needs no COA and publishes nothing', async () => {
    const h = createHarness();
    okValue(await h.query('symbol.preview', { sidc: INFANTRY }));
    assert.deepEqual(h.takeEvents(), []);
  });
});

describe('INVALID_SIDC from the renderer', () => {
  async function withCoa() {
    const h = createHarness();
    const coa = okValue(await h.dispatch('coa.create', { name: 'COA' }));
    const { symbol } = okValue(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INFANTRY, position: { lat: 0, lng: 0 } }));
    h.takeEvents();
    return { h, coa: okValue(await h.query('coa.get', { coaId: coa.id })), symbol };
  }

  it('symbol.add refuses a well-formed SIDC the renderer does not recognise, and adds nothing', async () => {
    const { h, coa } = await withCoa();
    const error = errorOf(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 2, sidc: ` ${UNKNOWN_SIDC} `, position: { lat: 0, lng: 0 } }), 'INVALID_SIDC');
    assert.equal(error.details.sidc, UNKNOWN_SIDC);
    assert.ok(error.details.warnings.length > 0);
    assert.deepEqual(h.takeEvents(), []);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })), coa);
  });

  it('symbol.update refuses changing to an unrecognised SIDC, and changes nothing', async () => {
    const { h, coa, symbol } = await withCoa();
    errorOf(await h.dispatch('symbol.update', { coaId: coa.id, expectedRevision: 2, symbolId: symbol.id, sidc: UNKNOWN_SIDC }), 'INVALID_SIDC');
    assert.deepEqual(h.takeEvents(), []);
    assert.deepEqual(okValue(await h.query('coa.get', { coaId: coa.id })), coa);
  });

  it('symbol.update consults the renderer only when the SIDC is being changed', async () => {
    const renderer = new StubRenderer();
    const rendered = [];
    const render = renderer.render.bind(renderer);
    renderer.render = (sidc, options) => { rendered.push(sidc); return render(sidc, options); };
    const h = createHarness({ symbolRenderer: renderer });
    const coa = okValue(await h.dispatch('coa.create', { name: 'COA' }));
    const { symbol } = okValue(await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 1, sidc: INFANTRY, position: { lat: 0, lng: 0 } }));
    assert.deepEqual(rendered, [INFANTRY]);

    okValue(await h.dispatch('symbol.update', { coaId: coa.id, expectedRevision: 2, symbolId: symbol.id, label: 'new' }));
    assert.deepEqual(rendered, [INFANTRY]);
    okValue(await h.dispatch('symbol.update', { coaId: coa.id, expectedRevision: 3, symbolId: symbol.id, sidc: 'SFGPUCI----D---' }));
    assert.deepEqual(rendered, [INFANTRY, 'SFGPUCI----D---']);
  });

  it('reports VALIDATION_FAILED, not INVALID_SIDC, when the payload has other problems too', async () => {
    const { h, coa } = await withCoa();
    const reply = await h.dispatch('symbol.add', { coaId: coa.id, expectedRevision: 2, sidc: UNKNOWN_SIDC, position: { lat: 0, lng: 0 }, label: 'x'.repeat(31) });
    assert.deepEqual(problemFields(errorOf(reply, 'VALIDATION_FAILED')), ['label']);
  });
});
