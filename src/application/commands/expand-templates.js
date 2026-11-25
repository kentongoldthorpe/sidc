// Unit template names in files (Epic 6 E6-2): a unit given as { "template": "BMP-2 Coy", … } takes the
// project's unit template of that name (case ignored) for every field the row does not give itself:
// symbol, label, facing, HVT tag, weapons and details. A worksheet line can then name the template
// instead of a symbol code.
import { listTemplates } from './unit-template-commands.js';
import { unitFromTemplate } from '../../domain/unit-template.js';
import { isObject } from '../../shared/values.js';

const given = (v) => v !== undefined && v !== null && v !== '';

/**
 * Expand `template` in every unit of an import document (a new document; the input is not changed).
 * @returns {Promise<{ problems: object[], document?: object }>} problems by path, e.g. coas[0].units[3].template
 */
export async function expandTemplates(doc, documentRepository) {
  const uses = isObject(doc) && Array.isArray(doc.coas)
    && doc.coas.some((c) => isObject(c) && Array.isArray(c.units) && c.units.some((u) => isObject(u) && 'template' in u));
  if (!uses) return { problems: [], document: doc };
  const listed = await listTemplates(documentRepository);
  const templates = listed.ok ? listed.value : [];
  const byName = new Map(templates.map((t) => [t.name.trim().toLowerCase(), t]));
  const problems = [];
  const coas = doc.coas.map((c, i) => {
    if (!isObject(c) || !Array.isArray(c.units)) return c;
    return { ...c, units: c.units.map((u, j) => {
      if (!isObject(u) || !('template' in u)) return u;
      const { template: name, ...rest } = u;
      if (!given(name)) return rest;
      const t = typeof name === 'string' ? byName.get(name.trim().toLowerCase()) : undefined;
      if (!t) {
        problems.push({ field: `coas[${i}].units[${j}].template`, reason: `no unit template is named "${name}"${templates.length ? ` (the project has ${templates.slice(0, 5).map((x) => x.name).join(', ')}${templates.length > 5 ? ', …' : ''})` : ' (the project has none)'}` });
        return rest;
      }
      const base = unitFromTemplate(t);
      const unit = Object.fromEntries(Object.entries(base).filter(([, v]) => given(v)));
      for (const [k, v] of Object.entries(rest)) if (given(v) || !(k in unit)) unit[k] = v;
      return unit;
    }) };
  });
  return { problems, document: { ...doc, coas } };
}
