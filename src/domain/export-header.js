// The header every data export carries (Epic 5 X-1): what a file is, where it came from and, above
// all, its classification marking, so the marking travels with the data and not only on slides.
//   { classification, classificationColor, project, exportedAt, dtg, application, format, formatVersion }
import { deepFreeze } from '../shared/freeze.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-11-24T21:05:00.000Z" → "242105ZNOV26" (day, hour, minute, Z, month, two-digit year). */
export function dtgOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso));
  if (!m) return '';
  return `${m[3]}${m[4]}${m[5]}Z${MONTHS[Number(m[2]) - 1]}${m[1].slice(2)}`;
}

/**
 * @param {{ marking: { text: string, color: string }, project: string, exportedAt: string, application: string,
 *           format: string, formatVersion: number }} input
 */
export function exportHeader({ marking, project, exportedAt, application, format, formatVersion }) {
  return deepFreeze({
    classification: marking.text, classificationColor: marking.color, project,
    exportedAt, dtg: dtgOf(exportedAt), application, format, formatVersion,
  });
}

/** The header as one line, for formats without a place for structured metadata (a CSV's first line). */
export const headerLine = (h) => `# ${h.classification} // ${h.project} // exported ${h.dtg} // ${h.application} // ${h.format} v${h.formatVersion}`;

/** The keys a header may have (importers accept and ignore it). */
export const HEADER_KEYS = Object.freeze(['classification', 'classificationColor', 'project', 'exportedAt', 'dtg', 'application', 'format', 'formatVersion', 'versions']);
