// COA-1.1 — Repo skeleton & test harness.
// These tests pin down the project's structural contract so later stories can rely on it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = (...p) => join(root, ...p);
const read = (...p) => readFileSync(path(...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));

describe('package.json', () => {
  const pkg = readJson('package.json');

  it('declares ES modules so src/ runs unchanged in browser and Node', () => {
    assert.equal(pkg.type, 'module');
  });

  it('has zero runtime and dev dependencies', () => {
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      assert.ok(!pkg[key] || Object.keys(pkg[key]).length === 0, `${key} must be empty`);
    }
  });

  it('runs tests with the built-in node test runner', () => {
    assert.match(pkg.scripts?.test ?? '', /^node --test\b/);
  });

  it('serves the app with the no-store dev server (so browsers never mix cached and new modules)', () => {
    assert.match(pkg.scripts?.serve ?? '', /serve\.py/);
  });

  it('requires a Node version with a stable node:test', () => {
    assert.match(pkg.engines?.node ?? '', />=\s*20/);
  });
});

describe('folder layout', () => {
  for (const dir of [
    'src/shared', 'src/domain', 'src/application/ports', 'src/application/bus',
    'src/application/commands', 'src/application/queries',
    'src/adapters/persistence', 'src/adapters/rendering', 'src/adapters/files',
    'src/adapters/system', 'src/adapters/ui',
    'tests/support', 'tests/contracts', 'css',
  ]) {
    it(`has ${dir}/`, () => {
      assert.ok(existsSync(path(dir)) && statSync(path(dir)).isDirectory(), `${dir} missing`);
    });
  }

  it('has a composition root at src/main.js', () => {
    assert.ok(existsSync(path('src/main.js')));
  });
});

describe('vendored libraries', () => {
  it('marks vendor/ as CommonJS so Node can require() the UMD bundles', () => {
    assert.equal(readJson('vendor', 'package.json').type, 'commonjs');
  });

  for (const f of ['leaflet/leaflet.js', 'leaflet/leaflet.css', 'leaflet/LICENSE',
                   'leaflet/images/marker-icon.png', 'milsymbol/milsymbol.js', 'milsymbol/LICENSE']) {
    it(`includes vendor/${f}`, () => assert.ok(existsSync(path('vendor', f)), `vendor/${f} missing`));
  }

  it('records name, pinned version, source and license for each library', () => {
    const readme = read('vendor', 'README.md');
    assert.match(readme, /Leaflet\s*\|\s*1\.\d+\.\d+/);
    assert.match(readme, /milsymbol\s*\|\s*\d+\.\d+\.\d+/);
    assert.match(readme, /BSD-2-Clause/);
    assert.match(readme, /MIT/);
  });

  it('pins the same versions the bundles report', () => {
    const readme = read('vendor', 'README.md');
    const require = createRequire(import.meta.url);
    const ms = require(path('vendor', 'milsymbol', 'milsymbol.js'));
    assert.ok(readme.includes(`| milsymbol | ${ms.version} |`), `README should pin milsymbol ${ms.version}`);
    const leafletVersion = read('vendor', 'leaflet', 'leaflet.js').match(/version\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1]
      ?? read('vendor', 'leaflet', 'leaflet.js').match(/Leaflet (\d+\.\d+\.\d+)/)?.[1];
    assert.ok(leafletVersion, 'could not read Leaflet version from bundle');
    assert.ok(readme.includes(`| Leaflet | ${leafletVersion} |`), `README should pin Leaflet ${leafletVersion}`);
  });

  it('milsymbol renders an SVG in Node without a DOM', () => {
    const require = createRequire(import.meta.url);
    const ms = require(path('vendor', 'milsymbol', 'milsymbol.js'));
    const sym = new ms.Symbol('10031000001211000000', { size: 30 });
    assert.ok(sym.isValid(), 'friendly infantry SIDC should be valid');
    assert.match(sym.asSVG(), /^<svg[\s>]/);
  });
});

describe('index.html shell', () => {
  const html = read('index.html');

  it('declares a viewport and title', () => {
    assert.match(html, /<meta\s+name="viewport"/);
    assert.match(html, /<title>COA Builder<\/title>/);
  });

  it('loads vendored libraries as classic scripts (globals L and ms)', () => {
    assert.match(html, /<link[^>]+href="vendor\/leaflet\/leaflet\.css"/);
    assert.match(html, /<script\s+src="vendor\/leaflet\/leaflet\.js"><\/script>/);
    assert.match(html, /<script\s+src="vendor\/milsymbol\/milsymbol\.js"><\/script>/);
  });

  it('loads the composition root as an ES module', () => {
    assert.match(html, /<script\s+type="module"\s+src="src\/main\.js"><\/script>/);
  });

  it('loads app stylesheets', () => {
    assert.match(html, /href="css\/tokens\.css"/);
    assert.match(html, /href="css\/app\.css"/);
  });

  it('contains the app heading and an empty map container', () => {
    assert.match(html, /<h1[^>]*>COA Builder<\/h1>/);
    assert.match(html, /<div\s+id="map"[^>]*><\/div>/);
  });

  it('loads nothing from the network', () => {
    assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
  });
});
