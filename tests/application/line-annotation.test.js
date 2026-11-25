// Epic 3 backlog B-1: a second line of text above a line (a time, H+2…), on map COAs and in
// templates, kept by storage, import, placement and every export.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, okValue, errorOf, problemFields } from '../support/app-harness.js';
import { coaToGeoJson, geoJsonToCoa } from '../../src/adapters/persistence/geojson-coa.js';
import { writeCoaData } from '../../src/adapters/files/coa-data.js';
import { readImportFile } from '../../src/adapters/files/import-file.js';

const PL = [{ lat: 34, lng: -118 }, { lat: 34.2, lng: -117.8 }];
const OBJ = [{ lat: 34, lng: -118 }, { lat: 34.1, lng: -118 }, { lat: 34.1, lng: -117.9 }];

async function setup() {
  const h = createHarness();
  const coa = okValue(await h.dispatch('coa.create', { name: 'Attack' }));
  return { h, coaId: coa.id };
}
const get = async (s) => okValue(await s.h.query('coa.get', { coaId: s.coaId }));

describe('graphic annotation', () => {
  it('a line takes an annotation, trimmed; changing it is reported; null or blank removes it', async () => {
    const s = await setup();
    const { graphic } = okValue(await s.h.dispatch('graphic.add', { coaId: s.coaId, expectedRevision: 1, kind: 'phaseLine', points: PL, label: 'PL GOLD', annotation: '  H+2 ' }));
    assert.equal(graphic.annotation, 'H+2');
    const changed = okValue(await s.h.dispatch('graphic.update', { coaId: s.coaId, expectedRevision: 2, graphicId: graphic.id, annotation: '250600ZNOV26' }));
    assert.deepEqual([changed.graphic.annotation, changed.changed], ['250600ZNOV26', ['annotation']]);
    const kind = okValue(await s.h.dispatch('graphic.update', { coaId: s.coaId, expectedRevision: 3, graphicId: graphic.id, kind: 'boundary' }));
    assert.equal(kind.graphic.annotation, '250600ZNOV26', 'kept when the line changes kind');
    const blank = okValue(await s.h.dispatch('graphic.update', { coaId: s.coaId, expectedRevision: 4, graphicId: graphic.id, annotation: ' ' }));
    assert.equal('annotation' in blank.graphic, false);
    okValue(await s.h.dispatch('graphic.update', { coaId: s.coaId, expectedRevision: 5, graphicId: graphic.id, annotation: 'x' }));
    const removed = okValue(await s.h.dispatch('graphic.update', { coaId: s.coaId, expectedRevision: 6, graphicId: graphic.id, annotation: null }));
    assert.equal('annotation' in removed.graphic, false);
  });

  it('is only for lines, at most 40 characters', async () => {
    const s = await setup();
    const area = errorOf(await s.h.dispatch('graphic.add', { coaId: s.coaId, expectedRevision: 1, kind: 'objective', points: OBJ, annotation: 'H+2' }), 'VALIDATION_FAILED');
    assert.deepEqual(area.details.problems, [{ field: 'annotation', reason: 'is only for lines, not an area' }]);
    const long = errorOf(await s.h.dispatch('graphic.add', { coaId: s.coaId, expectedRevision: 1, kind: 'route', points: PL, annotation: 'x'.repeat(41) }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(long), ['annotation']);
  });

  it('is kept by storage, the JSON and GeoJSON files, and shows in the exchange formats', async () => {
    const s = await setup();
    okValue(await s.h.dispatch('graphic.add', { coaId: s.coaId, expectedRevision: 1, kind: 'phaseLine', points: PL, label: 'PL GOLD', annotation: 'H+2' }));
    const coa = await get(s);
    assert.equal(geoJsonToCoa(JSON.parse(JSON.stringify(coaToGeoJson(coa)))).value.graphics[0].annotation, 'H+2');
    for (const format of ['json', 'geojson']) {
      const read = readImportFile(writeCoaData(format, [coa]));
      assert.equal(read.ok, true, JSON.stringify(read.error));
      const { coas } = okValue(await createHarness().dispatch('coa.import', { document: read.value.document }));
      assert.equal(coas.length, 1);
    }
    const again = createHarness();
    const { coas } = okValue(await again.dispatch('coa.import', { document: readImportFile(writeCoaData('geojson', [coa])).value.document }));
    assert.equal(okValue(await again.query('coa.get', { coaId: coas[0].id })).graphics[0].annotation, 'H+2');
    assert.match(writeCoaData('kml', [coa]), /<Data name="annotation"><value>H\+2<\/value><\/Data>/);
    assert.match(writeCoaData('nvg', [coa]), /<SimpleData key="annotation">H\+2<\/SimpleData>/);
  });
});

describe('template line annotation', () => {
  it('a template line takes one (not an area), and a placed play keeps it', async () => {
    const h = createHarness();
    const m = okValue(await h.dispatch('threat-model.create', { name: 'MRB' }));
    const bad = errorOf(await h.dispatch('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: { units: [],
      graphics: [{ kind: 'objective', annotation: 'H+2', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }] }] } }), 'VALIDATION_FAILED');
    assert.deepEqual(problemFields(bad), ['template.graphics[0].annotation']);
    const set = okValue(await h.dispatch('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: { units: [],
      graphics: [{ id: 'g1', kind: 'phaseLine', label: 'PL A', annotation: ' H+4 ', points: [{ x: -2000, y: 3000 }, { x: 2000, y: 3000 }] }] } }));
    assert.equal(set.formation.graphics[0].annotation, 'H+4');
    const placed = okValue(await h.dispatch('threat-coa.place', { modelId: m.id, play: 'formation', anchor: { lat: 34, lng: -118 }, bearing: 0, positions: 'start' }));
    const coa = okValue(await h.query('coa.get', { coaId: placed.coaId ?? placed.id ?? placed.coa?.id }));
    assert.equal(coa.graphics[0].annotation, 'H+4');
  });
});
