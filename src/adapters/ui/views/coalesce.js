// Run `fn` once for a burst of calls: a group operation publishes one event per unit, and views
// should redraw once, not once per event (that was the stutter when copying many units).
export function coalesce(fn) {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; fn(); }, 0); // after the whole burst has been delivered
  };
}
