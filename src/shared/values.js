// Small value helpers shared by every layer (pure, no host APIs).

/** A non-null object that is not an array (e.g. a parsed JSON object). */
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Wrap a longitude into [-180, 180). In-range values are returned untouched (no float drift). */
export const wrapLng = (lng) => (lng >= -180 && lng < 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180);
