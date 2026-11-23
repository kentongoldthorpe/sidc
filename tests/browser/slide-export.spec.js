// COA-6a.2: painting a slide display list to PNG, and the Export PNG button. Checked by reading pixels.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox } from './app-fixture.js';
import { paintSlide, canvasToPng } from '../../src/adapters/export/paint-slide.js';
import { layoutSlide } from '../../src/adapters/export/slide-layout.js';
import { mountExportView } from '../../src/adapters/ui/views/export-view.js';
import { createSelection } from '../../src/adapters/ui/selection.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';

const RED_SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#ff0000"/></svg>';
const pixel = (canvas, x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)];
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

async function decode(blob) {
  const image = new Image();
  image.src = URL.createObjectURL(blob);
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

describe('painting a slide', () => {
  const slide = {
    width: 400, height: 300,
    items: [
      { kind: 'rect', role: 'background', x: 0, y: 0, w: 400, h: 300, fill: '#ffffff' },
      { kind: 'rect', role: 'banner-top', x: 0, y: 0, w: 400, h: 20, fill: '#007a33' },
      { kind: 'text', role: 'banner-text', x: 200, y: 10, text: 'UNCLASSIFIED', size: 12, weight: 700, color: '#ffffff', align: 'center' },
      { kind: 'rect', role: 'map-area', x: 50, y: 50, w: 200, h: 200, fill: '#e6e8e1' },
      { kind: 'clip-start', x: 50, y: 50, w: 200, h: 200 },
      { kind: 'line', role: 'grid', x1: 150, y1: 50, x2: 150, y2: 250, color: '#000000', width: 2 },
      { kind: 'image', role: 'unit', x: 100, y: 100, w: 20, h: 20, svg: RED_SQUARE },
      { kind: 'image', role: 'unit', x: 240, y: 100, w: 20, h: 20, svg: RED_SQUARE }, // half outside the map
      { kind: 'clip-end' },
    ],
  };

  it('draws rectangles, lines and SVG symbols at their positions, at the slide size', async () => {
    const canvas = await paintSlide(slide);
    assert.deepEqual([canvas.width, canvas.height], [400, 300]);
    assert.equal(hex(pixel(canvas, 5, 5)), '#007a33', 'banner');
    assert.equal(hex(pixel(canvas, 60, 200)), '#e6e8e1', 'map background');
    assert.equal(hex(pixel(canvas, 150, 200)), '#000000', 'grid line');
    assert.equal(hex(pixel(canvas, 110, 110)), '#ff0000', 'unit symbol');
  });

  it('clips units to the map area', async () => {
    const canvas = await paintSlide(slide);
    assert.equal(hex(pixel(canvas, 245, 110)), '#ff0000', 'inside part drawn');
    assert.equal(hex(pixel(canvas, 255, 110)), '#ffffff', 'outside part clipped');
  });

  it('draws paths: open lines, closed filled areas, dashes, and text with a halo', async () => {
    const canvas = await paintSlide({
      width: 200, height: 100,
      items: [
        { kind: 'rect', role: 'background', x: 0, y: 0, w: 200, h: 100, fill: '#ffffff' },
        { kind: 'path', role: 'graphic', points: [{ x: 10, y: 20 }, { x: 90, y: 20 }], closed: false, color: '#0000ff', width: 6, dash: null, fill: null },
        { kind: 'path', role: 'graphic', points: [{ x: 110, y: 10 }, { x: 190, y: 10 }, { x: 190, y: 90 }, { x: 110, y: 90 }], closed: true, color: '#ff0000', width: 4, dash: [10, 10], fill: 'rgba(0, 255, 0, 1)' },
        { kind: 'text', role: 'graphic-label', x: 50, y: 70, text: 'X', size: 20, weight: 700, color: '#000000', align: 'center', halo: '#ffff00' },
      ],
    });
    assert.equal(hex(pixel(canvas, 50, 20)), '#0000ff', 'line');
    assert.equal(hex(pixel(canvas, 50, 40)), '#ffffff', 'an open line is not filled');
    assert.equal(hex(pixel(canvas, 150, 50)), '#00ff00', 'area fill');
    assert.equal(hex(pixel(canvas, 115, 10)), '#ff0000', 'dash on');
    assert.equal(hex(pixel(canvas, 125, 10)), '#00ff00', 'dash gap shows the fill under the edge');
    const around = [[40, 70], [60, 70], [50, 58], [50, 82]].map(([x, y]) => hex(pixel(canvas, x, y)));
    assert.ok(around.includes('#ffff00') || [...Array(20).keys()].some((d) => hex(pixel(canvas, 44 + d / 2, 70)) === '#ffff00'), 'halo painted around the text');
  });

  it('writes a PNG', async () => {
    const blob = await canvasToPng(await paintSlide(slide));
    assert.equal(blob.type, 'image/png');
    assert.equal(hex(pixel(await decode(blob), 5, 5)), '#007a33');
  });
});

describe('Export PNG', () => {
  let host; let map; let view;
  afterEach(() => { view?.destroy(); map?.remove(); host?.remove(); view = null; map = null; host = null; });

  async function mountWithCoa() {
    const fixture = createTestApp();
    const coa = (await fixture.client.send('coa.create', { name: 'COA 1' })).value;
    await fixture.client.send('symbol.add', { coaId: coa.id, sidc: '10031000001211000000', position: { lat: 34, lng: -117 }, label: 'A/1-5' });
    const saved = [];
    host = sandbox();
    const panel = document.createElement('div');
    const container = document.createElement('div');
    container.style.cssText = 'width: 900px; height: 600px;';
    host.append(panel, container);
    map = window.L.map(container, { center: [34, -117], zoom: 9 });
    view = mountExportView({ client: fixture.client, root: panel, L: window.L, map, selection: createSelection(coa.id), prefs: createMemoryPrefs(), saveFile: async (blob, name) => { saved.push({ blob, name }); } });
    await view.ready;
    return { ...fixture, coa, panel, saved };
  }
  const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

  it('asks for a frame first when there is none', async () => {
    const { panel, saved } = await mountWithCoa();
    button(panel, 'Export PNG').click();
    await waitFor(() => /Set a frame first/.test(panel.textContent));
    assert.equal(saved.length, 0);
  });

  it('exports the selected COA as a 1920×1080 PNG with the marking, named from the COA and DTG', async () => {
    const { panel, saved } = await mountWithCoa();
    button(panel, 'Set shared frame from current view').click();
    await waitFor(() => /Using the shared frame/.test(panel.textContent));
    button(panel, 'Export PNG').click();
    await waitFor(() => saved.length === 1, { timeout: 5000 });
    assert.match(saved[0].name, /^coa-1_\d{6}Z[A-Z]{3}\d{2}\.png$/);
    assert.equal(saved[0].blob.type, 'image/png');
    const canvas = await decode(saved[0].blob);
    assert.deepEqual([canvas.width, canvas.height], [1920, 1080]);
    assert.equal(hex(pixel(canvas, 10, 10)), '#007a33', 'top banner');
    assert.equal(hex(pixel(canvas, 10, 1075)), '#007a33', 'bottom banner');
    assert.match(panel.textContent, /Exported coa-1_/);
  });

  it('includes units added after the Export section loaded the COA', async () => {
    const { panel, saved, other, coa } = await mountWithCoa();
    button(panel, 'Set shared frame from current view').click();
    await waitFor(() => /Using the shared frame/.test(panel.textContent));
    const frame = (await other.ask('settings.get')).value.frame;
    // A hostile (red) unit exactly at the frame centre, added by someone else after loading.
    await other.send('symbol.add', { coaId: coa.id, sidc: '10061000001205000000', position: { lat: frame.center.lat, lng: frame.center.lng }, label: '' }); // armour: solid red at its centre
    button(panel, 'Export PNG').click();
    await waitFor(() => saved.length === 1, { timeout: 5000 });
    const canvas = await decode(saved[0].blob);
    const area = layoutSlide({ coa: { name: '', symbols: [], graphics: [] }, frame, marking: { text: 'X', color: '#000000' }, dtg: '', symbols: [] })
      .items.find((i) => i.role === 'map-area');
    const [r, g, b] = pixel(canvas, Math.round(area.x + area.w / 2), Math.round(area.y + area.h / 2));
    assert.ok(r > 200 && g < 180 && b < 180, `expected the red unit at the map centre, got rgb(${r}, ${g}, ${b})`);
  });

  it('uses the COA\'s own frame shape and the saved marking', async () => {
    const { panel, saved, client } = await mountWithCoa();
    const settings = (await client.ask('settings.get')).value;
    await client.send('settings.update', { expectedRevision: settings.revision, marking: { text: 'CUI', color: '#502b85' } });
    const pick = (value) => { const r = panel.querySelector(`input[name="aspect"][value="${value}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); };
    pick('5:4');
    button(panel, 'Give this COA its own frame').click();
    await waitFor(() => /This COA has its own frame/.test(panel.textContent));
    button(panel, 'Export PNG').click();
    await waitFor(() => saved.length === 1, { timeout: 5000 });
    const canvas = await decode(saved[0].blob);
    assert.deepEqual([canvas.width, canvas.height], [1500, 1200]);
    assert.equal(hex(pixel(canvas, 10, 10)), '#502b85');
  });
});

describe('Export all COAs', () => {
  let host; let map; let view;
  afterEach(() => { view?.destroy(); map?.remove(); host?.remove(); view = null; map = null; host = null; });
  const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

  /** Three COAs (created out of order), the shared 16:9 frame set, and COA 2 with its own 5:4 frame. */
  async function mountThree() {
    const fixture = createTestApp();
    const created = {};
    for (const name of ['COA 10', 'COA 2', 'COA 1']) {
      created[name] = (await fixture.client.send('coa.create', { name })).value;
      await fixture.client.send('symbol.add', { coaId: created[name].id, sidc: '10031000001211000000', position: { lat: 34, lng: -117 }, label: name });
    }
    await fixture.client.send('settings.update', { expectedRevision: 0, frame: { aspect: '16:9', center: { lat: 34, lng: -117 }, width: 0.5 } });
    await fixture.client.send('coa.update', { coaId: created['COA 2'].id, frame: { aspect: '5:4', center: { lat: 34, lng: -117 }, width: 0.3 } });
    const saved = [];
    host = sandbox();
    const panel = document.createElement('div');
    const container = document.createElement('div');
    container.style.cssText = 'width: 900px; height: 600px;';
    host.append(panel, container);
    map = window.L.map(container, { center: [34, -117], zoom: 9 });
    view = mountExportView({ client: fixture.client, root: panel, L: window.L, map, selection: createSelection(created['COA 1'].id), prefs: createMemoryPrefs(), saveFile: async (blob, name) => { saved.push({ blob, name }); } });
    await view.ready;
    return { ...fixture, panel, saved };
  }

  it('exports one PNG per COA, in name order, all with the shared frame and the same DTG', async () => {
    const { panel, saved } = await mountThree();
    button(panel, 'Export all COAs').click();
    await waitFor(() => saved.length === 3, { timeout: 8000 });
    const names = saved.map((f) => f.name);
    assert.deepEqual(names.map((n) => n.split('_')[0]), ['coa-1', 'coa-2', 'coa-10']);
    assert.equal(new Set(names.map((n) => n.split('_')[1])).size, 1, 'one DTG for the whole set');
    for (const f of saved) {
      const canvas = await decode(f.blob);
      assert.deepEqual([canvas.width, canvas.height], [1920, 1080], `${f.name} uses the shared frame`);
    }
    await waitFor(() => /Exported 3 slides/.test(panel.textContent));
  });

  it('can use each COA\'s own frame where it has one', async () => {
    const { panel, saved } = await mountThree();
    const own = panel.querySelector('input[name="use-own-frames"]');
    own.checked = true;
    own.dispatchEvent(new Event('change', { bubbles: true }));
    button(panel, 'Export all COAs').click();
    await waitFor(() => saved.length === 3, { timeout: 8000 });
    const sizes = await Promise.all(saved.map(async (f) => { const c = await decode(f.blob); return `${f.name.split('_')[0]} ${c.width}x${c.height}`; }));
    assert.deepEqual(sizes, ['coa-1 1920x1080', 'coa-2 1500x1200', 'coa-10 1920x1080']);
  });

  it('asks for the shared frame first when there is none', async () => {
    const fixture = createTestApp();
    await fixture.client.send('coa.create', { name: 'COA 1' });
    const saved = [];
    host = sandbox();
    const panel = document.createElement('div');
    const container = document.createElement('div');
    container.style.cssText = 'width: 900px; height: 600px;';
    host.append(panel, container);
    map = window.L.map(container, { center: [34, -117], zoom: 9 });
    view = mountExportView({ client: fixture.client, root: panel, L: window.L, map, selection: createSelection(null), prefs: createMemoryPrefs(), saveFile: async (b, n) => { saved.push(n); } });
    await view.ready;
    button(panel, 'Export all COAs').click();
    await waitFor(() => /Set the shared frame first/.test(panel.textContent));
    assert.equal(saved.length, 0);
  });
});
