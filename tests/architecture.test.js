// COA-1.2 — Architecture fitness test.
// Enforces the dependency rule: adapters → application → domain → shared.
// The core (shared, domain, application) must stay pure: no adapter/vendor imports,
// no bare/npm/node: imports, and no browser or vendor globals.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { analyzeSource, checkFile, checkTree, formatViolations } from './support/architecture-rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const realSrc = join(here, '..', 'src');
const fixtureSrc = join(here, 'fixtures', 'architecture', 'src');

describe('analyzeSource', () => {
  it('finds static, re-export, side-effect and dynamic import specifiers with line numbers', () => {
    const src = [
      "import a from './a.js';",
      "import { b,",
      "  c } from \"../b.js\";",
      "export { d } from './d.js';",
      "export * from './e.js';",
      "import './side-effect.js';",
      "const f = await import('./f.js');",
    ].join('\n');
    assert.deepEqual(analyzeSource(src).imports, [
      { specifier: './a.js', line: 1 },
      { specifier: '../b.js', line: 2 },
      { specifier: './d.js', line: 4 },
      { specifier: './e.js', line: 5 },
      { specifier: './side-effect.js', line: 6 },
      { specifier: './f.js', line: 7 },
    ]);
  });

  it('ignores imports that appear in comments or strings', () => {
    const src = [
      "// import x from '../adapters/x.js';",
      "/* import y from 'vendor/y.js'; */",
      "const s = \"import z from './z.js'\";",
    ].join('\n');
    assert.deepEqual(analyzeSource(src).imports, []);
  });

  it('finds browser globals used as identifiers', () => {
    const src = [
      'const a = window.innerWidth;',
      'document.title = "x";',
      'localStorage.getItem("k");',
      'sessionStorage.clear();',
      'navigator.onLine;',
      'indexedDB.open("db");',
      'fetch("/x");',
      'globalThis.foo;',
      'new FileReader();',
      'new Blob([]);',
      'alert("hi");',
    ].join('\n');
    assert.deepEqual(analyzeSource(src).globals.map((g) => [g.name, g.line]), [
      ['window', 1], ['document', 2], ['localStorage', 3], ['sessionStorage', 4],
      ['navigator', 5], ['indexedDB', 6], ['fetch', 7], ['globalThis', 8],
      ['FileReader', 9], ['Blob', 10], ['alert', 11],
    ]);
  });

  it('finds vendor globals L and ms only when used as objects', () => {
    const src = ['L.map(el);', 'new ms.Symbol("x");', 'const ms2 = 1;', 'const items = list.L;'].join('\n');
    assert.deepEqual(analyzeSource(src).globals.map((g) => [g.name, g.line]), [['L', 1], ['ms', 2]]);
  });

  it('does not flag globals in comments, strings, templates, property names or longer identifiers', () => {
    const src = [
      '// window document localStorage',
      '/* L.map() ms.Symbol */',
      'const s = "window.document";',
      "const t = 'localStorage';",
      'const u = `fetch ${1 + 1} document`;',
      'const documentId = 1; const myWindow = 2;',
      'const o = { window: 1 }; o.document; o.fetch();',
    ].join('\n');
    assert.deepEqual(analyzeSource(src).globals, []);
  });

  it('still sees code inside template literal substitutions', () => {
    assert.deepEqual(analyzeSource('const u = `x ${window.name} y`;').globals.map((g) => g.name), ['window']);
  });

  it('is not derailed by regex literals containing quotes or slashes', () => {
    const src = ['const r = /["\'`]\\/[/]/g;', 'const d = a / b / c;', 'window;'].join('\n');
    assert.deepEqual(analyzeSource(src).globals.map((g) => [g.name, g.line]), [['window', 3]]);
  });

  it('flags a global in a ternary branch but not an object key of the same name', () => {
    const src = ['const a = ok ? window : null;', 'const b = { document: 1, fetch : 2 };'].join('\n');
    assert.deepEqual(analyzeSource(src).globals.map((g) => [g.name, g.line]), [['window', 1]]);
  });

  it('handles escaped quotes and division without losing track of strings', () => {
    const src = ["const a = 'it\\'s window';", 'const b = 4 / 2; const c = "\\"document\\"";', 'window;'].join('\n');
    assert.deepEqual(analyzeSource(src).globals.map((g) => [g.name, g.line]), [['window', 3]]);
  });
});

describe('checkFile layer rules', () => {
  const check = (layerPath, source) =>
    checkFile({ srcRoot: '/p/src', filePath: `/p/src/${layerPath}`, source }).map((v) => v.rule);

  it('domain may import shared and domain', () => {
    assert.deepEqual(check('domain/coa.js', "import '../shared/result.js'; import './sidc.js';"), []);
  });

  it('domain may not import application or adapters', () => {
    assert.deepEqual(check('domain/coa.js', "import '../application/x.js';"), ['forbidden-import']);
    assert.deepEqual(check('domain/coa.js', "import '../adapters/x.js';"), ['forbidden-import']);
  });

  it('application may import shared, domain and application but not adapters', () => {
    assert.deepEqual(check('application/commands/c.js',
      "import '../../shared/a.js'; import '../../domain/b.js'; import '../bus/c.js';"), []);
    assert.deepEqual(check('application/commands/c.js', "import '../../adapters/x.js';"), ['forbidden-import']);
  });

  it('shared may import only shared', () => {
    assert.deepEqual(check('shared/a.js', "import './b.js';"), []);
    assert.deepEqual(check('shared/a.js', "import '../domain/b.js';"), ['forbidden-import']);
  });

  it('core may not import anything outside src (vendor, tests)', () => {
    assert.deepEqual(check('domain/a.js', "import '../../vendor/milsymbol/milsymbol.js';"), ['forbidden-import']);
    assert.deepEqual(check('domain/a.js', "import '../../tests/support/x.js';"), ['forbidden-import']);
  });

  it('core may not use bare, node: or URL specifiers', () => {
    assert.deepEqual(check('domain/a.js', "import 'leaflet';"), ['bare-import']);
    assert.deepEqual(check('domain/a.js', "import 'node:fs';"), ['bare-import']);
    assert.deepEqual(check('domain/a.js', "import 'https://cdn.example/x.js';"), ['bare-import']);
  });

  it('core may not use browser or vendor globals', () => {
    assert.deepEqual(check('application/a.js', 'document.body;'), ['forbidden-global']);
  });

  it('adapters, main.js and unknown folders are not checked', () => {
    assert.deepEqual(check('adapters/ui/v.js', "import 'leaflet'; document.body; L.map();"), []);
    assert.deepEqual(check('main.js', 'L.map(); ms.Symbol;'), []);
  });

  it('reports file, line and a human-readable detail', () => {
    const [v] = checkFile({ srcRoot: '/p/src', filePath: '/p/src/domain/a.js', source: "\n\nimport '../adapters/x.js';" });
    assert.equal(v.file, 'domain/a.js');
    assert.equal(v.line, 3);
    assert.match(v.detail, /domain.*adapters/);
  });
});

describe('fixture tree proves the rules catch real violations', () => {
  it('flags every bad fixture file and nothing in the clean or adapter ones', async () => {
    const found = (await checkTree(fixtureSrc)).map((v) => `${v.file}:${v.line} ${v.rule}`).sort();
    assert.deepEqual(found, [
      'application/bare-import.js:1 bare-import',
      'application/bare-import.js:2 bare-import',
      'application/dynamic-import.js:1 forbidden-import',
      'application/imports-vendor.js:1 forbidden-import',
      'application/uses-vendor-globals.js:1 forbidden-global',
      'application/uses-vendor-globals.js:2 forbidden-global',
      'domain/imports-adapter.js:1 forbidden-import',
      'domain/imports-application.js:1 forbidden-import',
      'domain/uses-globals.js:2 forbidden-global',
      'domain/uses-globals.js:3 forbidden-global',
      'shared/imports-domain.js:1 forbidden-import',
    ]);
  });
});

describe('the real codebase', () => {
  it('respects the dependency rule (shared ← domain ← application ← adapters)', async () => {
    const violations = await checkTree(realSrc);
    assert.equal(violations.length, 0, `Architecture violations:\n${formatViolations(violations)}`);
  });
});
