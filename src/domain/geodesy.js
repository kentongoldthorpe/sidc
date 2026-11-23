// Geodesy on a sphere with Leaflet's earth radius, so what is drawn matches what the map measures.
// Pure functions for ground distances and directions: sectors of fire on the map and slides, and
// placing a template (metres) onto the map (Epic 3).

export const EARTH_RADIUS = 6371000; // metres (Leaflet's L.CRS.Earth.R)
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** The point `metres` from `start` along `bearing` (degrees clockwise from true north). */
export function destination(start, bearing, metres) {
  const lat1 = rad(start.lat);
  const angular = metres / EARTH_RADIUS;
  const b = rad(bearing);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(b));
  const lng2 = rad(start.lng) + Math.atan2(Math.sin(b) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: deg(lng2) };
}

/** Great-circle distance in metres (haversine). */
export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The direction from a to b at a, in degrees clockwise from true north, in [0, 360). */
export function initialBearing(a, b) {
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Outline of a sector of fire on the ground: a wedge from the centre (a band with a minimum range;
 * a full ring when the arc is 360°), `arc` degrees wide, centred on `bearing`.
 * @returns {{ lat: number, lng: number }[]} closed outline (the last point joins the first)
 */
export function sectorOutlineGeo(center, { radius, minRadius = 0, bearing, arc }, stepDegrees = 4) {
  const full = arc >= 360;
  const steps = Math.max(8, Math.ceil(arc / stepDegrees));
  const angles = Array.from({ length: full ? steps : steps + 1 }, (_, i) => bearing - arc / 2 + (arc * i) / steps);
  const outer = angles.map((a) => destination(center, a, radius));
  if (minRadius) return [...outer, ...angles.slice().reverse().map((a) => destination(center, a, minRadius))];
  return full ? outer : [{ lat: center.lat, lng: center.lng }, ...outer];
}
