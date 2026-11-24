// T-7 Template slide from the Threat COAs panel: the play shown becomes a PNG.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox } from './app-fixture.js';
import { mountThreatCoasView } from '../../src/adapters/ui/views/threat-coas-view.js';
import { createThreatModelStore } from '../../src/adapters/ui/threat-model-store.js';
import { createSelection } from '../../src/adapters/ui/selection.js';

const INF = '10061000001211000000';
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

describe('Slide (PNG) of a threat play', () => {
  it('saves the COA\'s play as a slide with the project\'s marking and slide shape', async () => {
    const fixture = createTestApp();
    await fixture.client.send('settings.update', { expectedRevision: 0, marking: { text: 'SECRET', color: '#c8102e' }, frame: { aspect: '4:3', center: { lat: 0, lng: 0 }, width: 1 } });
    let m = (await fixture.client.send('threat-model.create', { name: 'MRB attack' })).value;
    m = (await fixture.client.send('threat-model.set-template', { modelId: m.id, expectedRevision: 1, target: 'formation', template: {
      units: [{ id: 'u1', sidc: INF, label: '1 MRC', x: -900, y: 0, hvt: true, weapons: [{ name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 }] }], graphics: [] } })).value;
    m = (await fixture.client.send('threat-coa.add', { modelId: m.id, expectedRevision: m.revision, name: 'COA 1', rank: 'mostLikely' })).value;
    const playSelection = createSelection(m.coas[0].id);
    const store = createThreatModelStore({ client: fixture.client, modelSelection: createSelection(m.id), playSelection });
    const host = sandbox();
    const saved = [];
    const view = mountThreatCoasView({ client: fixture.client, root: host, store, saveFile: async (blob, name) => saved.push({ blob, name }) });
    cleanups.push(() => { view.destroy(); store.destroy(); host.remove(); });
    await Promise.all([store.ready, view.ready]);
    await waitFor(() => host.querySelector('[data-template-slide]'));
    host.querySelector('[data-template-slide]').click();
    await waitFor(() => saved.length === 1, { timeout: 5000 });
    assert.match(saved[0].name, /^mrb-attack-coa-1-mlcoa_\d{6}Z[A-Z]{3}\d{2}\.png$/);
    assert.equal(saved[0].blob.type, 'image/png');
    const image = await createImageBitmap(saved[0].blob);
    assert.deepEqual([image.width, image.height], [1600, 1200], 'the project\'s slide shape (4:3)');
    await waitFor(() => /Exported/.test(host.textContent));
  });
});
