// Placement (Epic 3, T-5): a threat template (metres; +y = direction of attack) laid on the map at an
// anchor and a bearing, keeping every distance and angle. A template point (x, y) goes to the
// geodesic destination from the anchor, `hypot(x, y)` metres along `bearing + atan2(x, y)`.
// placePlay builds the content of the situation template (SITTEMP) COA; the core creates it.
import { destination } from './geodesy.js';
import { STATEMENT_PARTS } from './threat-model.js';

const deg = (r) => (r * 180) / Math.PI;
const RANK_TEXT = Object.freeze({ mostLikely: 'Most likely', mostDangerous: 'Most dangerous', other: '' });
export const POSITIONS = Object.freeze(['start', 'end', 'endWithMoves']);

/** The map position of template point `p` for a template anchored at `anchor`, attacking along `bearing`. */
export function templateToMap(anchor, bearing, p) {
  const metres = Math.hypot(p.x, p.y);
  if (metres === 0) return { lat: anchor.lat, lng: anchor.lng };
  return destination(anchor, bearing + deg(Math.atan2(p.x, p.y)), metres);
}

const round = (p) => ({ lat: Math.round(p.lat * 1e7) / 1e7, lng: Math.round(p.lng * 1e7) / 1e7 });
const norm = (b) => ((b % 360) + 360) % 360;

function describe(model, coa) {
  const lines = [];
  if (coa) {
    if (RANK_TEXT[coa.rank]) lines.push(`${RANK_TEXT[coa.rank]} threat COA.`);
    for (const part of STATEMENT_PARTS) if (coa.statement[part]) lines.push(`${part.toUpperCase()}: ${coa.statement[part]}`);
    if (coa.endState) lines.push(`END STATE: ${coa.endState}`);
  } else if (model.description) {
    lines.push(model.description);
  }
  lines.push(`Placed from threat model "${model.name}"${coa ? `, ${coa.name}` : ' (formation)'}.`);
  return lines.join('\n');
}

/**
 * The SITTEMP content for a play: { name, description, symbols, graphics, source } (no ids yet).
 * @param {object} model a ThreatModel
 * @param {{ play: string, anchor: {lat, lng}, bearing: number, positions: 'start'|'end'|'endWithMoves', systems: Map<string, object> }} placement
 * @returns {object|null} null when the play does not exist
 */
export function placePlay(model, { play, anchor, bearing, positions }) {
  const coa = play === 'formation' ? null : model.coas.find((c) => c.id === play);
  if (play !== 'formation' && !coa) return null;
  const template = coa ? coa.template : model.formation;
  const toMap = (p) => round(templateToMap(anchor, bearing, p));
  const at = (u) => (positions === 'start' || !u.end ? u : u.end);

  // Each unit takes its weapons, HVT tag and details with it (D28); its facing becomes a true bearing.
  const symbols = template.units.map((u) => ({
    sidc: u.sidc, position: toMap(at(u)), label: u.label, modifiers: {},
    facing: norm(bearing + (u.facing ?? 0)), hvt: u.hvt ?? false, weapons: u.weapons ?? [], details: u.details ?? {},
    link: { key: `unit:${u.id}` }, // stays linked to the play (D30)
  }));
  const graphics = template.graphics.map((g) => {
    const { id, ...rest } = g;
    const link = { key: `graphic:${id}` };
    return g.points ? { ...rest, points: g.points.map(toMap), link } : { ...rest, center: toMap(g.center), link };
  });
  template.units.forEach((u, i) => {
    const center = symbols[i].position;
    if (positions === 'endWithMoves' && u.end) {
      graphics.push({ kind: 'axisOfAdvance', side: 'hostile', label: '', points: [toMap(u), center], link: { key: `move:${u.id}` } });
    }
  });
  return {
    name: `${coa ? coa.name : model.name} (SITTEMP)`,
    description: describe(model, coa),
    symbols, graphics,
    source: { threatModelId: model.id, play, anchor, bearing, positions, modelRevision: model.revision },
  };
}

/**
 * A linked COA brought up to date with a fresh placement of its play (D30): `built` is the checked
 * content of placePlay (symbols and graphics with links, no ids). Linked items are replaced by their
 * fresh version (keeping their ids); a unit the user moved keeps its position; items whose key the
 * user deleted (source.excluded) stay out; items no longer in the play go; the user's own items stay.
 * New items are added at the end with ids from `newId`.
 * @returns {{ symbols: object[], graphics: object[], added: number, removed: number }}
 */
export function mergePlacement(coa, built, { newId }) {
  const excluded = new Set(coa.source?.excluded ?? []);
  const merge = (current, fresh, prefix, keep = (item, f) => f) => {
    const byKey = new Map(fresh.filter((f) => !excluded.has(f.link.key)).map((f) => [f.link.key, f]));
    const seen = new Set();
    let removed = 0;
    const kept = current.flatMap((item) => {
      if (!item.link) return [item];
      const f = byKey.get(item.link.key);
      if (!f) { removed += 1; return []; }
      seen.add(item.link.key);
      return [{ ...keep(item, f), id: item.id }];
    });
    const added = [...byKey.values()].filter((f) => !seen.has(f.link.key)).map((f) => ({ ...f, id: newId(prefix) }));
    return { items: [...kept, ...added], added: added.length, removed };
  };
  const units = merge(coa.symbols, built.symbols, 'sym', (item, f) => (item.link.moved ? { ...f, position: item.position, link: item.link } : f));
  const lines = merge(coa.graphics, built.graphics, 'gfx');
  return { symbols: units.items, graphics: lines.items, added: units.added + lines.added, removed: units.removed + lines.removed };
}
