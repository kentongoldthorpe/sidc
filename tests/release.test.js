// H-6: the release package and the version. Reason for testing the build tool: the zip is what goes
// to an offline machine, so its contents are a boundary (what is in it, what is left out).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { VERSION, BUILD } from '../src/shared/version.js';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Entries of a zip file: { name → content Buffer }, read from its central directory. */
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, 'central directory header');
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataStart, dataStart + size);
    entries.set(name, method === 8 ? inflateRawSync(data) : data);
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

describe('version', () => {
  it('src/shared/version.js matches package.json, and says "dev" outside a release build', () => {
    assert.equal(VERSION, pkg.version);
    assert.equal(BUILD, 'dev');
  });
});

describe('npm run package', () => {
  let out; let entries;
  before(() => {
    out = mkdtempSync(join(tmpdir(), 'coa-package-'));
    execFileSync(process.execPath, [join(root, 'tools/package.mjs'), '--out', out, '--build', '2026-11-23T10:00:00Z'], { cwd: root });
    entries = readZip(readFileSync(join(out, `coa-builder-${pkg.version}.zip`)));
  });
  after(() => rmSync(out, { recursive: true, force: true }));

  it('holds everything needed to run offline, in one folder', () => {
    const dir = `coa-builder-${pkg.version}/`;
    for (const file of ['index.html', 'css/app.css', 'src/main.js', 'src/shared/version.js', 'vendor/leaflet/leaflet.js', 'vendor/milsymbol/milsymbol.js',
      'serve.ps1', 'serve.cmd', 'serve.py', 'README.md', 'CHANGELOG.md', 'docs/IMPORT-FORMAT.md', 'docs/RELEASE-CHECKLIST.md',
      'docs/import/coa-import.schema.json', 'docs/import/examples/two-coas-full.json']) {
      assert.ok(entries.has(dir + file), `missing ${file}`);
    }
    assert.ok([...entries.keys()].every((name) => name.startsWith(dir)), 'everything under one folder');
  });

  it('leaves out tests, tools, data and repository files', () => {
    const names = [...entries.keys()];
    for (const unwanted of ['/tests/', '/tools/', '/data/', '/.git', '/node_modules/', '/dist/']) {
      assert.deepEqual(names.filter((n) => n.includes(unwanted)), [], unwanted);
    }
    assert.equal(entries.has(`coa-builder-${pkg.version}/package.json`), false, 'the repository\'s package.json (npm scripts) is not needed to run');
  });

  it('files are byte-for-byte the same as in the repository, except the stamped version', () => {
    const dir = `coa-builder-${pkg.version}/`;
    for (const file of ['index.html', 'src/main.js', 'vendor/milsymbol/milsymbol.js', 'docs/IMPORT-FORMAT.md']) {
      assert.ok(entries.get(dir + file).equals(readFileSync(join(root, file))), file);
    }
    const version = entries.get(`${dir}src/shared/version.js`).toString('utf8');
    assert.match(version, /export const BUILD = '2026-11-23T10:00:00Z';/);
    assert.match(version, new RegExp(`export const VERSION = '${pkg.version.replaceAll('.', '\\.')}';`));
  });
});
