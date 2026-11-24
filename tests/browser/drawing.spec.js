// M10-4b One drawing renderer (D30). Direct test, reason: drawing.js is the shared piece the map,
// the template canvas and the placement preview draw with; this checks the two spaces agree.
import { describe, it, afterEach, assert } from './runner.js';
import { sandbox } from './app-fixture.js';
import { MAP_SPACE, TEMPLATE_SPACE, shapeLayer, addLabel, weaponRanges } from '../../src/adapters/ui/views/drawing.js';

const L = window.L;
let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });
const AD = { name: 'SA-15', role: 'airDefence', maxRange: 5000 };
const GUN = { name: 'Gun', role: 'direct', maxRange: 2500, arc: 60 };

function mapIn(crs) {
  const host = sandbox();
  host.style.cssText = 'width: 600px; height: 400px;';
  const map = crs ? L.map(host, { crs: L.CRS.Simple, center: [0, 0], zoom: -4 }) : L.map(host, { center: [34, -118], zoom: 10 });
  cleanups.push(() => { map.remove(); host.remove(); });
  return { map, host };
}

describe('drawing.js: one renderer for the map and the template canvas', () => {
  it('draws a unit\'s weapons the same way in both spaces: a ring and a sector in the weapon role\'s colours, with labels', () => {
    const geo = mapIn(false);
    const flat = mapIn(true);
    const ranges = (space, unit, map, host) => weaponRanges([unit]).map((g) => {
      const layer = shapeLayer(L, g, space, { className: `t-${g.role}` }).addTo(map);
      addLabel(L, map, layer, g, space, document);
      return [g.kind, host.querySelector(`.t-${g.role}`).getAttribute('stroke')];
    });
    const onMap = ranges(MAP_SPACE, { id: 'u', sidc: '10061000001211000000', position: { lat: 34, lng: -118 }, facing: 90, weapons: [AD, GUN] }, geo.map, geo.host);
    const onCanvas = ranges(TEMPLATE_SPACE, { id: 'u', sidc: '10061000001211000000', position: { x: 0, y: 0 }, facing: 90, weapons: [AD, GUN] }, flat.map, flat.host);
    assert.deepEqual(onMap, [['rangeRing', '#7b3fa0'], ['sector', '#c8102e']]);
    assert.deepEqual(onCanvas, onMap);
    for (const host of [geo.host, flat.host]) assert.deepEqual([...host.querySelectorAll('.graphic-label')].map((l) => l.textContent).sort(), ['Gun', 'SA-15']);
  });

  it('points a sector along the facing in both spaces (east is right)', () => {
    for (const [space, unit, crs] of [[MAP_SPACE, { lat: 34, lng: -118 }, false], [TEMPLATE_SPACE, { x: 0, y: 0 }, true]]) {
      const { map } = mapIn(crs);
      const [g] = weaponRanges([{ id: 'u', sidc: '10061000001211000000', position: unit, facing: 90, weapons: [GUN] }]);
      const layer = shapeLayer(L, g, space).addTo(map);
      const centre = map.latLngToContainerPoint(space.toLatLng(unit));
      const points = layer.getLatLngs()[0].slice(1).map((p) => map.latLngToContainerPoint(p));
      assert.ok(points.every((p) => p.x > centre.x), JSON.stringify({ centre, points: points.slice(0, 2) }));
    }
  });
});
