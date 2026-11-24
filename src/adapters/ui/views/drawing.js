// One way to draw a drawing (M10-4b, D30): the same units' weapon ranges, lines, areas, rings and
// sectors, and the same symbol icons, on the map (lat/lng), on the template canvas (metres, flat)
// and in the placement preview. A *space* says how a drawing's points become Leaflet positions and
// how a sector's outline is worked out there.
import { sectorOutlineGeo, destination } from '../../../domain/geodesy.js';
import { sectorOutline, pointAt } from '../../../domain/template-geometry.js';
import { graphicColor, shapeOf } from '../../../domain/graphic.js';
import { coverageGraphics } from '../../../domain/weapon.js';

/** Map space: { lat, lng } points, geodesic sectors. */
export const MAP_SPACE = Object.freeze({
  toLatLng: (p) => [p.lat, p.lng],
  sector: (g) => sectorOutlineGeo(g.center, g),
  along: (center, bearing, metres) => destination(center, bearing, metres),
  above: (center, metres) => ({ lat: center.lat + metres / 111195, lng: center.lng }),
});

/** Template space: { x, y } metres, +y the direction of attack (Leaflet CRS.Simple: latlng = [y, x]). */
export const TEMPLATE_SPACE = Object.freeze({
  toLatLng: (p) => [p.y, p.x],
  sector: (g) => sectorOutline(g.center, g),
  along: (center, bearing, metres) => pointAt(center, bearing, metres),
  above: (center, metres) => ({ x: center.x, y: center.y + metres }),
});

export const HOSTILE_DASH = '10 6';

/**
 * A Leaflet layer for one line, area, ring or sector. `style` adds to or overrides the defaults
 * (colour from the side or `color`, dashed for hostile, filled for areas, rings and sectors).
 */
export function shapeLayer(L, graphic, space, style = {}) {
  const shape = shapeOf(graphic.kind);
  const base = { color: graphicColor(graphic), weight: 3, dashArray: graphic.side === 'hostile' ? HOSTILE_DASH : null, ...style };
  if (shape === 'circle') return L.circle(space.toLatLng(graphic.center), { fillOpacity: 0.05, ...base, radius: graphic.radius });
  if (shape === 'sector') return L.polygon(space.sector(graphic).map(space.toLatLng), { fillOpacity: 0.1, ...base });
  if (shape === 'area') return L.polygon(graphic.points.map(space.toLatLng), { fillOpacity: 0.12, ...base });
  return L.polyline(graphic.points.map(space.toLatLng), { ...base, fill: false });
}

/**
 * The label of a graphic: above the middle of a line, in the middle of an area, on the top edge of
 * a ring (its centre is often a unit) and two thirds along a sector's centre line (clear of the
 * weapon). Labels are text nodes: they can come from files. @returns {object[]} layers added to `group`
 */
export function addLabel(L, group, layer, graphic, space, doc) {
  if (!graphic.label) return [];
  const shape = shapeOf(graphic.kind);
  const onLine = shape === 'line';
  const options = { permanent: true, direction: onLine ? 'top' : 'center', offset: onLine ? [0, -4] : [0, 0], className: 'graphic-label', interactive: false };
  const text = doc.createTextNode(graphic.label);
  if (shape === 'circle') return [L.tooltip(options).setLatLng(space.toLatLng(space.above(graphic.center, graphic.radius))).setContent(text).addTo(group)];
  if (shape === 'sector') return [L.tooltip(options).setLatLng(space.toLatLng(space.along(graphic.center, graphic.bearing, graphic.radius * 0.66))).setContent(text).addTo(group)];
  layer.bindTooltip(text, options).openTooltip();
  return [];
}

/** Every unit's weapon ranges as graphics, in the units' space (`positionOf` gives a unit's centre). */
export function weaponRanges(units, positionOf = (u) => u.position) {
  return units.flatMap((u) => coverageGraphics({ ...u, position: positionOf(u) }).map((g) => ({ ...g, coverage: true, unitId: u.id })));
}

/**
 * Symbol icons from the app's renderer, fetched once per look and shared by everything drawn with
 * this cache. @returns {(symbol: { sidc, label?, modifiers? }) => Promise<{ html, iconSize, iconAnchor } | null>}
 */
export function createIconCache(client, size) {
  const cache = new Map();
  return (symbol) => {
    const key = JSON.stringify([symbol.sidc, symbol.label ?? '', symbol.modifiers ?? {}]);
    if (!cache.has(key)) {
      cache.set(key, client.ask('symbol.preview', { sidc: symbol.sidc, label: symbol.label ?? '', modifiers: symbol.modifiers ?? {}, size })
        .then((r) => (r.ok ? { html: r.value.svg, iconSize: [Math.round(r.value.width), Math.round(r.value.height)], iconAnchor: [Math.round(r.value.anchor.x), Math.round(r.value.anchor.y)] } : null)));
    }
    return cache.get(key);
  };
}

/** Put the HVT badge (CSS) under the symbol's anchor. */
export function markHvt(element, hvt, icon) {
  element.classList.toggle('is-hvt', hvt === true);
  if (hvt && icon) {
    element.style.setProperty('--anchor-x', `${icon.iconAnchor[0]}px`);
    element.style.setProperty('--anchor-y', `${icon.iconAnchor[1]}px`);
  }
}
