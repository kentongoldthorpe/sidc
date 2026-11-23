// Builds the release zip for an offline machine:  npm run package  [-- --out <dir>] [--build <iso time>]
//   dist/coa-builder-<version>.zip  →  coa-builder-<version>/ { index.html, css, src, vendor, docs,
//                                      serve.ps1, serve.cmd, serve.py, README.md, CHANGELOG.md }
// Tests, tools, data and repository files are left out. src/shared/version.js gets the build time.
// No dependencies: the zip format is written here (deflate from node:zlib, CRC-32 below).
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INCLUDE = ['index.html', 'css', 'src', 'vendor', 'docs', 'serve.ps1', 'serve.cmd', 'serve.py', 'README.md', 'CHANGELOG.md'];
const VERSION_FILE = 'src/shared/version.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const outDir = arg('out', join(ROOT, 'dist'));
const build = arg('build', new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Files under `path` (relative to ROOT, with / separators), skipping dot-files and dot-folders. */
function files(path) {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).filter((n) => !n.startsWith('.')).sort().flatMap((n) => files(`${path}/${n}`));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** DOS date/time fields for the zip headers. */
function dosTime(iso) {
  const d = new Date(iso);
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2), date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}

function zip(entries, stamp) {
  const { time, date } = dosTime(stamp);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const [method, body] = packed.length < data.length ? [8, packed] : [0, data];
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const folder = `coa-builder-${version}`;
const entries = INCLUDE.flatMap(files).map((path) => {
  let data = readFileSync(join(ROOT, path));
  if (path === VERSION_FILE) data = Buffer.from(data.toString('utf8').replace("export const BUILD = 'dev';", `export const BUILD = '${build}';`), 'utf8');
  return { name: `${folder}/${relative(ROOT, join(ROOT, path)).split(sep).join('/')}`, data };
});
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${folder}.zip`);
writeFileSync(file, zip(entries, build));
console.log(`Wrote ${file} (${entries.length} files, version ${version}, build ${build})`);
