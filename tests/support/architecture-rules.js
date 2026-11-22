// Architecture fitness rules for the hexagon's core.
//
// Layers (inner → outer): shared ← domain ← application ← adapters (+ main.js).
// A core file may import only from its own layer or layers further in, may not import
// anything outside src/ (vendor, tests), may not use bare / node: / URL specifiers, and
// may not touch browser or vendor globals. Adapters and main.js are not checked.
//
// Uses only the Node standard library. The scanner is a small lexer that understands
// comments, strings, template literals (incl. ${} substitutions) and regex literals,
// so text inside them never counts as code.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';

/** Layers each core layer may depend on. Layers not listed here are not checked. */
export const ALLOWED_DEPENDENCIES = Object.freeze({
  shared: Object.freeze(['shared']),
  domain: Object.freeze(['shared', 'domain']),
  application: Object.freeze(['shared', 'domain', 'application']),
});

/** Browser / host globals the core must receive through ports instead. */
export const FORBIDDEN_GLOBALS = Object.freeze([
  'window', 'self', 'document', 'globalThis', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'fetch', 'XMLHttpRequest',
  'WebSocket', 'FileReader', 'Blob', 'File', 'URL', 'alert', 'confirm', 'prompt',
  'requestAnimationFrame', 'setTimeout', 'setInterval', 'crypto', 'performance',
  'process', 'require', 'Date',
]);

/** Vendor globals: flagged only when used as an object (`L.map`, `ms.Symbol`). */
export const FORBIDDEN_VENDOR_GLOBALS = Object.freeze(['L', 'ms']);

const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * Lex `source` into two same-length views (newlines always preserved, so offsets and
 * line numbers line up with the original):
 *  - `withStrings`: comments blanked, strings kept verbatim (to read import specifiers)
 *  - `codeOnly`: comments and string/regex contents blanked, quote chars kept
 */
function lex(source) {
  const withStrings = source.split('');
  const codeOnly = source.split('');
  const blank = (arr, i) => { if (arr[i] !== '\n') arr[i] = ' '; };
  const templateDepths = []; // brace depth at which each open ${ … } returns to its template
  let braceDepth = 0;
  let lastSignificant = '';
  let i = 0;

  const scanQuoted = (quote) => {
    // i is at the opening quote; blank contents in codeOnly, stop after the closing quote.
    i++;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') { blank(codeOnly, i); i++; }
      if (quote !== '`' && source[i] === '\n') break; // unterminated: bail at end of line
      blank(codeOnly, i); i++;
    }
    i++;
  };

  const scanTemplateChunk = () => {
    // i is just after ` or }. Blank text until closing ` (pop) or ${ (push substitution).
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') { blank(codeOnly, i); blank(codeOnly, i + 1); i += 2; continue; }
      if (c === '`') { i++; lastSignificant = '`'; return; }
      if (c === '$' && source[i + 1] === '{') {
        templateDepths.push(braceDepth);
        braceDepth++;
        i += 2; lastSignificant = '{';
        return;
      }
      blank(codeOnly, i); i++;
    }
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { blank(withStrings, i); blank(codeOnly, i); i++; }
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) { blank(withStrings, i); blank(codeOnly, i); }
      continue;
    }
    if (c === "'" || c === '"') { scanQuoted(c); lastSignificant = c; continue; }
    if (c === '`') { i++; scanTemplateChunk(); continue; }
    if (c === '/') {
      const before = source.slice(Math.max(0, i - 12), i).trimEnd();
      if (REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.test(before)) {
        // Regex literal: blank its body (keep the slashes), honouring classes and escapes.
        i++;
        let inClass = false;
        while (i < source.length && source[i] !== '\n') {
          const r = source[i];
          if (r === '\\') { blank(codeOnly, i); blank(codeOnly, i + 1); i += 2; continue; }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
          blank(codeOnly, i); i++;
        }
        i++;
        lastSignificant = ')'; // a regex is a value; a following "/" is division
        continue;
      }
    }
    if (c === '{') braceDepth++;
    if (c === '}') {
      braceDepth--;
      if (templateDepths.length && templateDepths[templateDepths.length - 1] === braceDepth) {
        templateDepths.pop();
        i++;
        scanTemplateChunk();
        continue;
      }
    }
    if (!/\s/.test(c)) lastSignificant = /[\w$]/.test(c) ? 'a' : c;
    i++;
  }

  return { withStrings: withStrings.join(''), codeOnly: codeOnly.join('') };
}

function lineAt(text, index) {
  let line = 1;
  for (let k = 0; k < index; k++) if (text.charCodeAt(k) === 10) line++;
  return line;
}

function readStringAt(text, quoteIndex) {
  const quote = text[quoteIndex];
  let out = '';
  for (let k = quoteIndex + 1; k < text.length && text[k] !== quote; k++) {
    if (text[k] === '\\') k++;
    out += text[k];
  }
  return out;
}

const IMPORT_PATTERNS = [
  /(?<![\w$.])(?:import|export)\b[^;'"`()=]*?\bfrom\s*(['"])/g, // import x from '…' / export … from '…'
  /(?<![\w$.])import\s*(['"])/g,                                 // import '…'
  /(?<![\w$.])import\s*\(\s*(['"`])/g,                           // import('…')
];

const GLOBAL_PATTERN = new RegExp(`(?<![\\w$.])(${FORBIDDEN_GLOBALS.join('|')})(?![\\w$])`, 'g');
const VENDOR_PATTERN = new RegExp(`(?<![\\w$.])(${FORBIDDEN_VENDOR_GLOBALS.join('|')})(?=\\s*\\??\\.)`, 'g');

/** `{ window: 1 }` / `, fetch : 2` — a property name, not a reference to the global. */
function isObjectKey(code, index, length) {
  const after = code.slice(index + length).match(/^\s*(.)/)?.[1];
  const before = code.slice(0, index).match(/(\S)\s*$/)?.[1];
  return after === ':' && (before === '{' || before === ',');
}

/**
 * @param {string} source
 * @returns {{ imports: {specifier:string, line:number}[], globals: {name:string, line:number}[] }}
 */
export function analyzeSource(source) {
  const { withStrings, codeOnly } = lex(source);

  const found = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const m of codeOnly.matchAll(pattern)) {
      const quoteIndex = m.index + m[0].length - 1;
      found.push({ index: m.index, specifier: readStringAt(withStrings, quoteIndex), line: lineAt(source, m.index) });
    }
  }
  const imports = found
    .sort((a, b) => a.index - b.index)
    .map(({ specifier, line }) => ({ specifier, line }));

  const globals = [];
  for (const pattern of [GLOBAL_PATTERN, VENDOR_PATTERN]) {
    for (const m of codeOnly.matchAll(pattern)) {
      if (isObjectKey(codeOnly, m.index, m[0].length)) continue;
      globals.push({ index: m.index, name: m[1], line: lineAt(source, m.index) });
    }
  }
  globals.sort((a, b) => a.index - b.index);

  return { imports, globals: globals.map(({ name, line }) => ({ name, line })) };
}

const toPosix = (p) => p.split(sep).join('/');

function layerOf(srcRoot, absPath) {
  const rel = relative(srcRoot, absPath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null; // outside src/
  return toPosix(rel).split('/')[0];
}

/**
 * @typedef {{ file: string, line: number, rule: 'forbidden-import'|'bare-import'|'forbidden-global', detail: string }} Violation
 * @param {{ srcRoot: string, filePath: string, source: string }} args
 * @returns {Violation[]}
 */
export function checkFile({ srcRoot, filePath, source }) {
  const file = toPosix(relative(srcRoot, filePath));
  const layer = layerOf(srcRoot, filePath);
  const allowed = ALLOWED_DEPENDENCIES[layer];
  if (!allowed) return [];

  const { imports, globals } = analyzeSource(source);
  const violations = [];

  for (const { specifier, line } of imports) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      violations.push({ file, line, rule: 'bare-import',
        detail: `${layer} may only use relative imports inside src/, found "${specifier}"` });
      continue;
    }
    const target = resolve(dirname(filePath), specifier);
    const targetLayer = layerOf(srcRoot, target);
    if (!allowed.includes(targetLayer)) {
      const where = targetLayer ?? `outside src/ (${toPosix(relative(srcRoot, target))})`;
      violations.push({ file, line, rule: 'forbidden-import',
        detail: `${layer} may not import from ${where} via "${specifier}" (allowed: ${allowed.join(', ')})` });
    }
  }

  for (const { name, line } of globals) {
    violations.push({ file, line, rule: 'forbidden-global',
      detail: `${layer} may not use the global "${name}"; inject it through a port` });
  }

  return violations;
}

async function listJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return listJsFiles(full);
    return /\.m?js$/.test(e.name) ? [full] : [];
  }));
  return nested.flat();
}

/** Check every .js / .mjs file under `srcRoot`. @returns {Promise<Violation[]>} */
export async function checkTree(srcRoot) {
  const files = (await listJsFiles(srcRoot)).sort();
  const results = await Promise.all(files.map(async (filePath) =>
    checkFile({ srcRoot, filePath, source: await readFile(filePath, 'utf8') })));
  return results.flat();
}

/** @param {Violation[]} violations */
export function formatViolations(violations) {
  return violations.map((v) => `  src/${v.file}:${v.line}  [${v.rule}]  ${v.detail}`).join('\n');
}
