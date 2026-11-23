// serve.py: the Python (standard library) dev server. Like serve.ps1 it sends no-store, so a plain
// reload after `git pull` never mixes cached old modules with new ones.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PYTHON = process.env.PYTHON || 'python3';
const hasPython = spawnSync(PYTHON, ['--version']).status === 0;

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const get = (port, path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  });
  req.on('error', reject);
  req.end();
});

describe('serve.py', { skip: hasPython ? false : 'Python 3 not found' }, () => {
  let child; let port;
  before(async () => {
    port = await freePort();
    child = spawn(PYTHON, [join(repo, 'serve.py'), '--port', String(port)], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`serve.py did not start:\n${output}`)), 15000);
      const onData = (c) => { output += c; if (output.includes(`localhost:${port}/`)) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve.py exited ${code}:\n${output}`)); });
    });
  });
  after(() => new Promise((r) => { child.once('exit', r); child.kill(); }));

  it('serves the app with no-store, so browsers always load current modules', async () => {
    const r = await get(port, '/');
    assert.equal(r.status, 200);
    assert.match(r.body, /<title>COA Builder<\/title>/);
    assert.equal(r.headers['cache-control'], 'no-store');
  });

  it('serves ES modules as JavaScript, also with no-store', async () => {
    const r = await get(port, '/src/main.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/javascript/);
    assert.equal(r.headers['cache-control'], 'no-store');
  });

  it('does not serve dot-files such as .git', async () => {
    assert.equal((await get(port, '/.git/config')).status, 404);
    assert.equal((await get(port, '/%2egit/config')).status, 404);
  });

  it('only listens on localhost', () => {
    assert.ok(child.exitCode === null);
  });
});
