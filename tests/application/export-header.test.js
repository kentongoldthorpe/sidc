// Epic 5 X-1: export.header gives every exporter the marking, project and DTG to put in its file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields, T0 } from '../support/app-harness.js';
import { dtgOf, headerLine } from '../../src/domain/export-header.js';
import { VERSION } from '../../src/shared/version.js';

describe('export.header', () => {
  it('gives the open project\'s marking and name, the time and DTG, the application and the format', async () => {
    const h = createHarness();
    okValue(await h.dispatch('settings.update', { expectedRevision: 0, marking: { text: 'SECRET//NOFORN', color: '#c8102e' } }));
    okValue(await h.dispatch('project.rename', { projectId: 'default', expectedRevision: 0, name: 'Exercise IRON' }));
    const header = okValue(await h.query('export.header', { format: 'geojson' }));
    assert.deepEqual(header, {
      classification: 'SECRET//NOFORN', classificationColor: '#c8102e', project: 'Exercise IRON', exportedAt: T0, dtg: dtgOf(T0),
      application: `COA Builder ${VERSION}`, format: 'geojson', formatVersion: 1,
    });
    assert.equal(headerLine(header), `# SECRET//NOFORN // Exercise IRON // exported ${dtgOf(T0)} // COA Builder ${VERSION} // geojson v1`);
  });

  it('uses the default marking before one is set, and checks the payload', async () => {
    const h = createHarness();
    assert.equal(okValue(await h.query('export.header', { format: 'csv' })).classification, 'UNCLASSIFIED');
    assert.deepEqual(problemFields(errorOf(await h.query('export.header', { format: 'Not A Format!', formatVersion: 0 }), 'VALIDATION_FAILED')), ['format', 'formatVersion']);
  });

  it('writes the DTG from an ISO time', () => {
    assert.equal(dtgOf('2026-11-24T21:05:00.000Z'), '242105ZNOV26');
    assert.equal(dtgOf('2027-01-02T03:04:00Z'), '020304ZJAN27');
  });
});
