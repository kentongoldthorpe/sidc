// KMZ (Epic 5 X-3): the KML plus each unit's 2525 symbol as a PNG icon, zipped (doc.kml first, as
// Google Earth expects). Symbols are drawn by `renderIcon`, which the browser side supplies.
import { coaFeatures } from './features.js';
import { writeKml } from './kml.js';
import { writeZip } from './zip.js';

/** A file name for a symbol code's icon. */
export const iconPath = (sidc) => `icons/${String(sidc).replace(/[^A-Za-z0-9*-]/g, '_')}.png`;

/**
 * @param {{ coas: object[], header: object, title?: string, renderIcon: (sidc: string) => Promise<Uint8Array|null> }} input
 * @returns {Promise<Uint8Array>} the KMZ bytes
 */
export async function buildKmz({ coas, header, title = 'COAs', renderIcon }) {
  const features = coaFeatures(coas);
  const sidcs = [...new Set(coas.flatMap((c) => c.symbols.map((s) => s.sidc)))];
  const icons = new Map();
  for (const sidc of sidcs) {
    const png = await renderIcon(sidc);
    if (png) icons.set(sidc, png);
  }
  const kml = writeKml(features, { header, title, iconFor: (sidc) => (icons.has(sidc) ? iconPath(sidc) : null) });
  return writeZip([{ name: 'doc.kml', data: kml }, ...[...icons].map(([sidc, data]) => ({ name: iconPath(sidc), data }))]);
}
