// The Snap control (Epic 3 backlog B-2): a button on the map or the template canvas that opens a
// small panel: snap to points, to the grid, to angles, and (on the canvas) the template grid spacing.
// The settings are shared and remembered (snapper.js). Holding Alt places freely.
import { el } from './dom.js';
import { TEMPLATE_GRID_STEPS } from '../snapper.js';

const spacingText = (m) => (m < 1000 ? `${m} m` : `${m / 1000} km`);

/**
 * @param {{ L: object, map: object, settings: object, templateGrid?: boolean, position?: string }} options
 *   templateGrid: offer the grid spacing (the template canvas)
 * @returns {{ destroy(): void }}
 */
export function mountSnapControl({ L, map, settings, templateGrid = false, position = 'topleft' }) {
  const control = L.control({ position });
  let off = () => {};
  control.onAdd = () => {
    const button = el('button', { class: 'snap-toggle', attrs: { type: 'button', 'aria-expanded': 'false', title: 'Snapping' } });
    const points = el('input', { attrs: { type: 'checkbox', name: 'snap-points' } });
    const grid = el('input', { attrs: { type: 'checkbox', name: 'snap-grid' } });
    const angle = el('select', { attrs: { name: 'snap-angle', 'aria-label': 'Snap to angles' } },
      ...[[0, 'Off'], [15, '15°'], [45, '45°'], [90, '90°']].map(([v, t]) => el('option', { attrs: { value: String(v) }, text: t })));
    const spacing = templateGrid ? el('select', { attrs: { name: 'snap-template-grid', 'aria-label': 'Grid spacing' } },
      el('option', { attrs: { value: 'auto' }, text: 'Auto (follows the zoom)' }),
      ...TEMPLATE_GRID_STEPS.map((m) => el('option', { attrs: { value: String(m) }, text: spacingText(m) }))) : null;
    const check = (input, text) => el('label', { class: 'check' }, input, el('span', { text }));
    const panel = el('div', { class: 'snap-panel', attrs: { hidden: true, role: 'group', 'aria-label': 'Snapping' } },
      check(points, 'Points (units and line points)'),
      check(grid, templateGrid ? 'Grid' : 'Grid (MGRS when shown, else lat/long)'),
      el('label', { class: 'field' }, el('span', { text: 'Angles from the last point' }), angle),
      spacing ? el('label', { class: 'field' }, el('span', { text: 'Grid spacing' }), spacing) : null,
      el('p', { class: 'hint', text: 'Hold Alt to place freely.' }));
    const box = el('div', { class: 'leaflet-bar snap-control', dataset: { snapControl: '' } }, button, panel);

    const sync = (s) => {
      points.checked = s.points;
      grid.checked = s.grid;
      angle.value = String(s.angle);
      if (spacing) spacing.value = String(s.templateGrid);
      const on = settings.any();
      button.textContent = on ? 'Snap on' : 'Snap';
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    };
    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    });
    points.addEventListener('change', () => settings.set({ points: points.checked }));
    grid.addEventListener('change', () => settings.set({ grid: grid.checked }));
    angle.addEventListener('change', () => settings.set({ angle: Number(angle.value) }));
    spacing?.addEventListener('change', () => settings.set({ templateGrid: spacing.value === 'auto' ? 'auto' : Number(spacing.value) }));
    off = settings.subscribe(sync);
    sync(settings.get());
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    return box;
  };
  control.addTo(map);
  return { destroy() { off(); control.remove(); } };
}
