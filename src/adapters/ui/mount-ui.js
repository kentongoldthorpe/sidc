// Mounts the UI on the shell markup in index.html (a driving adapter).
// For now: panel toggles, the storage status and an empty Leaflet map. Views
// (COA list, symbol editor, map symbols) plug in here in later stories and talk
// to the application only through the app client.

/**
 * @param {{ client: object, L: object, root: HTMLElement, storageLabel?: string, narrow?: boolean }} options
 *   narrow: small-screen mode (panels closed, one open at a time); defaults to a media query.
 * @returns {{ map: object, destroy: () => void }}
 */
export function mountUi({ client, L, root, storageLabel = '', narrow }) {
  if (!(root instanceof HTMLElement)) throw new TypeError('mountUi: a root element is required');
  if (typeof L?.map !== 'function') throw new TypeError('mountUi: Leaflet (L) is required');
  void client; // used by the views added in COA-1.20 onwards

  const win = root.ownerDocument.defaultView;
  const isNarrow = narrow ?? win.matchMedia('(max-width: 720px)').matches;
  const toggles = [...root.querySelectorAll('.panel-toggle[aria-controls]')];
  const panelFor = (button) => root.querySelector(`#${button.getAttribute('aria-controls')}`);

  const map = L.map(root.querySelector('#map'), { center: [20, 0], zoom: 2, worldCopyJump: true });

  function setOpen(button, open) {
    button.setAttribute('aria-expanded', String(open));
    panelFor(button).dataset.open = String(open);
  }

  const onToggle = (event) => {
    const button = event.currentTarget;
    const open = button.getAttribute('aria-expanded') !== 'true';
    if (open && isNarrow) toggles.filter((b) => b !== button).forEach((b) => setOpen(b, false));
    setOpen(button, open);
    map.invalidateSize();
  };

  toggles.forEach((button) => {
    setOpen(button, !isNarrow);
    button.addEventListener('click', onToggle);
  });
  root.querySelector('[data-storage-status]').textContent = storageLabel;
  map.invalidateSize();

  return {
    map,
    destroy() {
      toggles.forEach((button) => button.removeEventListener('click', onToggle));
      map.remove();
    },
  };
}
