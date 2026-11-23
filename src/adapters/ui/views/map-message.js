// A short status message in the map's bottom-left corner (e.g. "Move not saved: …"), cleared after a while.
const MESSAGE_MS = 6000;

/** @returns {{ say(text: string): void, remove(): void }} */
export function createMapMessage(L, map) {
  let element;
  let timer;
  const control = L.control({ position: 'bottomleft' });
  control.onAdd = () => {
    element = L.DomUtil.create('div', 'map-message');
    element.setAttribute('role', 'status');
    return element;
  };
  control.addTo(map);
  return {
    say(text) {
      element.textContent = text;
      clearTimeout(timer);
      if (text) timer = setTimeout(() => { element.textContent = ''; }, MESSAGE_MS);
    },
    remove() { clearTimeout(timer); control.remove(); },
  };
}
