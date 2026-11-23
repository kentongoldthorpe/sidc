// Draw tool (driving adapter on the Leaflet map): answers drawer requests.
//   line / area: click to add points; double-click or Enter finishes; Backspace removes the last
//                point; Esc or Cancel stops. Finishing needs 2 points for a line, 3 for an area.
//   circle:      click the centre, then click the edge (or only the centre when a radius was given).
// While drawing, a hint on the map says what to do, and double-click zoom is off.
const MIN_POINTS = { line: 2, area: 3 };
const PREVIEW = { color: '#5b6157', weight: 2, dashArray: '4 4', interactive: false, fill: false };

/** @param {{ L: object, map: object, drawer: object }} options @returns {{ destroy(): void }} */
export function mountDrawTool({ L, map, drawer }) {
  let points = [];
  let center = null;
  let cursor = null;
  const preview = L.layerGroup().addTo(map);
  let hint = null;
  let hintText = null;
  let zoomWasOn = false;

  const request = () => drawer.current();
  const plain = (ll) => ({ lat: ll.lat, lng: ll.lng });

  function redraw() {
    preview.clearLayers();
    const r = request();
    if (!r) return;
    if (r.shape === 'circle') {
      if (center && cursor) L.circle(center, { ...PREVIEW, radius: map.distance(center, cursor) }).addTo(preview);
      if (center) L.circleMarker(center, { ...PREVIEW, radius: 4, dashArray: null }).addTo(preview);
      return;
    }
    const line = cursor ? [...points, cursor] : points;
    if (line.length > 1) (r.shape === 'area' ? L.polygon : L.polyline)(line, { ...PREVIEW, fill: r.shape === 'area', fillOpacity: 0.08 }).addTo(preview);
    points.forEach((p) => L.circleMarker(p, { ...PREVIEW, radius: 4, dashArray: null }).addTo(preview));
    updateHint();
  }

  function message() {
    const r = request();
    if (r.shape === 'circle') return center ? 'Click the edge of the ring to set its radius' : 'Click the centre of the ring';
    const need = MIN_POINTS[r.shape] - points.length;
    return `Click to add points; double-click or press Enter to finish${need > 0 ? ` (${need} more needed)` : ''}. Backspace removes the last point.`;
  }
  const updateHint = () => { if (hintText) hintText.textContent = `${message()} `; };

  function showHint(on) {
    hint?.remove();
    hint = null;
    hintText = null;
    if (!on) return;
    hint = L.control({ position: 'topright' });
    hint.onAdd = () => {
      const box = L.DomUtil.create('div', 'pick-hint draw-hint');
      box.dataset.drawHint = '';
      box.setAttribute('role', 'status');
      hintText = L.DomUtil.create('span', '', box);
      const cancel = L.DomUtil.create('button', 'link', box);
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(cancel, 'click', () => drawer.cancel());
      return box;
    };
    hint.addTo(map);
    updateHint();
  }

  function finish() {
    const r = request();
    if (!r || r.shape === 'circle' || points.length < MIN_POINTS[r.shape]) return;
    drawer.finish({ points: points.map(plain) });
  }

  const onClick = (e) => {
    const r = request();
    if (!r) return;
    if (r.shape === 'circle') {
      if (!center) {
        center = e.latlng;
        if (r.radius) { drawer.finish({ center: plain(center), radius: r.radius }); return; }
      } else {
        drawer.finish({ center: plain(center), radius: Math.round(map.distance(center, e.latlng)) });
        return;
      }
    } else {
      points.push(e.latlng);
    }
    redraw();
  };
  const onDblClick = (e) => {
    const r = request();
    if (!r || r.shape === 'circle') return;
    // A double-click also fired two clicks at the same spot: keep that point once.
    const near = (a, b) => map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b)) < 4;
    while (points.length > 1 && near(points.at(-1), points.at(-2))) points.pop();
    if (points.length === 0 || !near(points.at(-1), e.latlng)) points.push(e.latlng);
    finish();
  };
  const onMove = (e) => { if (request()) { cursor = e.latlng; redraw(); } };
  const onKey = (e) => {
    if (!request()) return;
    if (e.key === 'Escape') drawer.cancel();
    else if (e.key === 'Enter') { e.preventDefault(); finish(); }
    else if (e.key === 'Backspace' && request().shape !== 'circle' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) {
      e.preventDefault();
      points.pop();
      redraw();
    }
  };

  const off = drawer.subscribe((r) => {
    points = [];
    center = null;
    cursor = null;
    map.getContainer().classList.toggle('is-drawing', r !== null);
    if (r && !hint) {
      zoomWasOn = map.doubleClickZoom.enabled();
      map.doubleClickZoom.disable();
    } else if (!r && hint && zoomWasOn) {
      map.doubleClickZoom.enable();
    }
    showHint(r !== null);
    redraw();
  });
  map.on('click', onClick);
  map.on('dblclick', onDblClick);
  map.on('mousemove', onMove);
  document.addEventListener('keydown', onKey);

  return {
    destroy() {
      off();
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('mousemove', onMove);
      document.removeEventListener('keydown', onKey);
      showHint(false);
      preview.remove();
    },
  };
}
