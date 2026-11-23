// Reason for this test (beyond the core coa.import tests, which use a stub renderer): the published
// examples in docs/import/examples are what another system will copy, so every SIDC in them must
// be one the real milsymbol renderer recognises — otherwise the docs would teach an invalid code.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MilsymbolRenderer } from '../../../src/adapters/rendering/milsymbol-renderer.js';
import { createHarness, okValue } from '../../support/app-harness.js';

const ms = createRequire(import.meta.url)('../../../vendor/milsymbol/milsymbol.js');
const dir = new URL('../../../docs/import/examples/', import.meta.url).pathname;

describe('docs/import/examples import through the real milsymbol renderer', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    it(file, async () => {
      const document = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const reply = await createHarness({ symbolRenderer: new MilsymbolRenderer(ms) }).dispatch('coa.import', { document });
      const { coas } = okValue(reply);
      assert.equal(coas.length, document.coas.length);
    });
  }
});
