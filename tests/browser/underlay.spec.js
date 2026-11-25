// E6-5: placing a photo by points and drawing it under the map.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { sandbox } from './app-fixture.js';
import { mountUnderlayView, fitPoints } from '../../src/adapters/ui/views/underlay-view.js';
import { fromUtm } from '../../src/domain/mgrs.js';

const L = window.L;
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const button = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

/** A "photo" of the ground: 800 × 600 px, 10 m a pixel, north up, its top-left at 18S UJ 2000 1000; a red dot at 18S UJ 2300 0800. */
async function photoFile() {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8e4d8'; ctx.fillRect(0, 0, 800, 600);
  ctx.strokeStyle = '#3355aa'; ctx.lineWidth = 2;
  for (let x = 0; x <= 800; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 600); ctx.stroke(); }
  for (let y = 0; y <= 600; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(800, y); ctx.stroke(); }
  ctx.fillStyle = '#ff0000'; ctx.beginPath(); ctx.arc(300, 200, 14, 0, 2 * Math.PI); ctx.fill();
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new File([blob], 'acetate.png', { type: 'image/png' });
}

async function setup() {
  const host = sandbox();
  const panel = document.createElement('div');
  const container = document.createElement('div');
  container.style.cssText = 'width: 700px; height: 500px;';
  host.append(panel, container);
  const map = L.map(container, { center: [38.86, -77.0], zoom: 12, animate: false, fadeAnimation: false, zoomAnimation: false });
  const view = mountUnderlayView({ root: panel, L, map });
  cleanups.push(() => { view.destroy(); map.remove(); host.remove(); });
  return { panel, container, map, view };
}

describe('photo underlay', () => {
  it('fits points: residuals in metres, a projective fit from 4, a wrong grid standing out', () => {
    const pts = [[0, 0, '18S UJ 2000 1000'], [800, 0, '18S UJ 2800 1000'], [800, 600, '18S UJ 2800 0400'], [0, 600, '18S UJ 2000 0400']]
      .map(([x, y, text]) => ({ px: { x, y }, text }));
    const fit = fitPoints(pts);
    assert.equal(fit.kind, 'projective');
    assert.ok(fit.rms < 1, `rms ${fit.rms}`);
    assert.match(fitPoints(pts.slice(0, 2)).problem, /at least 3 points \(2 so far\)/);
    const bad = fitPoints([...pts, { px: { x: 400, y: 300 }, text: '18S UJ 2400 0800' }]); // should be 2400 0700
    assert.ok(Math.max(...bad.rows.map((r) => r.residual)) > 50);
    assert.equal(fitPoints([{ px: { x: 1, y: 1 }, text: 'nonsense' }]).rows[0].problem.length > 0, true);
  });

  it('is placed by clicking points and typing their grids, then drawn where the grid says', async () => {
    const s = await setup();
    const input = s.panel.querySelector('input[type="file"]');
    const files = new DataTransfer();
    files.items.add(await photoFile());
    input.files = files.files;
    input.dispatchEvent(new Event('change'));
    const dialog = document.querySelector('dialog.register-dialog');
    await waitFor(() => dialog.open && dialog.querySelector('.register-image').naturalWidth === 800);
    dialog.querySelector('[name="register-zoom"]').value = '1';
    dialog.querySelector('[name="register-zoom"]').dispatchEvent(new Event('change'));
    const img = dialog.querySelector('.register-image');
    const clickAt = (x, y) => { const r = img.getBoundingClientRect(); dialog.querySelector('.register-stage').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + (x + 0.5) * (r.width / 800), clientY: r.top + (y + 0.5) * (r.height / 600) })); };
    const grids = [[100, 100, '18S UJ 2100 0900'], [700, 100, '18S UJ 2700 0900'], [700, 500, '18S UJ 2700 0500'], [100, 500, '18S UJ 2100 0500']];
    for (const [x, y, grid] of grids) {
      clickAt(x, y);
      const fields = dialog.querySelectorAll('input[name="point-grid"]');
      const f = fields[fields.length - 1];
      f.value = grid;
      f.dispatchEvent(new Event('change'));
    }
    await waitFor(() => /^Corrected for perspective; fits within \d+ m \(RMS\)/.test(dialog.querySelector('[data-fit-note]').textContent));
    assert.equal(dialog.querySelectorAll('.register-mark').length, 4);
    button(dialog, 'Show on map').click();
    await waitFor(() => s.view.state().shown && !dialog.open);
    assert.match(s.panel.querySelector('[data-underlay-summary]').textContent, /^acetate\.png: 4 points, fits within \d+ m\.$/);
    // The red dot (pixel 300, 200 = 18S UJ 2300 0800) is drawn where the map puts that grid.
    const ll = fromUtm({ zone: 18, hemisphere: 'N', easting: 323000, northing: 4308000 });
    const p = s.map.latLngToContainerPoint([ll.lat, ll.lng]);
    const canvas = s.container.querySelector('canvas[data-underlay]');
    const dpr = window.devicePixelRatio || 1;
    const [r, g, b] = canvas.getContext('2d').getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data;
    assert.ok(r > 150 && g < 120 && b < 120, `red at the grid: ${r},${g},${b}`);
    button(s.panel, 'Remove photo').click();
    assert.equal(s.view.state().shown, false);
  });
});
