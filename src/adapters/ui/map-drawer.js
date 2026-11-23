// "Draw on map": one view asks for a new line, area or range ring; the draw tool on the map
// collects the clicks and answers. Like the picker, at most one request is active.
//   request({ shape: 'line'|'area'|'circle', radius?: metres }, onDone) – onDone({ points } | { center, radius })
export function createDrawer() {
  let active = null; // { request, onDone }
  const listeners = new Set();
  const notify = () => [...listeners].forEach((fn) => fn(active?.request ?? null));

  const drawer = Object.freeze({
    request(request, onDone) { active = { request, onDone }; notify(); return () => drawer.cancel(); },
    cancel() { if (active === null) return; active = null; notify(); },
    /** Called by the draw tool with the finished geometry. */
    finish(geometry) {
      if (active === null) return;
      const { onDone } = active;
      active = null;
      notify();
      onDone(geometry);
    },
    isActive: () => active !== null,
    current: () => active?.request ?? null,
    /** fn(request | null) on every start, finish and cancel. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  });
  return drawer;
}
