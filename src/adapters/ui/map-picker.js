// "Pick on map": one view asks for the next map click; the map view answers it.
export function createPicker() {
  let callback = null;
  const listeners = new Set();
  const notify = () => [...listeners].forEach((fn) => fn(callback !== null));

  const picker = Object.freeze({
    /** Ask for the next map click. @param {(latlng: {lat: number, lng: number}) => void} fn */
    request(fn) { callback = fn; notify(); return () => picker.cancel(); },
    cancel() { if (callback === null) return; callback = null; notify(); },
    /** Called by the map with the clicked position. @returns {boolean} whether anyone was waiting */
    resolve(latlng) {
      if (callback === null) return false;
      const fn = callback;
      callback = null;
      notify();
      fn(latlng);
      return true;
    },
    isActive: () => callback !== null,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  });
  return picker;
}
