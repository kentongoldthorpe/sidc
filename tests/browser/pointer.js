// Pointer helpers for browser specs.

const frame = () => new Promise((res) => requestAnimationFrame(res));

/** Drag an element by (dx, dy) pixels the way a real mouse does: pointer events followed by mouse events. */
export async function drag(el, dx, dy) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2; const y = r.top + r.height / 2;
  const init = (cx, cy, buttons) => ({ clientX: cx, clientY: cy, button: 0, buttons, bubbles: true, cancelable: true, composed: true, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true });
  const fire = (target, kind, cx, cy, buttons) => {
    target.dispatchEvent(new PointerEvent(`pointer${kind}`, init(cx, cy, buttons)));
    target.dispatchEvent(new MouseEvent(`mouse${kind}`, init(cx, cy, buttons)));
  };
  fire(el, 'down', x, y, 1);
  for (let i = 1; i <= 8; i++) {
    fire(el, 'move', x + (dx * i) / 8, y + (dy * i) / 8, 1);
    await frame();
  }
  fire(el, 'up', x + dx, y + dy, 0);
}
