// Starts the real serve.ps1 with a temporary data folder, for contract tests (needs PowerShell).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const PWSH = process.env.PWSH || 'pwsh';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Start serve.ps1 with a temporary data folder. */
export async function startFileServer() {
  const dataDir = mkdtempSync(join(tmpdir(), 'coa-data-'));
  const port = await new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const child = spawn(PWSH, ['-NoProfile', '-File', join(repo, 'serve.ps1'), '-Port', String(port), '-DataDir', dataDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve.ps1 did not start:\n${output}`)), 20000);
    child.stdout.on('data', (c) => { output += c; if (output.includes(`localhost:${port}/`)) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (c) => { output += c; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve.ps1 exited ${code}:\n${output}`)); });
  });
  return {
    dataDir,
    fetch: (path, init) => fetch(`http://localhost:${port}${path}`, init),
    writeRawFile: async (id, text) => writeFileSync(join(dataDir, `${id}.geojson`), text),
    stop: () => new Promise((r) => { child.once('exit', () => { rmSync(dataDir, { recursive: true, force: true }); r(); }); child.kill(); }),
  };
}

