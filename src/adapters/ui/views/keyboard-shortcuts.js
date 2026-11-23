// Keyboard actions on the selected unit or line/area/ring (H-3):
//   Delete       remove it (undoable: Ctrl+Z, said in a note)
//   Arrow keys   nudge it 10 screen pixels (Shift: 50); Leaflet's own arrow panning is off while
//                something is selected, so the two never fight
//   Escape       close the unit editor / clear the selection
// Keys are left alone while typing in a field, while a dialog is open, and while picking or drawing.
import { describeError } from './dom.js';

const STEP_PX = 10;
const BIG_STEP_PX = 50;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const isTyping = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '') || t?.isContentEditable;
const clampLat = (lat) => Math.max(-90, Math.min(90, lat));

/**
 * @param {{ client: object, map: object, activeCoa: object, symbolSelection: object, graphicSelection: object,
 *           picker: object, drawer: object, note?: (text: string) => void, doc?: Document }} options
 * @returns {{ destroy(): void }}
 */
export function mountKeyboardShortcuts({ client, map, activeCoa, symbolSelection, graphicSelection, picker, drawer, note = () => {}, doc = map.getContainer().ownerDocument }) {
  const pending = new Map(); // id → the last nudged geometry sent, until the store catches up

  const target = () => {
    const coa = activeCoa.get();
    if (!coa) return null;
    const unit = coa.symbols.find((s) => s.id === symbolSelection.get());
    if (unit) return { coa, kind: 'unit', item: unit };
    const graphic = coa.graphics.find((g) => g.id === graphicSelection.get());
    return graphic ? { coa, kind: 'graphic', item: graphic } : null;
  };

  /** The lat/lng change for a move of (dx, dy) screen pixels around the middle of the map. */
  function delta(dx, dy) {
    const middle = map.getSize().divideBy(2);
    const a = map.containerPointToLatLng(middle);
    const b = map.containerPointToLatLng(middle.add([dx, dy]));
    return { lat: b.lat - a.lat, lng: b.lng - a.lng };
  }
  const shift = (p, d) => ({ lat: clampLat(p.lat + d.lat), lng: p.lng + d.lng });

  async function nudge({ coa, kind, item }, d) {
    const base = pending.get(item.id) ?? item;
    let result;
    if (kind === 'unit') {
      const position = shift(base.position, d);
      pending.set(item.id, { position });
      result = await client.send('symbol.move', { coaId: coa.id, symbolId: item.id, position });
    } else {
      const geometry = base.points ? { points: base.points.map((p) => shift(p, d)) } : { center: shift(base.center, d) };
      pending.set(item.id, geometry);
      result = await client.send('graphic.update', { coaId: coa.id, graphicId: item.id, ...geometry });
    }
    if (!result.ok) { pending.delete(item.id); note(`Not moved: ${describeError(result.error)}`); }
  }

  async function remove({ coa, kind, item }) {
    const result = kind === 'unit'
      ? await client.send('symbol.remove', { coaId: coa.id, symbolId: item.id })
      : await client.send('graphic.remove', { coaId: coa.id, graphicId: item.id });
    if (!result.ok) { note(`Not deleted: ${describeError(result.error)}`); return; }
    (kind === 'unit' ? symbolSelection : graphicSelection).set(null);
    note(`Deleted ${kind === 'unit' ? 'the unit' : 'it'}. Ctrl+Z brings it back.`);
  }

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || doc.querySelector('dialog[open]') || picker.isActive() || drawer.isActive()) return;
    if (e.key === 'Escape') {
      if (symbolSelection.get() !== null || graphicSelection.get() !== null) { symbolSelection.set(null); graphicSelection.set(null); }
      return;
    }
    const current = target();
    if (!current) return;
    if (e.key === 'Delete') { e.preventDefault(); remove(current); return; }
    const arrow = ARROWS[e.key];
    if (arrow) {
      e.preventDefault();
      const px = e.shiftKey ? BIG_STEP_PX : STEP_PX;
      nudge(current, delta(arrow[0] * px, arrow[1] * px));
    }
  };
  doc.addEventListener('keydown', onKey);

  // Leaflet pans the map with the arrow keys: not while they nudge something.
  const syncMapKeys = () => { if (symbolSelection.get() !== null || graphicSelection.get() !== null) map.keyboard?.disable(); else map.keyboard?.enable(); };
  const forgetCaughtUp = (coa) => {
    for (const [id, geometry] of pending) {
      const item = coa?.symbols.find((s) => s.id === id) ?? coa?.graphics.find((g) => g.id === id);
      if (!item || JSON.stringify(Object.keys(geometry).map((k) => item[k])) === JSON.stringify(Object.values(geometry))) pending.delete(id);
    }
  };
  const offs = [
    symbolSelection.subscribe(() => { pending.clear(); syncMapKeys(); }),
    graphicSelection.subscribe(() => { pending.clear(); syncMapKeys(); }),
    activeCoa.subscribe(forgetCaughtUp),
  ];

  return {
    destroy() {
      doc.removeEventListener('keydown', onKey);
      offs.forEach((off) => off());
      map.keyboard?.enable();
    },
  };
}
