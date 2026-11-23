// Undo / Redo buttons and shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y). Shortcuts are left to
// the browser while typing in a field, so text fields keep their own undo.
import { el, describeError } from './dom.js';

const MESSAGE_MS = 6000;
const isTyping = (target) => /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '') || target?.isContentEditable;

/** @param {{ root: HTMLElement, history: object, doc?: Document }} options @returns {{ destroy(): void }} */
export function mountUndoControls({ root, history, doc = root.ownerDocument }) {
  let timer = null;
  const status = el('span', { class: 'history-status', attrs: { role: 'status' } });
  const say = (text) => { status.textContent = text; clearTimeout(timer); if (text) timer = setTimeout(() => { status.textContent = ''; }, MESSAGE_MS); };
  async function run(action) {
    const result = await action();
    if (result.ok) { say(''); return; }
    say(result.error.code === 'CONFLICT'
      ? 'Not undone: this COA was changed in another window. Select it again to reload it.'
      : `Not undone: ${describeError(result.error)}`);
  }
  const undo = el('button', { attrs: { type: 'button', title: 'Undo the last change to this COA (Ctrl+Z)' }, text: 'Undo', on: { click: () => run(history.undo) } });
  const redo = el('button', { attrs: { type: 'button', title: 'Redo (Ctrl+Shift+Z)' }, text: 'Redo', on: { click: () => run(history.redo) } });
  root.append(el('div', { class: 'history-actions actions' }, undo, redo, status));

  const show = ({ canUndo, canRedo }) => { undo.disabled = !canUndo; redo.disabled = !canRedo; };
  show(history.state());
  const off = history.subscribe(show);

  const onKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); run(history.undo); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); run(history.redo); }
  };
  doc.addEventListener('keydown', onKey);

  return {
    destroy() {
      off();
      clearTimeout(timer);
      doc.removeEventListener('keydown', onKey);
      root.querySelector('.history-actions')?.remove();
    },
  };
}
