// The app client: the UI's single way into the application. Tested at its boundary:
// client calls in → envelopes to the app; replies and events → Results and remembered revisions.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAppClient } from '../../../src/adapters/ui/app-client.js';
import { createApplication } from '../../../src/application/create-application.js';
import { InMemoryCoaRepository } from '../../../src/adapters/persistence/in-memory-coa-repository.js';
import { createReply, isEnvelope } from '../../../src/shared/envelope.js';
import { ok } from '../../../src/shared/result.js';
import { FixedClock } from '../../support/fixed-clock.js';
import { SequenceIdGenerator } from '../../support/sequence-id-generator.js';
import { StubRenderer } from '../../support/stub-renderer.js';

const INFANTRY = '10031000001211000000';
const NOW = '2026-11-22T20:40:00.000Z';

/** A real application plus one or more clients on it. */
function realApp() {
  const clock = new FixedClock(NOW);
  const ids = new SequenceIdGenerator();
  const app = createApplication({ clock, ids, coaRepository: new InMemoryCoaRepository(), symbolRenderer: new StubRenderer() });
  return { app, newClient: (source) => createAppClient(app, { clock, ids, source }) };
}

const value = (result) => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const errorCode = (result) => { assert.equal(result.ok, false, 'expected a failure'); return result.error.code; };

describe('app client with the real application', () => {
  it('creates a COA and remembers its revision', async () => {
    const client = realApp().newClient();
    const coa = value(await client.send('coa.create', { name: 'A' }));
    assert.equal(client.revisionOf(coa.id), 1);
  });

  it('fills in expectedRevision for commands that need it', async () => {
    const client = realApp().newClient();
    const coa = value(await client.send('coa.create', { name: 'A' }));
    const updated = value(await client.send('coa.update', { coaId: coa.id, name: 'B' }));
    assert.deepEqual([updated.name, updated.revision, client.revisionOf(coa.id)], ['B', 2, 2]);
  });

  it('does not add expectedRevision to commands that do not take it', async () => {
    const client = realApp().newClient();
    const coa = value(await client.send('coa.create', { name: 'A' }));
    assert.equal(value(await client.send('coa.duplicate', { coaId: coa.id })).name, 'A (copy)');
  });

  it('runs rapid commands on one COA in order, without spurious CONFLICTs', async () => {
    const client = realApp().newClient();
    const coa = value(await client.send('coa.create', { name: 'A' }));
    const labels = ['1', '2', '3', '4', '5'];
    const results = await Promise.all(labels.map((label) =>
      client.send('symbol.add', { coaId: coa.id, sidc: INFANTRY, position: { lat: 0, lng: 0 }, label })));
    assert.deepEqual(results.map((r) => value(r).revision), [2, 3, 4, 5, 6]);
    const stored = value(await client.ask('coa.get', { coaId: coa.id }));
    assert.deepEqual(stored.symbols.map((s) => s.label), labels);
  });

  it('looks the revision up first when it does not know it yet', async () => {
    const { newClient } = realApp();
    const coa = value(await newClient().send('coa.create', { name: 'A' }));
    const late = newClient();
    late.close(); // simulate a client that missed the creation event
    value(await late.send('coa.update', { coaId: coa.id, name: 'B' }));
  });

  it('learns revisions from events caused by other clients', async () => {
    const { newClient } = realApp();
    const a = newClient('ui.a');
    const b = newClient('ui.b');
    const coa = value(await a.send('coa.create', { name: 'A' }));
    value(await b.send('coa.update', { coaId: coa.id, name: 'B' }));
    assert.equal(a.revisionOf(coa.id), 2);
    value(await a.send('coa.update', { coaId: coa.id, name: 'C' }));
  });

  it('respects an explicit expectedRevision, and does not adopt the newer revision from a CONFLICT', async () => {
    const client = realApp().newClient();
    const coa = value(await client.send('coa.create', { name: 'A' }));
    value(await client.send('coa.update', { coaId: coa.id, name: 'B' }));
    assert.equal(errorCode(await client.send('coa.update', { coaId: coa.id, expectedRevision: 1, name: 'stale' })), 'CONFLICT');
    assert.equal(client.revisionOf(coa.id), 2);
  });

  it('learns every revision from coa.list', async () => {
    const { newClient } = realApp();
    const writer = newClient();
    const a = value(await writer.send('coa.create', { name: 'A' }));
    const b = value(await writer.send('coa.create', { name: 'B' }));
    value(await writer.send('coa.update', { coaId: b.id, name: 'B2' }));
    const reader = newClient();
    reader.close();
    value(await reader.ask('coa.list', {}));
    assert.deepEqual([reader.revisionOf(a.id), reader.revisionOf(b.id)], [1, 2]);
  });

  it('forgets a COA it deleted (from the reply, even without events)', async () => {
    const client = realApp().newClient();
    const coa = value(await client.send('coa.create', { name: 'A' }));
    client.close();
    value(await client.send('coa.delete', { coaId: coa.id }));
    assert.equal(client.revisionOf(coa.id), undefined);
  });

  it('forgets a COA another client deleted (from the coa.deleted event)', async () => {
    const { newClient } = realApp();
    const a = newClient();
    const b = newClient();
    const coa = value(await a.send('coa.create', { name: 'A' }));
    value(await b.send('coa.delete', { coaId: coa.id }));
    assert.equal(a.revisionOf(coa.id), undefined);
  });

  it('returns the app\'s failures as Results and never throws', async () => {
    const client = realApp().newClient();
    assert.equal(errorCode(await client.send('coa.update', { coaId: 'coa-404', name: 'B' })), 'NOT_FOUND');
    assert.equal(errorCode(await client.send('coa.explode', {})), 'UNKNOWN_MESSAGE_TYPE');
    assert.equal(errorCode(await client.send('coa.create', { name: undefined })), 'INVALID_ENVELOPE');
    assert.equal(errorCode(await client.ask('coa.get', { coaId: () => 1 })), 'INVALID_ENVELOPE');
  });

  it('keeps going after a failed command in the same COA queue', async () => {
    const client = realApp().newClient();
    const coa = value(await client.send('coa.create', { name: 'A' }));
    const [bad, good] = await Promise.all([
      client.send('coa.update', { coaId: coa.id, name: '' }),
      client.send('coa.update', { coaId: coa.id, name: 'B' }),
    ]);
    assert.equal(errorCode(bad), 'VALIDATION_FAILED');
    assert.equal(value(good).revision, 2);
  });

  it('passes subscriptions through to the app', async () => {
    const client = realApp().newClient();
    const seen = [];
    const off = client.subscribe('coa.*', (e) => seen.push(e.type));
    await client.send('coa.create', { name: 'A' });
    off();
    await client.send('coa.create', { name: 'B' });
    assert.deepEqual(seen, ['coa.created']);
  });
});

describe('app client envelopes (recording fake app)', () => {
  /** A fake app whose replies the test releases by hand. */
  function fakeApp() {
    const sent = [];
    const pending = [];
    const answer = (envelope) => new Promise((resolve) => {
      pending.push(() => resolve(createReply(envelope, ok({ id: 'x', revision: 1 }), { id: `r-${sent.length}`, now: NOW })));
    });
    return {
      sent, release: () => pending.shift()(),
      app: {
        dispatch: (e) => { sent.push(e); return answer(e); },
        query: (e) => { sent.push(e); return answer(e); },
        subscribe: () => () => {},
      },
    };
  }
  const client = (app, source) => createAppClient(app, { clock: new FixedClock(NOW), ids: new SequenceIdGenerator(), source });

  it('builds valid envelopes: kind from the message catalogue, v1, ids and time from the ports, meta.source', async () => {
    const fake = fakeApp();
    const c = client(fake.app, 'ui.list');
    const done = [c.send('coa.create', { name: 'A' }), c.ask('coa.list', {}), c.send('coa.create', { name: 'B' }, { source: 'ui.map' })];
    fake.release(); fake.release(); fake.release();
    await Promise.all(done);
    for (const e of fake.sent) assert.ok(isEnvelope(e));
    assert.deepEqual(fake.sent.map((e) => [e.kind, e.type, e.v, e.at, e.meta.source]), [
      ['command', 'coa.create', 1, NOW, 'ui.list'],
      ['query', 'coa.list', 1, NOW, 'ui.list'],
      ['command', 'coa.create', 1, NOW, 'ui.map'],
    ]);
    assert.equal(new Set(fake.sent.map((e) => e.id)).size, 3);
  });

  it('keeps the newest revision when an older one arrives late (slow query reply after an event)', async () => {
    const fake = fakeApp();
    let emit;
    fake.app.subscribe = (_pattern, fn) => { emit = fn; return () => {}; };
    const c = client(fake.app);
    const slowGet = c.ask('coa.get', { coaId: 'x' });      // the fake will answer { id: 'x', revision: 1 }
    emit({ type: 'symbol.added', payload: { coaId: 'x', revision: 3 } });
    fake.release();
    await slowGet;
    assert.equal(c.revisionOf('x'), 3);
  });

  it('defaults meta.source to "ui"', async () => {
    const fake = fakeApp();
    const done = client(fake.app).send('coa.create', { name: 'A' });
    fake.release();
    await done;
    assert.equal(fake.sent[0].meta.source, 'ui');
  });

  it('serialises commands for the same COA but not across different COAs', async () => {
    const fake = fakeApp();
    const c = client(fake.app);
    const first = c.send('coa.duplicate', { coaId: 'coa-a' });
    const sameCoa = c.send('coa.duplicate', { coaId: 'coa-a' });
    const otherCoa = c.send('coa.duplicate', { coaId: 'coa-b' });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(fake.sent.map((e) => e.payload.coaId), ['coa-a', 'coa-b'], 'second coa-a command must wait');
    fake.release(); await first;
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(fake.sent.map((e) => e.payload.coaId), ['coa-a', 'coa-b', 'coa-a']);
    fake.release(); fake.release();
    await Promise.all([sameCoa, otherCoa]);
  });

  it('requires an app, a clock and an id generator', () => {
    const { app } = fakeApp();
    assert.throws(() => createAppClient(undefined, { clock: new FixedClock(), ids: new SequenceIdGenerator() }), TypeError);
    assert.throws(() => createAppClient(app, { ids: new SequenceIdGenerator() }), TypeError);
    assert.throws(() => createAppClient(app, { clock: new FixedClock() }), TypeError);
  });
});
