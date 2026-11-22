// Composition root: the only module that reads browser/vendor globals and wires
// concrete adapters into the application core. For now (COA-1.1) it only mounts
// an empty, offline map; handlers and views are wired in later stories.

const { L } = globalThis;
const mapElement = document.getElementById('map');

if (L && mapElement) {
  // No tile layer: works offline. A base layer is decided in a later story (epic R1).
  L.map(mapElement, { center: [0, 0], zoom: 2, worldCopyJump: true });
} else {
  console.error('COA Builder: Leaflet failed to load or #map is missing.');
}
