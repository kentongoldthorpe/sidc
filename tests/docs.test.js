// Keeps docs/ARCHITECTURE.md's message catalogue in step with the messages the app registers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MESSAGES } from '../src/application/create-application.js';

const doc = readFileSync(new URL('../docs/ARCHITECTURE.md', import.meta.url), 'utf8');

// Rows like: | `coa.create` | command | 1 | ✅ | …
const rows = [...doc.matchAll(/^\| `([a-z0-9.-]+)` \| (command|query) \| (\d+) \| (✅|⏳) \|/gm)]
  .map(([, type, kind, v, status]) => ({ type, kind, v: Number(v), status }));

describe('docs/ARCHITECTURE.md message catalogue', () => {
  it('has catalogue rows to check', () => assert.ok(rows.length >= MESSAGES.length));

  it('lists each message type once', () => {
    const types = rows.map((r) => r.type);
    assert.deepEqual(types, [...new Set(types)]);
  });

  it('marks exactly the registered commands and queries as implemented, with matching kind and version', () => {
    const implemented = rows.filter((r) => r.status === '✅').map(({ type, kind, v }) => `${kind} ${type} v${v}`).sort();
    const registered = MESSAGES.map(({ type, kind, v }) => `${kind} ${type} v${v}`).sort();
    assert.deepEqual(implemented, registered);
  });
});
