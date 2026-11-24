// Geometry in template space (Epic 3): metres, (0, 0) the reference point, +y the direction of
// attack, bearings in degrees clockwise from +y. Pure functions used by the template canvas and,
// later, by placement on the map.

const rad = (deg) => (deg * Math.PI) / 180;

/** The point `distance` metres from `origin` along `bearing`. */
export const pointAt = (origin, bearing, distance) => ({
  x: origin.x + distance * Math.sin(rad(bearing)),
  y: origin.y + distance * Math.cos(rad(bearing)),
});

/**
 * Outline of a field of fire: a wedge from the centre (or, with a minimum range, a band between two
 * arcs), `arc` degrees wide and centred on `bearing`.
 * @returns {{ x: number, y: number }[]} a closed outline (the last point joins the first)
 */
export function sectorOutline(center, { radius, minRadius = 0, bearing, arc }, stepDegrees = 5) {
  const steps = Math.max(8, Math.ceil(arc / stepDegrees));
  const angles = Array.from({ length: steps + 1 }, (_, i) => bearing - arc / 2 + (arc * i) / steps);
  const outer = angles.map((a) => pointAt(center, a, radius));
  if (!minRadius) return [{ x: center.x, y: center.y }, ...outer];
  const inner = angles.slice().reverse().map((a) => pointAt(center, a, minRadius));
  return [...outer, ...inner];
}

/**
 * What a unit's weapons cover, to scale (D28): a ring for an all-round weapon, a sector along the
 * unit's facing otherwise. Each shape names its `weapon`.
 * @param {{ x: number, y: number, facing?: number, weapons?: object[] }} unit
 */
export function coverageOf(unit) {
  const center = { x: unit.x, y: unit.y };
  return (unit.weapons ?? []).map((weapon) => (weapon.arc >= 360
    ? { kind: 'ring', weapon, center, radius: weapon.maxRange, minRadius: weapon.minRange ?? 0 }
    : { kind: 'sector', weapon, points: sectorOutline(center, { radius: weapon.maxRange, minRadius: weapon.minRange ?? 0, bearing: unit.facing ?? 0, arc: weapon.arc }) }));
}

/** Frontage (across the direction of attack) and depth (along it) of a set of units, in metres. */
export function formationExtent(units) {
  if (units.length === 0) return { frontage: 0, depth: 0 };
  const xs = units.map((u) => u.x);
  const ys = units.map((u) => u.y);
  return { frontage: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) };
}
