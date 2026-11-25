// Map features for other systems (Epic 5 X-2, D39): COAs → GeoJSON features with flat properties
// and real geometry, the one shape every exchange writer starts from (GeoJSON now, KML next).
//
//   layer "unit"     a Point; sidc, label, modifiers, facing, hvt, details and each weapon as flat
//                    fields: weapon1_name, weapon1_role, weapon1_max_m, weapon1_min_m, weapon1_arc_deg …
//   layer "graphic"  a LineString or Polygon; range rings and sectors are geodesic Polygons that any
//                    GIS draws, with their parameters kept (centerLat, centerLng, radius, minRadius,
//                    bearing, arc) so COA Builder can read them back exactly
//   layer "weapon"   a unit's weapon range as a Polygon (drawn from the unit, D28): for GIS only
//
// Every feature also has simplestyle-spec properties (stroke, stroke-width, fill, fill-opacity,
// marker-color), which many viewers draw directly and the KML writer turns into styles.
import { graphicColor, shapeOf } from '../../domain/graphic.js';
import { sectorOutlineGeo } from '../../domain/geodesy.js';
import { coverageGraphics, sideOfSidc } from '../../domain/weapon.js';
import { SIDE_COLORS } from '../../domain/graphic.js';

export const EXCHANGE_FORMAT = 'coa-builder/geojson';
export const EXCHANGE_VERSION = 2;
/** Styling properties: written for viewers, ignored when reading back. */
export const STYLE_KEYS = Object.freeze(['stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'marker-color', 'marker-size']);

const position = (p) => [p.lng, p.lat];
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const closedRing = (points) => [...points, points[0]].map((p) => [r6(p.lng), r6(p.lat)]);

/** "T-72B3 x10; BMP-2 x1" */
export const equipmentText = (list) => list.map((e) => `${e.name} x${e.count}`).join('; ');

/** A unit's flat fields (everything but geometry and style). */
export function unitProperties(u) {
  const props = { sidc: u.sidc, label: u.label, ...Object.fromEntries(Object.entries(u.modifiers ?? {}).filter(([, v]) => v !== '' && v !== undefined)) };
  if (u.facing !== undefined) props.facing = u.facing;
  props.hvt = u.hvt === true;
  if (u.details?.strength) props.strength = u.details.strength;
  if (u.details?.equipment?.length) props.equipment = equipmentText(u.details.equipment);
  if (u.details?.reference) props.reference = u.details.reference;
  if (u.details?.notes) props.notes = u.details.notes;
  (u.weapons ?? []).forEach((w, i) => {
    const n = `weapon${i + 1}`;
    Object.assign(props, { [`${n}_name`]: w.name, [`${n}_role`]: w.role, [`${n}_max_m`]: w.maxRange, ...(w.minRange ? { [`${n}_min_m`]: w.minRange } : {}), [`${n}_arc_deg`]: w.arc });
  });
  if (u.link) { props.template_link = u.link.key; props.off_template = u.link.moved === true; }
  return props;
}

function graphicFeature(coaName, g) {
  const shape = shapeOf(g.kind);
  const color = graphicColor(g);
  const base = { coa: coaName, layer: 'graphic', kind: g.kind, side: g.side, label: g.label, ...(g.annotation ? { annotation: g.annotation } : {}), ...(g.color ? { color: g.color } : {}) };
  const style = { stroke: color, 'stroke-width': 3, 'stroke-opacity': 1 };
  if (shape === 'line') {
    return { type: 'Feature', id: g.id, geometry: { type: 'LineString', coordinates: g.points.map(position) }, properties: { ...base, ...style } };
  }
  if (shape === 'area') {
    return { type: 'Feature', id: g.id, geometry: { type: 'Polygon', coordinates: [closedRing(g.points)] }, properties: { ...base, ...style, fill: color, 'fill-opacity': 0.12 } };
  }
  // A ring or sector: the outline as a polygon, the parameters kept.
  const outline = shape === 'circle' ? sectorOutlineGeo(g.center, { radius: g.radius, bearing: 0, arc: 360 }, 3) : sectorOutlineGeo(g.center, g);
  const params = { centerLat: g.center.lat, centerLng: g.center.lng, radius: g.radius, ...(shape === 'sector' ? { ...(g.minRadius ? { minRadius: g.minRadius } : {}), bearing: g.bearing, arc: g.arc } : {}) };
  return { type: 'Feature', id: g.id, geometry: { type: 'Polygon', coordinates: [closedRing(outline)] }, properties: { ...base, ...params, ...style, fill: color, 'fill-opacity': shape === 'sector' ? 0.1 : 0.05 } };
}

function weaponFeatures(coaName, u) {
  return coverageGraphics(u).map((g, i) => {
    const w = u.weapons[i];
    const outline = sectorOutlineGeo(g.center, g.kind === 'rangeRing' ? { radius: g.radius, bearing: 0, arc: 360 } : g, 3);
    return {
      type: 'Feature', id: g.id,
      geometry: { type: 'Polygon', coordinates: [closedRing(outline)] },
      properties: {
        coa: coaName, layer: 'weapon', unit_id: u.id, unit_label: u.label, unit_sidc: u.sidc, weapon_name: w.name, role: w.role,
        max_m: w.maxRange, ...(w.minRange ? { min_m: w.minRange } : {}), arc_deg: w.arc, bearing_deg: g.kind === 'sector' ? g.bearing : 0, hvt: u.hvt === true,
        stroke: g.color, 'stroke-width': 1.5, 'stroke-opacity': 0.9, fill: g.color, 'fill-opacity': 0.08,
      },
    };
  });
}

/**
 * Every COA's units, graphics and weapon ranges as GeoJSON features.
 * @param {object[]} coas @param {{ weapons?: boolean }} [options] weapons: include weapon-range polygons (default true)
 */
export function coaFeatures(coas, { weapons = true } = {}) {
  return coas.flatMap((c) => [
    ...c.symbols.map((u) => ({
      type: 'Feature', id: u.id, geometry: { type: 'Point', coordinates: position(u.position) },
      properties: { coa: c.name, layer: 'unit', ...unitProperties(u), 'marker-color': SIDE_COLORS[sideOfSidc(u.sidc)] ?? SIDE_COLORS.unknown },
    })),
    ...c.graphics.map((g) => graphicFeature(c.name, g)),
    ...(weapons ? c.symbols.flatMap((u) => weaponFeatures(c.name, u)) : []),
  ]);
}

// ---- reading v2 features back (the importer) ----

const WEAPON_FIELD = /^weapon(\d+)_(name|role|max_m|min_m|arc_deg)$/;
const WEAPON_KEYS = Object.freeze({ name: 'name', role: 'role', max_m: 'maxRange', min_m: 'minRange', arc_deg: 'arc' });

/** "T-72B3 x10; BMP-2 x1" → [{ name, count }] (a part that does not read stays text, so the core reports it). */
export function readEquipment(text) {
  return String(text).split(';').map((s) => s.trim()).filter(Boolean).map((part) => {
    const m = /^(.*?)\s*[x×]\s*(\d+)$/i.exec(part);
    return m ? { name: m[1].trim(), count: Number(m[2]) } : { name: part, count: 1 };
  });
}

/**
 * A v2 feature's properties → what the GeoJSON importer already understands: units with weapons
 * and details as objects, rings and sectors as a centre Point with their parameters. Weapon-range
 * features → null (they are drawn from units, not imported). Other features pass through.
 * @returns {object|null} a feature
 */
export function fromExchangeFeature(feature) {
  const props = feature.properties ?? {};
  if (!('layer' in props)) return feature;
  const { layer, ...rest } = props;
  for (const key of STYLE_KEYS) delete rest[key];
  if (layer === 'weapon') return null;
  if (layer === 'graphic') {
    const { centerLat, centerLng, ...g } = rest;
    if (centerLat === undefined) return { ...feature, properties: g };
    return { ...feature, geometry: { type: 'Point', coordinates: [centerLng, centerLat] }, properties: g };
  }
  // A unit.
  const unit = {};
  const weapons = [];
  const details = {};
  for (const [key, value] of Object.entries(rest)) {
    const w = WEAPON_FIELD.exec(key);
    if (w) { (weapons[Number(w[1]) - 1] ??= {})[WEAPON_KEYS[w[2]]] = value; continue; }
    if (key === 'strength' || key === 'reference' || key === 'notes') { details[key] = value; continue; }
    if (key === 'equipment') { details.equipment = readEquipment(value); continue; }
    if (key === 'template_link' || key === 'off_template') continue; // a link to a threat play does not travel
    if (key === 'hvt' && value === false) continue;
    unit[key] = value;
  }
  if (weapons.length) unit.weapons = weapons.filter(Boolean);
  if (Object.keys(details).length) unit.details = details;
  return { ...feature, properties: unit };
}
