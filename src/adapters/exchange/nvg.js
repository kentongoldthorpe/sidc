// NATO Vector Graphics 2.0 (Epic 5 X-5, D40): the COAs as an NVG document for C2 systems that
// exchange overlays in NVG. Built from the same exchange features as GeoJSON and KML.
//
//   - One <g> group per COA, holding units, lines and areas, and weapon ranges.
//   - Units are <point> elements with their symbol code in `symbol` ("2525d:<20 or 30 digits>",
//     or "2525c:<15 characters>") and their label; lines are <polyline>, everything with an area
//     (areas, rings, sectors, weapon ranges) a <polygon> of geodesic points.
//   - Coordinates are WGS 84, x = longitude, y = latitude.
//   - Every field travels in <ExtendedData> as <SimpleData key="…">. The marking leads the label of
//     the outer group (what a C2 overlay list shows) and a comment at the top of the file.
//   - A unit's direction of movement is its `course`.
import { xml } from './kml.js';
import { STYLE_KEYS } from './features.js';

export const NVG_NAMESPACE = 'https://tide.act.nato.int/schemas/2012/10/nvg';
export const NVG_VERSION = '2.0.2';

/** The NVG symbol attribute for a 2525 code. */
export const nvgSymbol = (sidc) => (/^\d{20}(\d{10})?$/.test(String(sidc)) ? `2525d:${sidc}` : `2525c:${String(sidc).toUpperCase()}`);

const r7 = (n) => Math.round(n * 1e7) / 1e7;
const pts = (coords) => coords.map(([lng, lat]) => `${r7(lng)},${r7(lat)}`).join(' ');
const HIDDEN = new Set([...STYLE_KEYS, 'coa', 'layer']);
const GROUPS = Object.freeze({ unit: 'Units', graphic: 'Lines and areas', weapon: 'Weapon ranges' });

function style(p) {
  if (p.layer === 'unit') return '';
  const parts = [`stroke:${p.stroke}`, `stroke-width:${p['stroke-width'] ?? 2}`];
  if (p.fill) parts.push(`fill:${p.fill}`, `fill-opacity:${p['fill-opacity'] ?? 0}`);
  else parts.push('fill:none');
  return ` style="${xml(parts.join(';'))}"`;
}

function labelOf(p) {
  if (p.layer === 'weapon') return `${p.weapon_name}${p.unit_label ? ` (${p.unit_label})` : ''}`;
  const base = p.label || (p.layer === 'unit' ? '' : p.kind);
  return p.hvt === true ? `${base} [HVT]` : base;
}

function element(f) {
  const p = f.properties;
  const data = Object.entries(p).filter(([k, v]) => !HIDDEN.has(k) && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<SimpleData key="${xml(k)}">${xml(v)}</SimpleData>`).join('');
  const common = `${f.id ? ` uri="${xml(f.id)}"` : ''} label="${xml(labelOf(p))}"${style(p)}`;
  const body = `><ExtendedData>${data}</ExtendedData>`;
  if (f.geometry.type === 'Point') {
    const [x, y] = f.geometry.coordinates;
    return `<point x="${r7(x)}" y="${r7(y)}" symbol="${xml(nvgSymbol(p.sidc))}"${p.direction !== undefined ? ` course="${Number(p.direction)}"` : ''}${common}${body}</point>`;
  }
  if (f.geometry.type === 'LineString') return `<polyline points="${pts(f.geometry.coordinates)}"${common}${body}</polyline>`;
  return `<polygon points="${pts(f.geometry.coordinates[0].slice(0, -1))}"${common}${body}</polygon>`; // NVG closes polygons itself
}

/**
 * @param {object[]} features from coaFeatures()
 * @param {{ header: object, title?: string }} options
 * @returns {string} an NVG 2.0 document
 */
export function writeNvg(features, { header, title = 'COAs' }) {
  const byCoa = new Map();
  for (const f of features) {
    const coa = f.properties.coa ?? '';
    if (!byCoa.has(coa)) byCoa.set(coa, { unit: [], graphic: [], weapon: [] });
    byCoa.get(coa)[f.properties.layer ?? 'graphic'].push(f);
  }
  const groups = [...byCoa].map(([coa, layers]) => `    <g label="${xml(coa)}">\n${
    Object.entries(GROUPS).filter(([layer]) => layers[layer].length)
      .map(([layer, name]) => `      <g label="${name}">\n${layers[layer].map((f) => `        ${element(f)}\n`).join('')}      </g>\n`).join('')
  }    </g>\n`).join('');
  const comment = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/-(?=-)/g, '- ').replace(/-$/, '- ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${comment(header.classification)} // ${comment(header.project)}: ${comment(title)} // exported ${comment(header.dtg)} by ${comment(header.application)} -->\n`
    + `<nvg xmlns="${NVG_NAMESPACE}" version="${NVG_VERSION}">\n`
    + `  <g label="${xml(`${header.classification} // ${title}`)}">\n${groups}  </g>\n</nvg>\n`;
}
