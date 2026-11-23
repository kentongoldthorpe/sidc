// H-3: working without a mouse — Delete, arrow nudges, Esc, and typed points for lines and rings.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { mountFullApp, type } from './app-fixture.js';
import { mountUi } from '../../src/adapters/ui/mount-ui.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';

let app;
afterEach(() => { app?.ui.destroy(); app?.host.remove(); app = null; });

const press = (k, { shift = false, target = document.body, ctrl = false } = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, ctrlKey: ctrl, bubbles: true, cancelable: true }));
const stored = async () => (await app.fixture.client.ask('coa.get', { coaId: app.coa.id })).value;
const field = (name) => app.root.querySelector(`[name="${name}"]`);
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const choose = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
const settle = () => new Promise((r) => setTimeout(r, 60));

async function start() {
  app = await mountFullApp({ mountUi, createMemoryPrefs });
  return app;
}

describe('keyboard: Delete, arrows, Esc', () => {
  it('Delete removes the selected unit, says how to undo, and Ctrl+Z brings it back', async () => {
    const { ui, coa, root } = await start();
    ui.symbolSelection.set(coa.symbols[0].id);
    await settle();
    press('Delete');
    await waitFor(async () => (await stored()).symbols.length === coa.symbols.length - 1);
    await waitFor(() => /Ctrl\+Z/.test(root.querySelector('.history-status').textContent));
    press('z', { ctrl: true });
    await waitFor(async () => (await stored()).symbols.length === coa.symbols.length);
  });

  it('Delete removes the selected line or area', async () => {
    const { ui, coa } = await start();
    ui.graphicSelection.set(coa.graphics[1].id);
    await settle();
    press('Delete');
    await waitFor(async () => !(await stored()).graphics.some((g) => g.id === coa.graphics[1].id));
  });

  it('Delete while typing in a field only edits the field', async () => {
    const { ui, coa } = await start();
    ui.symbolSelection.set(coa.symbols[0].id);
    await waitFor(() => field('label'));
    press('Delete', { target: field('label') });
    await settle();
    assert.equal((await stored()).symbols.length, coa.symbols.length);
  });

  it('arrow keys nudge the selected unit (Shift: further); nothing happens with nothing selected', async () => {
    const { ui, coa } = await start();
    const before = coa.symbols[0].position;
    press('ArrowRight');
    await settle();
    assert.equal((await stored()).revision, coa.revision, 'no change without a selection');
    ui.symbolSelection.set(coa.symbols[0].id);
    await settle();
    press('ArrowRight');
    await waitFor(async () => (await stored()).symbols[0].position.lng > before.lng);
    const small = (await stored()).symbols[0].position.lng - before.lng;
    press('ArrowUp', { shift: true });
    await waitFor(async () => (await stored()).symbols[0].position.lat > before.lat);
    const big = (await stored()).symbols[0].position.lat - before.lat;
    assert.ok(big > small * 2, `Shift moves further (${big} vs ${small})`);
  });

  it('arrow keys move every point of the selected line, and a ring\'s centre', async () => {
    const { ui, coa } = await start();
    const line = coa.graphics[0];
    ui.graphicSelection.set(line.id);
    await settle();
    press('ArrowDown');
    await waitFor(async () => (await stored()).graphics[0].points.every((p, i) => p.lat < line.points[i].lat));
    const ring = coa.graphics.find((g) => g.kind === 'rangeRing');
    ui.graphicSelection.set(ring.id);
    await settle();
    press('ArrowLeft');
    await waitFor(async () => (await stored()).graphics.find((g) => g.id === ring.id).center.lng < ring.center.lng);
  });

  it('Esc closes the unit editor', async () => {
    const { ui, coa, root } = await start();
    ui.symbolSelection.set(coa.symbols[0].id);
    await waitFor(() => root.querySelector('[data-unit-form]'));
    press('Escape');
    await waitFor(() => !root.querySelector('[data-unit-form]') && ui.symbolSelection.get() === null);
  });
});

describe('typed points (drawing without a mouse)', () => {
  it('adds a line from typed "lat, lng" lines', async () => {
    const { root } = await start();
    choose(field('draw-kind'), 'boundary');
    type(field('draw-label'), 'BDY TYPED');
    type(field('draw-points'), '34.0, -118.3\n34.05,-118.2\n  34.1 , -118.1  \n');
    button(root, 'Add from points').click();
    await waitFor(async () => (await stored()).graphics.some((g) => g.label === 'BDY TYPED'));
    const g = (await stored()).graphics.find((x) => x.label === 'BDY TYPED');
    assert.deepEqual(g.points, [{ lat: 34, lng: -118.3 }, { lat: 34.05, lng: -118.2 }, { lat: 34.1, lng: -118.1 }]);
    assert.equal(field('draw-points').value, '', 'cleared after adding');
  });

  it('names the line that cannot be read, and adds nothing', async () => {
    const { root, coa } = await start();
    type(field('draw-points'), '34.0, -118.3\nnorth of the river');
    button(root, 'Add from points').click();
    await waitFor(() => /line 2/i.test(root.querySelector('.draw-form').textContent));
    assert.equal((await stored()).graphics.length, coa.graphics.length);
  });

  it('adds a range ring from a typed centre and radius', async () => {
    const { root } = await start();
    choose(field('draw-kind'), 'rangeRing');
    type(field('draw-radius'), '3');
    type(field('draw-points'), '34.02, -118.25');
    button(root, 'Add from points').click();
    await waitFor(async () => (await stored()).graphics.some((g) => g.kind === 'rangeRing' && g.radius === 3000));
  });
});
