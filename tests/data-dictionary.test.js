// Epic 5 X-1: docs/DATA-DICTIONARY.md lists exactly the fields each record has. Fields are taken
// from the code where it defines them, and from real records the app creates otherwise.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SYMBOL_KEYS, GRAPHIC_KEYS } from '../src/domain/coa.js';
import { MODIFIER_NAMES } from '../src/domain/map-symbol.js';
import { WEAPON_FIELDS, DETAIL_KEYS } from '../src/domain/weapon.js';
import { TEMPLATE_UNIT_KEYS, STATEMENT_PARTS } from '../src/domain/threat-model.js';
import { TEMPLATE_FIELDS } from '../src/domain/unit-template.js';
import { FACTORS, LIGHT_FIELDS } from '../src/domain/weather.js';
import { HEADER_KEYS } from '../src/domain/export-header.js';
import { createHarness, okValue } from './support/app-harness.js';

const doc = readFileSync(new URL('../docs/DATA-DICTIONARY.md', import.meta.url), 'utf8');
/** The backticked names in the first column of the table under heading `title`. */
function fieldsOf(title) {
  const start = doc.search(new RegExp(`^#{2,3} ${title}$`, 'm'));
  assert.ok(start >= 0, `no section "${title}"`);
  const rest = doc.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => /^#{2,3} /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).map((l) => /^\| `([A-Za-z]+)` \|/.exec(l)?.[1]).filter(Boolean).sort();
}
const same = (title, keys) => assert.deepEqual(fieldsOf(title), [...new Set(keys)].sort(), title);

describe('docs/DATA-DICTIONARY.md', () => {
  it('lists the fields of units, modifiers, weapons, details and graphics as the code defines them', () => {
    same('Unit', SYMBOL_KEYS);
    same('Modifiers', MODIFIER_NAMES);
    same('Weapon', WEAPON_FIELDS);
    same('Details', DETAIL_KEYS);
    same('Graphic', GRAPHIC_KEYS);
    same('Template unit', TEMPLATE_UNIT_KEYS);
    same('Unit template', ['id', 'revision', ...TEMPLATE_FIELDS]);
    same('Period', ['date', 'half', ...Object.keys(FACTORS), 'precipitation', 'notes']);
    same('Light data', ['date', ...LIGHT_FIELDS]);
    same('Export header', HEADER_KEYS);
    same('Rule', ['factor', 'amber', 'red']);
  });

  it('lists the fields of the records the app keeps, as it really creates them', async () => {
    const h = createHarness();
    const coa = okValue(await h.dispatch('coa.update', { coaId: okValue(await h.dispatch('coa.create', { name: 'A' })).id, expectedRevision: 1, frame: { aspect: '16:9', center: { lat: 0, lng: 0 }, width: 1 } }));
    same('COA', [...Object.keys(coa), 'source']);
    let model = okValue(await h.dispatch('threat-model.create', { name: 'M' }));
    same('Threat model', Object.keys(model));
    model = okValue(await h.dispatch('threat-coa.add', { modelId: model.id, expectedRevision: 1, name: 'C' }));
    same('Threat COA', Object.keys(model.coas[0]));
    assert.deepEqual(Object.keys(model.coas[0].statement).sort(), [...STATEMENT_PARTS].sort());
    same('Project', Object.keys(okValue(await h.dispatch('project.create', { name: 'P' }))));
    same('Settings', Object.keys(okValue(await h.dispatch('settings.update', { expectedRevision: 0, marking: { text: 'X', color: '#000000' } }))));
    same('Forecast', Object.keys(okValue(await h.dispatch('weather.create', { name: 'F' }))));
    same('Critical values', Object.keys(okValue(await h.dispatch('weather-criterion.create', { name: 'W' }))));
  });
});
