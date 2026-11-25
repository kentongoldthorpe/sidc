// MGRS and UTM on WGS 84 (Epic 3 follow-up G-1, D43): converting positions, and the grid zones
// the map grid is drawn in. Pure arithmetic, no dependencies.
//
//   toUtm({ lat, lng })            → { zone, hemisphere: 'N'|'S', easting, northing } (metres)
//   fromUtm({ zone, hemisphere, easting, northing }) → { lat, lng }
//   toMgrs({ lat, lng }, digits=5) → "18S UJ 23486 06483" (digits per axis, 0–5; truncated, as MGRS is)
//   parseMgrs(text)                → { lat, lng } at the centre of the square named, or { problems }
//   zoneOf(lat, lng)               → the UTM zone, with the Norway (32V) and Svalbard (31X–37X) exceptions
//   gridZones(south, west, north, east) → the grid zone cells { zone, band, south, west, north, east } in a box
//
// MGRS covers 80°S to 84°N (UPS, near the poles, is not handled: those positions give null).
// Transverse Mercator by the Krüger series (Karney 2011), to the third order: within a millimetre
// across a zone and its exceptions (checked against pyproj in the tests).

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N_ = F / (2 - F);
const RECT = (A / (1 + N_)) * (1 + N_ ** 2 / 4 + N_ ** 4 / 64);
const ALPHA = [N_ / 2 - (2 * N_ ** 2) / 3 + (5 * N_ ** 3) / 16, (13 * N_ ** 2) / 48 - (3 * N_ ** 3) / 5, (61 * N_ ** 3) / 240];
const BETA = [N_ / 2 - (2 * N_ ** 2) / 3 + (37 * N_ ** 3) / 96, N_ ** 2 / 48 + N_ ** 3 / 15, (17 * N_ ** 3) / 480];
const DELTA = [2 * N_ - (2 * N_ ** 2) / 3 - 2 * N_ ** 3, (7 * N_ ** 2) / 3 - (8 * N_ ** 3) / 5, (56 * N_ ** 3) / 15];
const C2N = (2 * Math.sqrt(N_)) / (1 + N_);
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
export const MGRS_SOUTH = -80;
export const MGRS_NORTH = 84;
const COLUMNS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

/** The latitude band letter, or null outside 80°S–84°N. */
export function bandOf(lat) {
  if (!(lat >= MGRS_SOUTH && lat <= MGRS_NORTH)) return null;
  return BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
}
/** The southern and northern latitude of a band (X runs 72°–84°). */
export const bandLimits = (band) => {
  const i = BANDS.indexOf(band);
  return { south: -80 + i * 8, north: band === 'X' ? 84 : -80 + (i + 1) * 8 };
};

const wrap = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** The UTM zone (1–60) of a position, with the Norway and Svalbard exceptions. */
export function zoneOf(lat, lng) {
  const lon = wrap(lng);
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat <= 84 && lon >= 0 && lon < 42) return lon < 9 ? 31 : lon < 21 ? 33 : lon < 33 ? 35 : 37;
  return Math.min(60, Math.floor((lon + 180) / 6) + 1);
}
export const centralMeridian = (zone) => (zone - 1) * 6 - 180 + 3;

/** UTM coordinates in a given zone (also outside it, for drawing a zone's grid to its edge). Krüger series (Karney 2011). */
export function toUtmInZone({ lat, lng }, zone) {
  const phi = rad(lat);
  const lam = rad(wrap(lng - centralMeridian(zone)));
  const sin = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sin) - C2N * Math.atanh(C2N * sin));
  const xi = Math.atan2(t, Math.cos(lam));
  const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let e = eta;
  let n = xi;
  ALPHA.forEach((a, i) => {
    const j = 2 * (i + 1);
    e += a * Math.cos(j * xi) * Math.sinh(j * eta);
    n += a * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  return { zone, hemisphere: lat < 0 ? 'S' : 'N', easting: 500000 + K0 * RECT * e, northing: (lat < 0 ? 10000000 : 0) + K0 * RECT * n };
}

/** UTM coordinates of a position, in its own zone. */
export const toUtm = ({ lat, lng }) => toUtmInZone({ lat, lng }, zoneOf(lat, lng));

/** The position of UTM coordinates. */
export function fromUtm({ zone, hemisphere, easting, northing }) {
  const xi = ((hemisphere === 'S' ? northing - 10000000 : northing)) / (K0 * RECT);
  const eta = (easting - 500000) / (K0 * RECT);
  let xi1 = xi;
  let eta1 = eta;
  BETA.forEach((b, i) => {
    const j = 2 * (i + 1);
    xi1 -= b * Math.sin(j * xi) * Math.cosh(j * eta);
    eta1 -= b * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  DELTA.forEach((d, i) => { phi += d * Math.sin(2 * (i + 1) * chi); });
  const lam = Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return { lat: deg(phi), lng: wrap(centralMeridian(zone) + deg(lam)) };
}

/** The 100 km square letters of UTM coordinates, e.g. "UJ". */
export function squareOf(zone, easting, northing) {
  const column = COLUMNS[(zone - 1) % 3][Math.floor(easting / 100000) - 1] ?? '?';
  const row = ROWS[(Math.floor(northing / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20];
  return `${column}${row}`;
}

/**
 * An MGRS reference, e.g. "18S UJ 23486 06483". Digits are truncated, so the reference names the
 * square the position is in. @param {number} [digits] per axis, 0 (100 km square) to 5 (1 m)
 * @returns {string | null} null outside 80°S–84°N
 */
export function toMgrs({ lat, lng }, digits = 5) {
  const band = bandOf(lat);
  if (!band) return null;
  const { zone, easting, northing } = toUtm({ lat, lng });
  const square = squareOf(zone, easting, northing);
  const part = (v) => String(Math.floor(Math.round(v * 1000) / 1000 % 100000)).padStart(5, '0').slice(0, digits);
  return [`${zone}${band}`, square, ...(digits > 0 ? [part(easting), part(northing)] : [])].join(' ');
}

/** The lowest northing a band reaches in a zone (to undo the 2,000 km cycle of the row letters). */
function minNorthing(zone, band) {
  const { south } = bandLimits(band);
  const cm = centralMeridian(zone);
  return Math.min(...[cm - 3, cm, cm + 3].map((lng) => toUtmInZone({ lat: south, lng }, zone).northing));
}

const MGRS_PATTERN = /^(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])\s*([A-HJ-NP-V])\s*(\d*)\s*(\d*)$/;

/**
 * Read an MGRS reference ("18SUJ2348606483", "18S UJ 234 064", "18S UJ"): spaces optional,
 * 0 to 5 digits per axis (the same number for both). The result is the centre of the square named.
 * @returns {{ lat: number, lng: number, precision: number } | { problems: { field: string, reason: string }[] }}
 *   precision: the size of the square named, in metres
 */
export function parseMgrs(text, field = 'mgrs') {
  const bad = (reason) => ({ problems: [{ field, reason }] });
  if (typeof text !== 'string') return bad('must be text like 18S UJ 23486 06483');
  const match = MGRS_PATTERN.exec(text.trim().toUpperCase());
  if (!match) return bad('must be an MGRS reference like 18S UJ 23486 06483');
  const [, z, band, col, row, eText, nText] = match;
  let digits = eText;
  let north = nText;
  if (!north && digits.length % 2 === 0) { north = digits.slice(digits.length / 2); digits = digits.slice(0, digits.length / 2); }
  const zone = Number(z);
  if (zone < 1 || zone > 60) return bad('has no UTM zone between 1 and 60');
  if (digits.length !== north.length || digits.length > 5) return bad('needs the same number of digits (at most 5) for easting and northing');
  const ci = COLUMNS[(zone - 1) % 3].indexOf(col);
  const ri = (ROWS.indexOf(row) - (zone % 2 === 0 ? 5 : 0) + 20) % 20;
  if (ci < 0) return bad(`has a 100 km square column ${col} that zone ${zone} does not use`);
  const precision = 10 ** (5 - digits.length);
  const offset = (s) => (s ? Number(s) * precision : 0) + precision / 2;
  const easting = (ci + 1) * 100000 + offset(digits);
  let northing = ri * 100000 + offset(north);
  const hemisphere = band >= 'N' ? 'N' : 'S';
  const min = minNorthing(zone, band) - 100000;
  while (northing < min) northing += 2000000;
  const { lat, lng } = fromUtm({ zone, hemisphere, easting, northing });
  if (bandOf(lat) !== band && Math.abs(lat - (bandLimits(band).south + bandLimits(band).north) / 2) > 8) return bad(`is not in latitude band ${band}`);
  return { lat, lng, precision };
}

/**
 * The grid zone cells (one UTM zone by one latitude band) that meet a box, with the Norway and
 * Svalbard exceptions. @returns {{ zone: number, band: string, south: number, west: number, north: number, east: number }[]}
 */
export function gridZones(south, west, north, east) {
  const cells = [];
  const s = Math.max(MGRS_SOUTH, south);
  const n = Math.min(MGRS_NORTH, north);
  for (let i = 0; i < BANDS.length; i++) {
    const band = BANDS[i];
    const lim = bandLimits(band);
    if (lim.north <= s || lim.south >= n) continue;
    // Longitude spans of each zone in this band, in [-180, 180).
    const spans = [];
    for (let zone = 1; zone <= 60; zone++) {
      let w = centralMeridian(zone) - 3;
      let e = w + 6;
      if (band === 'V' && zone === 31) e = 3;
      if (band === 'V' && zone === 32) { w = 3; e = 12; }
      if (band === 'X' && zone >= 31 && zone <= 37) {
        if (zone % 2 === 0) continue; // 32X, 34X and 36X are not used
        [w, e] = { 31: [0, 9], 33: [9, 21], 35: [21, 33], 37: [33, 42] }[zone];
      }
      spans.push({ zone, w, e });
    }
    // The box may span the antimeridian (east < west after wrapping), or more than 360°.
    for (const shift of [-360, 0, 360]) {
      for (const { zone, w, e } of spans) {
        const cw = w + shift;
        const ce = e + shift;
        if (ce <= west || cw >= east) continue;
        cells.push({ zone, band, south: lim.south, west: cw, north: lim.north, east: ce });
      }
    }
  }
  return cells;
}

// ---- grid lines for a view ----

const MAX_LINES = 120; // per grid zone and axis: more would be a smear, not a grid

/** Split a sampled line into the runs inside a box, finding each crossing by bisection. */
function clipRuns(sample, inside, steps) {
  const runs = [];
  let run = null;
  let prevT = 0;
  let prevIn = inside(sample(0));
  if (prevIn) run = [sample(0)];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = sample(t);
    const isIn = inside(p);
    if (isIn !== prevIn) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (inside(sample(mid)) === prevIn) lo = mid; else hi = mid; }
      const edge = sample(isIn ? hi : lo);
      if (isIn) run = [edge]; else { run.push(edge); runs.push(run); run = null; }
    }
    if (isIn) run.push(p);
    prevT = t;
    prevIn = isIn;
  }
  if (run && run.length > 1) runs.push(run);
  return runs;
}

/**
 * The MGRS grid in a box: grid zone boundaries, and easting and northing lines every `spacing`
 * metres in each grid zone, cut at the zone's edges (the grid bends: lines are sampled, not
 * straight), with the 100 km square names.
 * @param {{ south: number, west: number, north: number, east: number }} box degrees (east may exceed 180)
 * @param {number | null} spacing 100, 1000, 10000 or 100000 metres; null: grid zone boundaries only
 * @returns {{ zones: object[], lines: { zone, band, axis: 'e'|'n', value: number, points: {lat,lng}[] }[],
 *             squares: { zone, band, id: string, center: {lat,lng} }[] }}
 */
export function mgrsGridLines(box, spacing) {
  const zones = gridZones(box.south, box.west, box.north, box.east);
  const lines = [];
  const squares = [];
  if (!spacing) return { zones, lines, squares };
  for (const cell of zones) {
    const clip = {
      south: Math.max(cell.south, box.south), north: Math.min(cell.north, box.north),
      west: Math.max(cell.west, box.west), east: Math.min(cell.east, box.east),
    };
    if (clip.south >= clip.north || clip.west >= clip.east) continue;
    const lngShift = Math.round((cell.west - centralMeridian(cell.zone)) / 360) * 360; // the cell may be a copy one world east or west
    const hemisphere = cell.band >= 'N' ? 'N' : 'S';
    const inside = (p) => p.lat >= clip.south - 1e-9 && p.lat <= clip.north + 1e-9 && p.lng >= clip.west - 1e-9 && p.lng <= clip.east + 1e-9;
    const toPos = (easting, northing) => { const p = fromUtm({ zone: cell.zone, hemisphere, easting, northing }); return { lat: p.lat, lng: p.lng + lngShift }; };
    // The UTM extent of the clipped cell, from points around its edge.
    const edge = [];
    for (let i = 0; i <= 8; i++) {
      const f = i / 8;
      const lat = clip.south + (clip.north - clip.south) * f;
      const lng = clip.west + (clip.east - clip.west) * f;
      edge.push([clip.south, lng], [clip.north, lng], [lat, clip.west], [lat, clip.east]);
    }
    const utm = edge.map(([lat, lng]) => toUtmInZone({ lat, lng: lng - lngShift }, cell.zone));
    const minE = Math.min(...utm.map((u) => u.easting));
    const maxE = Math.max(...utm.map((u) => u.easting));
    const minN = Math.min(...utm.map((u) => u.northing));
    const maxN = Math.max(...utm.map((u) => u.northing));
    const first = (min) => Math.ceil(min / spacing) * spacing;
    if ((maxE - minE) / spacing > MAX_LINES || (maxN - minN) / spacing > MAX_LINES) continue;
    const steps = 24;
    for (let e = first(minE); e <= maxE; e += spacing) {
      for (const points of clipRuns((t) => toPos(e, minN + (maxN - minN) * t), inside, steps)) lines.push({ zone: cell.zone, band: cell.band, axis: 'e', value: e, points });
    }
    for (let n = first(minN); n <= maxN; n += spacing) {
      for (const points of clipRuns((t) => toPos(minE + (maxE - minE) * t, n), inside, steps)) lines.push({ zone: cell.zone, band: cell.band, axis: 'n', value: n, points });
    }
    for (let e = Math.floor(minE / 100000) * 100000; e < maxE; e += 100000) {
      for (let n = Math.floor(minN / 100000) * 100000; n < maxN; n += 100000) {
        const center = toPos(e + 50000, n + 50000);
        if (inside(center) && e >= 100000 && e < 900000) squares.push({ zone: cell.zone, band: cell.band, id: squareOf(cell.zone, e + 1, n + 1), center });
      }
    }
  }
  return { zones, lines, squares };
}

/** The nearest grid intersection at a spacing, in the position's own zone. */
export function nearestMgrsIntersection({ lat, lng }, spacing) {
  if (!bandOf(lat)) return null;
  const u = toUtm({ lat, lng });
  const round = (v) => Math.round(v / spacing) * spacing;
  const p = fromUtm({ ...u, easting: round(u.easting), northing: round(u.northing) });
  return { lat: p.lat, lng: p.lng + Math.round((lng - p.lng) / 360) * 360 };
}

/** A line's label: kilometres within the 100 km square ("34"), or hundreds of metres ("345") at 100 m. */
export const gridLineLabel = (value, spacing) => (spacing >= 1000
  ? String(Math.floor((value % 100000) / 1000)).padStart(2, '0')
  : String(Math.floor((value % 100000) / 100)).padStart(3, '0'));

/**
 * The reference to show for a stored position: the shortest (3 to 5 digits) whose square's centre
 * is this position, so a grid typed as "18S UJ 2348 0648" reads back the same; otherwise 1 m.
 * @returns {string | null} null outside 80°S–84°N
 */
export function mgrsOf(position) {
  for (const digits of [3, 4]) {
    const text = toMgrs(position, digits);
    if (!text) return null;
    const centre = parseMgrs(text);
    if (!centre.problems && Math.abs(centre.lat - position.lat) < 1e-7 && Math.abs(centre.lng - position.lng) < 1e-7) return text;
  }
  return toMgrs(position, 5);
}

/**
 * Do a position and an MGRS reference agree: is the position in (or within a metre of) the square
 * the reference names? For checking a file that gives both.
 * @returns {boolean | null} null when the reference cannot be read
 */
export function mgrsAgrees(position, text) {
  const p = parseMgrs(text);
  if (p.problems) return null;
  const a = toUtm(p);
  const b = toUtmInZone(position, a.zone);
  const half = p.precision / 2 + 1;
  return Math.abs(a.easting - b.easting) <= half && Math.abs(a.northing - b.northing) <= half;
}
