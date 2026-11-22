// COA-2.3: serve.ps1, the PowerShell static server. Starts the real script and talks HTTP to it.
// Needs PowerShell: set PWSH=/path/to/pwsh, or have `pwsh` on PATH. Skipped (with a note) otherwise.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repo, 'serve.ps1');
const fixtureRoot = join(repo, 'tests', 'fixtures', 'serve', 'root');
const PWSH = process.env.PWSH || 'pwsh';
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', 'exit 0']).status === 0;
const skip = hasPwsh ? false : 'PowerShell not found (set PWSH or put pwsh on PATH)';

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Start serve.ps1 and resolve once it prints its banner. */
async function startServer(args = []) {
  const port = await freePort();
  const child = spawn(PWSH, ['-NoProfile', '-File', script, '-Port', String(port), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve.ps1 did not start:\n${output}`)), 20000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(`http://localhost:${port}/`)) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (c) => { output += c; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve.ps1 exited ${code}:\n${output}`)); });
  });
  return { port, child, output: () => output, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}

/** Raw HTTP request (the path is sent exactly as given, no normalising). */
const fetchRaw = (port, path, { method = 'GET' } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: 'localhost', port, path, method }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});

describe('serve.ps1 serving a fixture folder', { skip }, () => {
  let server;
  before(async () => { server = await startServer(['-Root', fixtureRoot]); });
  after(async () => { await server?.stop(); });
  const get = (path, options) => fetchRaw(server.port, path, options);

  it('prints the URL it serves on, and the folder', () => {
    assert.match(server.output(), new RegExp(`http://localhost:${server.port}/`));
    assert.ok(server.output().includes('fixtures'), server.output());
  });

  it('serves index.html for /', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.body.toString(), readFileSync(join(fixtureRoot, 'index.html'), 'utf8'));
  });

  for (const [path, type] of [
    ['/app.js', 'text/javascript; charset=utf-8'],    // module scripts are refused without a JavaScript MIME type
    ['/style.css', 'text/css; charset=utf-8'],
    ['/icon.svg', 'image/svg+xml'],
    ['/pic.png', 'image/png'],
    ['/data.json', 'application/json; charset=utf-8'],
    ['/layer.geojson', 'application/geo+json; charset=utf-8'],
    ['/file.unknownext', 'application/octet-stream'],
  ]) {
    it(`serves ${path} as ${type}, byte for byte`, async () => {
      const r = await get(path);
      assert.equal(r.status, 200);
      assert.equal(r.headers['content-type'], type);
      assert.deepEqual(r.body, readFileSync(join(fixtureRoot, path.slice(1))));
    });
  }

  it('serves index.html for a folder path', async () => {
    const r = await get('/sub/');
    assert.equal(r.status, 200);
    assert.match(r.body.toString(), /<title>sub<\/title>/);
  });

  it('ignores the query string', async () => {
    assert.equal((await get('/app.js?v=2')).status, 200);
  });

  it('decodes percent-encoded names', async () => {
    assert.equal((await get('/%61pp.js')).status, 200);
    const spaced = await get('/with%20space.txt');
    assert.equal(spaced.status, 200);
    assert.equal(spaced.body.toString(), 'spaced\n');
  });

  it('sends no-store and nosniff headers', async () => {
    const r = await get('/app.js');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  });

  it('answers HEAD with headers and no body', async () => {
    const r = await get('/app.js', { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(r.body.length, 0);
  });

  it('is 404 for a missing file', async () => {
    assert.equal((await get('/nope.js')).status, 404);
  });

  for (const path of ['/C:%5cWindows%5cwin.ini', '/../outside.txt', '/%2e%2e/outside.txt', '/sub/%2e%2e/%2e%2e/outside.txt', '/..%2foutside.txt', '/..%5coutside.txt', '/%2e%2e%5coutside.txt']) {
    it(`never serves a file outside the root (${path})`, async () => {
      const r = await get(path);
      assert.ok([403, 404].includes(r.status), `status ${r.status}`);
      assert.ok(!r.body.toString().includes('TOP SECRET'));
    });
  }

  for (const path of ['/.hidden/secret.txt', '/%2ehidden/secret.txt', '/sub/../.hidden/secret.txt']) {
    it(`does not serve dot-files or dot-folders such as .git (${path})`, async () => {
      const r = await get(path);
      assert.equal(r.status, 404);
      assert.ok(!r.body.toString().includes('hidden'));
    });
  }

  it('refuses methods other than GET and HEAD with 405', async () => {
    const r = await get('/app.js', { method: 'POST' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET, HEAD');
  });

  it('keeps serving after bad requests', async () => {
    await get('/%2e%2e/outside.txt');
    await get('/nope');
    assert.equal((await get('/')).status, 200);
  });
});

describe('serve.ps1 with its defaults', { skip }, () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server?.stop(); });

  it('serves the app from its own folder, with module scripts as JavaScript', async () => {
    const page = await fetchRaw(server.port, '/');
    assert.match(page.body.toString(), /<title>COA Builder<\/title>/);
    const main = await fetchRaw(server.port, '/src/main.js');
    assert.equal(main.status, 200);
    assert.equal(main.headers['content-type'], 'text/javascript; charset=utf-8');
  });

  it('does not expose the git repository', async () => {
    assert.equal((await fetchRaw(server.port, '/.git/config')).status, 404);
  });
});

describe('serve.ps1 start-up failures', { skip }, () => {
  it('exits with an error when the port is already in use', async () => {
    const first = await startServer();
    try {
      const second = spawnSync(PWSH, ['-NoProfile', '-File', script, '-Port', String(first.port)], { encoding: 'utf8', timeout: 20000 });
      assert.notEqual(second.status, 0);
      assert.match(second.stdout + second.stderr, /could not listen|in use/i);
    } finally {
      await first.stop();
    }
  });

  it('exits with an error when the root folder does not exist', () => {
    const r = spawnSync(PWSH, ['-NoProfile', '-File', script, '-Port', '0', '-Root', join(repo, 'no-such-folder')], { encoding: 'utf8', timeout: 20000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /not found|does not exist/i);
  });
});
