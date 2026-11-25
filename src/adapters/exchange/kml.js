// KML 2.2 (OGC) from exchange features (Epic 5 X-3, D39): for Google Earth, TAK and C2 viewers.
// One folder per COA (units, lines and areas, weapon ranges), styles shared by colour, every field
// in ExtendedData, and the classification marking in the document's name and description. With
// `iconFor`, units use their 2525 symbol as the icon (a KMZ packs the PNGs, see kmz.js).
import { STYLE_KEYS } from './features.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** Text safe inside XML elements and attributes (labels and notes come from people and files). */
export const xml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** "#rrggbb" + opacity 0..1 → KML "aabbggrr". */
export function kmlColor(hex, opacity = 1) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  const [r, g, b] = m ? [m[1], m[2], m[3]] : ['80', '80', '80'];
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0');
  return `${a}${b}${g}${r}`.toLowerCase();
}

const coord = ([lng, lat]) => `${Math.round(lng * 1e7) / 1e7},${Math.round(lat * 1e7) / 1e7},0`;
const LAYER_FOLDERS = Object.freeze({ unit: 'Units', graphic: 'Lines and areas', weapon: 'Weapon ranges' });
const HIDDEN = new Set([...STYLE_KEYS, 'coa', 'layer']);

function geometryXml(g) {
  if (g.type === 'Point') return `<Point><coordinates>${coord(g.coordinates)}</coordinates></Point>`;
  if (g.type === 'LineString') return `<LineString><tessellate>1</tessellate><coordinates>${g.coordinates.map(coord).join(' ')}</coordinates></LineString>`;
  const rings = g.coordinates.map((ring) => `<LinearRing><coordinates>${ring.map(coord).join(' ')}</coordinates></LinearRing>`);
  return `<Polygon><tessellate>1</tessellate><outerBoundaryIs>${rings[0]}</outerBoundaryIs>${rings.slice(1).map((r) => `<innerBoundaryIs>${r}</innerBoundaryIs>`).join('')}</Polygon>`;
}

/** The placemark's name: the label (or symbol code / kind), with HVT marked. */
function nameOf(p) {
  if (p.layer === 'weapon') return `${p.weapon_name}${p.unit_label ? ` (${p.unit_label})` : ''}`;
  const base = p.label || (p.layer === 'unit' ? p.sidc : p.kind);
  return p.hvt === true ? `${base} [HVT]` : base;
}

/**
 * @param {object[]} features from coaFeatures()
 * @param {{ header: object, title?: string, iconFor?: (sidc: string) => string|null }} options
 *   iconFor: the href of a unit's symbol icon inside the KMZ (e.g. "icons/1006….png"), or null
 * @returns {string} a KML document
 */
export function writeKml(features, { header, title = 'COAs', iconFor = null }) {
  const styles = new Map(); // key → id
  const styleId = (p) => {
    const key = p.layer === 'unit'
      ? `u|${p['marker-color']}|${iconFor?.(p.sidc) ?? ''}`
      : `s|${p.stroke}|${p['stroke-width']}|${p['stroke-opacity'] ?? 1}|${p.fill ?? ''}|${p['fill-opacity'] ?? 0}`;
    if (!styles.has(key)) styles.set(key, { id: `s${styles.size + 1}`, p });
    return styles.get(key).id;
  };
  const byCoa = new Map();
  for (const f of features) {
    const coa = f.properties.coa ?? '';
    if (!byCoa.has(coa)) byCoa.set(coa, { unit: [], graphic: [], weapon: [] });
    byCoa.get(coa)[f.properties.layer ?? 'graphic'].push(f);
  }
  const placemark = (f) => {
    const p = f.properties;
    const data = Object.entries(p).filter(([k, v]) => !HIDDEN.has(k) && v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(v)}</value></Data>`).join('');
    return `<Placemark${f.id ? ` id="${xml(f.id)}"` : ''}><name>${xml(nameOf(p))}</name><styleUrl>#${styleId(p)}</styleUrl>`
      + `<ExtendedData>${data}</ExtendedData>${geometryXml(f.geometry)}</Placemark>`;
  };
  const folders = [...byCoa].map(([coa, layers]) => `<Folder><name>${xml(coa)}</name>${
    Object.entries(LAYER_FOLDERS).filter(([layer]) => layers[layer].length)
      .map(([layer, name]) => `<Folder><name>${name}</name>${layers[layer].map(placemark).join('')}</Folder>`).join('')
  }</Folder>`).join('');
  const styleXml = [...styles.values()].map(({ id, p }) => {
    if (p.layer === 'unit') {
      const href = iconFor?.(p.sidc);
      return `<Style id="${id}"><IconStyle>${href ? '' : `<color>${kmlColor(p['marker-color'])}</color>`}<scale>${href ? 1.2 : 1}</scale>`
        + `<Icon><href>${xml(href ?? 'http://maps.google.com/mapfiles/kml/paddle/wht-blank.png')}</href></Icon></IconStyle><LabelStyle><scale>0.9</scale></LabelStyle></Style>`;
    }
    return `<Style id="${id}"><LineStyle><color>${kmlColor(p.stroke, p['stroke-opacity'] ?? 1)}</color><width>${p['stroke-width'] ?? 2}</width></LineStyle>`
      + `<PolyStyle><color>${kmlColor(p.fill ?? p.stroke, p['fill-opacity'] ?? 0)}</color>${p.fill ? '' : '<fill>0</fill>'}</PolyStyle></Style>`;
  }).join('');
  const headerData = Object.entries(header).map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(v)}</value></Data>`).join('');
  const description = `${header.classification}\n${header.project}: ${title}\nExported ${header.dtg} by ${header.application}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>`
    + `<name>${xml(`${header.classification} // ${header.project} // ${title}`)}</name>`
    + `<Snippet maxLines="1">${xml(header.classification)}</Snippet><description>${xml(description)}</description>`
    + `<ExtendedData>${headerData}</ExtendedData>${styleXml}${folders}</Document></kml>\n`;
}
