// A unit's weapons list (D28), shared by the map unit editor and the template unit editor. Weapons
// are values copied into the unit: pick one from the systems list (a copy, D29) or type a custom one.
// Ranges are typed in km and kept in metres; the core checks every number.
import { el } from './dom.js';
import { WEAPON_ROLES } from '../../../domain/weapon.js';

export const ROLE_NAMES = Object.freeze({ direct: 'Direct fire', indirect: 'Indirect fire', airDefence: 'Air defence', sensor: 'Sensor', other: 'Other' });
const km = (metres) => String(Number((metres / 1000).toFixed(3)));
/** "Direct fire · 0.1–2.5 km · 60°" */
export const describeWeapon = (w) => `${ROLE_NAMES[w.role] ?? w.role} · ${w.minRange ? `${km(w.minRange)}–` : ''}${km(w.maxRange)} km · ${w.arc >= 360 ? 'all round' : `${w.arc}°`}`;
const toMetres = (text) => { const n = Number(text.trim().replace(',', '.')); return text.trim() === '' ? undefined : Number.isFinite(n) ? Math.round(n * 1000) : text; };
const toNumber = (text) => { const n = Number(text.trim().replace(',', '.')); return text.trim() === '' ? undefined : Number.isFinite(n) ? n : text; };

/**
 * @param {{ systems?: object[], onChange?: () => void, name?: string }} options  systems: the systems list to copy from
 * @returns {{ element: HTMLElement, value(): object[], set(weapons: object[]): void }}
 */
export function mountWeaponsEditor({ systems = [], onChange = () => {}, name = 'weapons' } = {}) {
  let weapons = [];
  const list = el('ul', { class: 'weapon-items', attrs: { 'aria-label': 'Weapons' } });
  const empty = el('p', { class: 'hint', text: 'No weapons: add the unit\'s weapons and sensors to draw their ranges.' });

  const pick = el('select', { attrs: { name: `${name}-pick`, 'aria-label': 'Weapon from the systems list' } },
    el('option', { attrs: { value: '' }, text: systems.length ? 'Copy from the systems list…' : 'No systems in the list' }),
    ...systems.map((s) => el('option', { attrs: { value: s.id }, text: `${s.name} (${describeWeapon(s)})` })));
  pick.disabled = systems.length === 0;
  pick.addEventListener('change', () => {
    const s = systems.find((x) => x.id === pick.value);
    pick.value = '';
    if (!s) return;
    const { name: n, role, maxRange, minRange, arc } = s;
    change([...weapons, { name: n, role, maxRange, ...(minRange ? { minRange } : {}), arc }]);
  });

  const field = (text, control) => el('label', { class: 'field' }, el('span', { text }), control);
  const wName = el('input', { attrs: { name: `${name}-name`, autocomplete: 'off', maxlength: 60, placeholder: 'e.g. 125 mm gun' } });
  const wRole = el('select', { attrs: { name: `${name}-role` } }, ...WEAPON_ROLES.map((r) => el('option', { attrs: { value: r }, text: ROLE_NAMES[r] })));
  const wMax = el('input', { attrs: { name: `${name}-max`, inputmode: 'decimal', autocomplete: 'off', placeholder: 'km' } });
  const wMin = el('input', { attrs: { name: `${name}-min`, inputmode: 'decimal', autocomplete: 'off', placeholder: 'km (optional)' } });
  const wArc = el('input', { attrs: { name: `${name}-arc`, inputmode: 'decimal', autocomplete: 'off', placeholder: '360' } });
  const addCustom = el('button', { attrs: { type: 'button' }, text: 'Add weapon', on: { click: () => {
    const w = { name: wName.value, role: wRole.value, maxRange: toMetres(wMax.value), arc: toNumber(wArc.value) ?? 360 };
    const min = toMetres(wMin.value);
    if (min !== undefined) w.minRange = min;
    if (w.maxRange === undefined) delete w.maxRange;
    change([...weapons, w]);
    wName.value = ''; wMax.value = ''; wMin.value = ''; wArc.value = '';
  } } });
  const custom = el('details', { class: 'weapon-custom' }, el('summary', { text: 'Or type a weapon' }),
    el('div', { class: 'stack' }, field('Name', wName), field('Role', wRole),
      el('div', { class: 'position' }, field('Max range (km)', wMax), field('Min range (km)', wMin)),
      field('Arc (°; 360 = all round)', wArc), el('div', { class: 'actions' }, addCustom)));

  const element = el('fieldset', { class: 'group weapons-editor', dataset: { weapons: '' } }, el('legend', { text: 'Weapons' }), empty, list, pick, custom);

  function render() {
    empty.hidden = weapons.length > 0;
    list.replaceChildren(...weapons.map((w, i) => el('li', { class: 'weapon-row', dataset: { weaponIndex: String(i) } },
      el('span', { class: 'weapon-name', text: w.name || '(no name)' }),
      el('span', { class: 'system-meta', text: Number.isFinite(w.maxRange) ? describeWeapon({ arc: 360, ...w }) : 'range needed' }),
      el('button', { class: 'link danger', attrs: { type: 'button', 'aria-label': `Remove ${w.name || 'weapon'}` }, text: 'Remove', on: { click: () => change(weapons.filter((_, j) => j !== i)) } }))));
  }
  function change(next) { weapons = next; render(); onChange(); }

  render();
  return {
    element,
    value: () => weapons.map((w) => ({ ...w })),
    set(next) { weapons = (next ?? []).map((w) => ({ ...w })); render(); },
  };
}
