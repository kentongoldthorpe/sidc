// CSV (RFC 4180) for data files: quoted fields, "" escapes, line breaks inside quotes, CRLF or LF.
//
// Spreadsheet safety: a text cell that starts with = + - @ (or a tab/CR) would be run as a formula
// by Excel and friends ("CSV injection"). writeCsv prefixes such text with an apostrophe, the usual
// defence; readCsv users strip it again with undefuse(). Numbers are written as they are.

const FORMULA_START = /^[=+\-@\t\r]/;

/** @param {unknown} value @returns {string} one CSV field */
function field(value) {
  if (value === undefined || value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** @param {string[]} header @param {unknown[][]} rows @returns {string} with a UTF-8 BOM (Excel) and CRLF lines */
export function writeCsv(header, rows) {
  return `\uFEFF${[header, ...rows].map((r) => r.map(field).join(',')).join('\r\n')}\r\n`;
}

/** Undo writeCsv's formula defence: "'=x" → "=x". */
export const undefuse = (text) => (/^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text);

/**
 * @param {string} text
 * @returns {{ ok: true, rows: { line: number, cells: string[] }[] } | { ok: false, line: number, reason: string }}
 *   line: the 1-based line each record starts on; blank lines are skipped.
 */
export function readCsv(text) {
  let src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  // Lines starting with "#" before the header are comments: our exports put the marking line there.
  let skipped = 0;
  while (src.startsWith('#')) { const end = src.indexOf('\n'); src = end === -1 ? '' : src.slice(end + 1); skipped += 1; }
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1 + skipped;
  let rowLine = 1 + skipped;
  let sawAny = false; // anything on this record (so a blank line is skipped)
  const endCell = () => { cells.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    if (sawAny) rows.push({ line: rowLine, cells });
    cells = [];
    sawAny = false;
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line += 1; cell += c; }
    } else if (c === '"' && cell === '') { quoted = true; sawAny = true; }
    else if (c === ',') { endCell(); sawAny = true; }
    else if (c === '\r' && src[i + 1] === '\n') { /* handled by \n */ }
    else if (c === '\n') { endRow(); line += 1; rowLine = line; }
    else { cell += c; sawAny = true; }
  }
  if (quoted) return { ok: false, line: rowLine, reason: 'has a quote (") that is never closed' };
  endRow();
  return { ok: true, rows };
}
