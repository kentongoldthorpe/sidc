// Runs the browser specs (tests/browser/) headless and prints the results.
//   npm run test:browser
// Serves the repository itself (no other server needed) and drives Chromium with Playwright when it
// is installed. Playwright is not a project dependency: without it this prints how to run the specs
// in any browser instead (open tests/browser/ on the dev server) and exits with code 2.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const TIMEOUT_MS = 120_000;

function loadPlaywright() {
  for (const from of [import.meta.url, `file://${process.cwd()}/`]) {
    try { return createRequire(from)('playwright'); } catch { /* try the next place */ }
  }
  return null;
}

const playwright = loadPlaywright();
if (!playwright) {
  console.log('Playwright is not installed, so the browser specs cannot run headless here.');
  console.log('Run them in any browser instead: start the dev server (npm run serve, or serve.ps1)');
  console.log('and open http://localhost:<port>/tests/browser/');
  process.exit(2);
}

const server = createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  const file = path.endsWith(sep) ? join(path, 'index.html') : path;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/tests/browser/`;

const browser = await playwright.chromium.launch();
let failed = 1;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__testResults, null, { timeout: TIMEOUT_MS });
  const { results, passed, failed: count } = await page.evaluate(() => window.__testResults);
  for (const t of results) {
    console.log(`${t.ok ? 'ok    ' : 'FAIL  '} ${t.name}${t.error ? `\n        ${t.error.split('\n')[0]}` : ''}`);
  }
  console.log(`# browser pass ${passed}\n# browser fail ${count}`);
  if (errors.length) console.log('page errors:', errors);
  failed = count;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
