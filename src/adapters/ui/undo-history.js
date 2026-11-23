// Undo / redo for the selected COA (decision D19: one history per COA, for the session).
// It watches the active-COA store: whenever the selected COA reaches a new revision, the content
// before the change goes on its undo stack (a burst such as a group copy is one step, because the
// store loads once per burst). Undo and redo put content back with coa.restore, which refuses with
// CONFLICT if the COA was changed somewhere this window has not seen, so nothing is overwritten.
//   state() → { coaId, canUndo, canRedo }   subscribe(fn)   undo() / redo() → Result   destroy()
const contentOf = ({ name, description, frame, symbols, graphics }) => ({ name, description, ...(frame ? { frame } : {}), symbols, graphics });

/** @param {{ client: object, activeCoa: object, limit?: number }} options */
export function createUndoHistory({ client, activeCoa, limit = 50 }) {
  const histories = new Map(); // coaId → { undo: content[], redo: content[], revision }
  const listeners = new Set();
  let current = null; // { coaId, revision, content }
  let stepping = false;
  let ownRevision = null; // the revision our own undo/redo produced: not a new change

  const historyOf = (coaId) => {
    if (!histories.has(coaId)) histories.set(coaId, { undo: [], redo: [], revision: null });
    return histories.get(coaId);
  };
  const state = () => {
    const h = current && histories.get(current.coaId);
    return Object.freeze({ coaId: current?.coaId ?? null, canUndo: Boolean(h?.undo.length) && !stepping, canRedo: Boolean(h?.redo.length) && !stepping });
  };
  const notify = () => { const s = state(); [...listeners].forEach((fn) => fn(s)); };

  const off = activeCoa.subscribe((coa) => {
    if (!coa) { current = null; notify(); return; }
    const h = historyOf(coa.id);
    if (current?.coaId === coa.id && coa.revision > current.revision) {
      if (!stepping && coa.revision !== ownRevision) {
        h.undo.push(current.content);
        if (h.undo.length > limit) h.undo.shift();
        h.redo = [];
      }
    } else if (current?.coaId !== coa.id && h.revision !== null && h.revision !== coa.revision) {
      // It changed while another COA was selected: its old steps no longer line up.
      h.undo = [];
      h.redo = [];
    }
    h.revision = coa.revision;
    current = { coaId: coa.id, revision: coa.revision, content: contentOf(coa) };
    notify();
  });

  async function step(from, to) {
    const h = current && histories.get(current.coaId);
    if (!h || h[from].length === 0 || stepping) return { ok: true, value: null };
    const { coaId, content: before } = current;
    stepping = true;
    notify();
    const result = await client.send('coa.restore', { coaId, content: h[from].at(-1) });
    if (result.ok) {
      ownRevision = result.value.revision;
      h[from].pop();
      h[to].push(before);
    }
    stepping = false;
    notify();
    return result;
  }

  return {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    undo: () => step('undo', 'redo'),
    redo: () => step('redo', 'undo'),
    destroy() { off(); listeners.clear(); histories.clear(); },
  };
}
