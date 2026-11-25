// Cursor-on-Target for TAK (Epic 5 X-5, D40): every unit, line, area and weapon range of the COAs
// as a CoT event, packed as a TAK data package (a zip with MANIFEST/manifest.xml) that ATAK, WinTAK
// and iTAK import. Built from the same exchange features as GeoJSON and KML.
//
//   - Units are "a-<affiliation>-<dimension>[-<function>]" events. A 2525C code gives the full
//     function (SHGPUCI---- → a-h-G-U-C-I); a 2525D/E code gives affiliation, dimension and
//     unit/equipment/installation, and travels whole in <__milsym id="…"/> for TAK versions that
//     draw 2525D.
//   - Lines are "u-d-f" drawing shapes; areas, rings, sectors and weapon ranges are "u-d-f" shapes
//     closed by repeating the first point (as TAK's drawing tool writes them).
//   - uids are stable ("coa-builder.<coa id>.<item id>"), so sending a COA again updates it in TAK.
//   - Every event carries the classification marking in its remarks; the package name carries it too.
import { coaFeatures } from './features.js';
import { xml } from './kml.js';
import { writeZip, crc32 } from './zip.js';

const D_IDENTITY = Object.freeze({ 0: 'p', 1: 'u', 2: 'a', 3: 'f', 4: 'n', 5: 's', 6: 'h' });
const C_IDENTITY = Object.freeze({ P: 'p', U: 'u', A: 'a', F: 'f', N: 'n', S: 's', H: 'h', J: 'j', K: 'k', G: 'p', W: 'u', M: 'a', D: 'f', L: 'n', O: 'o' });
const D_DIMENSION = Object.freeze({ '01': 'A', '02': 'A', '05': 'P', '06': 'P', 10: 'G', 11: 'G', 15: 'G', 20: 'G', 27: 'G', 40: 'G', 30: 'S', 35: 'U', 36: 'U' });
const D_GROUND_KIND = Object.freeze({ 10: 'U', 11: 'U', 27: 'U', 15: 'E', 20: 'I' });

/**
 * The CoT type of a 2525 symbol code.
 * @param {string} sidc @returns {string} e.g. "a-h-G-U-C-I" (2525C) or "a-h-G-U" (2525D/E)
 */
export function cotType(sidc) {
  const s = String(sidc ?? '').toUpperCase();
  if (/^\d{20}(\d{10})?$/.test(s)) {
    const set = s.slice(4, 6);
    const dim = D_DIMENSION[set] ?? D_DIMENSION[Number(set)] ?? 'X';
    const kind = dim === 'G' ? D_GROUND_KIND[Number(set)] : undefined;
    return ['a', D_IDENTITY[s[3]] ?? 'u', dim, ...(kind ? [kind] : [])].join('-');
  }
  if (/^[A-Z0-9*-]{15}$/.test(s)) {
    const dim = /[PAGSUF]/.test(s[2]) ? s[2] : 'X';
    const fn = s.slice(4, 10).replace(/[-*].*$/, '').split('');
    return ['a', C_IDENTITY[s[1]] ?? 'u', dim, ...fn].join('-');
  }
  return 'a-u-G';
}

/** "#rrggbb" + opacity → the signed 32-bit ARGB integer TAK uses for colours. */
export function takColor(hex, opacity = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  const rgb = m ? parseInt(m[1], 16) : 0x808080;
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  return ((a << 24) | rgb) | 0;
}

const r7 = (n) => Math.round(n * 1e7) / 1e7;
const POINT_UNKNOWN = 'hae="9999999.0" ce="9999999.0" le="9999999.0"';
const point = ([lng, lat]) => `<point lat="${r7(lat)}" lon="${r7(lng)}" ${POINT_UNKNOWN}/>`;
const uidPart = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_'); // also a file name in the package

/** A unit's remarks: the marking first, then what a TAK user needs to know about it. */
function unitRemarks(p, coaName, marking) {
  const weapons = [];
  for (let i = 1; p[`weapon${i}_name`] !== undefined; i++) {
    const arc = p[`weapon${i}_arc_deg`];
    weapons.push(`${p[`weapon${i}_name`]} (${p[`weapon${i}_role`]}, ${p[`weapon${i}_min_m`] ? `${p[`weapon${i}_min_m`]}–` : ''}${p[`weapon${i}_max_m`]} m${arc !== undefined && arc < 360 ? `, ${arc}°` : ''})`);
  }
  return [
    marking, `COA: ${coaName}`, p.hvt ? 'HVT' : '',
    p.higherFormation ? `Higher: ${p.higherFormation}` : '', p.strength ? `Strength: ${p.strength}` : '', p.equipment ? `Equipment: ${p.equipment}` : '',
    weapons.length ? `Weapons: ${weapons.join('; ')}` : '', p.facing !== undefined ? `Facing: ${p.facing}°` : '',
    p.additionalInformation ?? '', p.staffComments ?? '', p.notes ? `Notes: ${p.notes}` : '', p.reference ? `Ref: ${p.reference}` : '',
  ].filter(Boolean).join(' | ');
}

function event({ uid, type, time, stale, at, detail }) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<event version="2.0" uid="${xml(uid)}" type="${xml(type)}" how="h-e" time="${time}" start="${time}" stale="${stale}">`
    + `${point(at)}<detail>${detail}<archive/></detail></event>\n`;
}

/**
 * Every COA's units, lines, areas and weapon ranges as CoT events.
 * @param {object[]} coas @param {{ header: object, staleHours?: number }} options
 *   header: from export.header (the time and the marking); staleHours: how long TAK treats them as current (default 168, a week)
 * @returns {{ uid: string, name: string, xml: string }[]}
 */
export function cotEvents(coas, { header, staleHours = 168 }) {
  const time = new Date(header.exportedAt).toISOString();
  const stale = new Date(Date.parse(time) + staleHours * 3600_000).toISOString();
  const marking = header.classification;
  return coas.flatMap((coa) => coaFeatures([coa]).map((f) => {
    const p = f.properties;
    const uid = `coa-builder.${uidPart(coa.id)}.${uidPart(f.id)}`;
    if (p.layer === 'unit') {
      const name = p.label || p.sidc;
      const detail = `<contact callsign="${xml(p.hvt ? `${name} [HVT]` : name)}"/><__milsym id="${xml(p.sidc)}"/>`
        + `${p.direction !== undefined ? `<track course="${Number(p.direction)}" speed="0.0"/>` : ''}<remarks>${xml(unitRemarks(p, coa.name, marking))}</remarks>`;
      return { uid, name, xml: event({ uid, type: cotType(p.sidc), time, stale, at: f.geometry.coordinates, detail }) };
    }
    const closed = f.geometry.type === 'Polygon';
    const points = closed ? f.geometry.coordinates[0] : f.geometry.coordinates;
    const name = p.layer === 'weapon' ? `${p.weapon_name}${p.unit_label ? ` (${p.unit_label})` : ''}` : (p.label || p.kind);
    const kind = p.layer === 'weapon' ? `weapon range, ${p.role}` : p.kind;
    const detail = points.map(([lng, lat]) => `<link point="${r7(lat)},${r7(lng)}"/>`).join('')
      + `<strokeColor value="${takColor(p.stroke, p['stroke-opacity'] ?? 1)}"/><strokeWeight value="${Number(p['stroke-width'] ?? 2).toFixed(1)}"/>`
      + `${closed ? `<fillColor value="${takColor(p.fill ?? p.stroke, p['fill-opacity'] ?? 0)}"/>` : ''}`
      + `<contact callsign="${xml(name)}"/><labels_on value="true"/><remarks>${xml(`${marking} | COA: ${coa.name} | ${kind}${p.annotation ? ` | ${p.annotation}` : ''}`)}</remarks>`;
    return { uid, name, xml: event({ uid, type: 'u-d-f', time, stale, at: points[0], detail }) };
  }));
}

/**
 * A TAK data package: MANIFEST/manifest.xml and one .cot file per event.
 * @param {{ coas: object[], header: object, title?: string, staleHours?: number }} input
 * @returns {Uint8Array} the zip bytes
 */
export function buildTakPackage({ coas, header, title = 'COAs', staleHours }) {
  const events = cotEvents(coas, { header, staleHours });
  const packageUid = `coa-builder-${crc32(new TextEncoder().encode(coas.map((c) => c.id).join(','))).toString(16).padStart(8, '0')}`;
  const files = events.map((e) => ({ ...e, path: `cot/${e.uid}.cot` }));
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<MissionPackageManifest version="2"><Configuration>`
    + `<Parameter name="uid" value="${packageUid}"/><Parameter name="name" value="${xml(`${title} (${header.classification})`)}"/>`
    + `<Parameter name="onReceiveDelete" value="false"/></Configuration><Contents>`
    + files.map((f) => `<Content ignore="false" zipEntry="${xml(f.path)}"><Parameter name="uid" value="${xml(f.uid)}"/><Parameter name="name" value="${xml(f.name)}"/></Content>`).join('')
    + `</Contents></MissionPackageManifest>\n`;
  return writeZip([{ name: 'MANIFEST/manifest.xml', data: manifest }, ...files.map((f) => ({ name: f.path, data: f.xml }))]);
}
