// H-4: the Content-Security-Policy. Reason for testing file contents: the policy is configuration
// spread over four places (the app page, the test page, serve.ps1 and serve.py) that must agree,
// and the browser specs run under the test page's copy, so any violation fails them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const metaPolicy = (html) => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
const directives = (policy) => Object.fromEntries(policy.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));

describe('Content-Security-Policy', () => {
  const policy = metaPolicy(read('index.html'));

  it('is set on the app page', () => assert.ok(policy, 'index.html has a CSP meta tag'));

  it('is the same on the test page, in serve.ps1 and in serve.py', () => {
    assert.equal(metaPolicy(read('tests/browser/index.html')), policy);
    assert.ok(read('serve.ps1').includes(`'${policy.replaceAll("'", "''")}'`), 'serve.ps1 sends the same policy (single-quoted PowerShell string)');
    assert.ok(read('serve.py').includes(JSON.stringify(policy)), 'serve.py sends the same policy');
  });

  it('only runs scripts from the app itself (no inline or injected scripts) and loads nothing from elsewhere but map tiles', () => {
    const d = directives(policy);
    assert.deepEqual(d['default-src'], ["'self'"]);
    assert.deepEqual(d['script-src'], ["'self'"]);
    assert.deepEqual(d['connect-src'], ["'self'"]);
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.deepEqual(d['base-uri'], ["'none'"]);
    assert.deepEqual(d['img-src'], ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org']);
    assert.ok(!policy.includes('unsafe-eval'));
  });

  it('pages have no inline scripts (they would be blocked)', () => {
    for (const page of ['index.html', 'tests/browser/index.html']) {
      const inline = [...read(page).matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
      assert.deepEqual(inline.map((m) => m[0]), [], page);
    }
  });
});
