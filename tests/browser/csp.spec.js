// Runs last: the whole UI (maps, symbols, slides, imports) worked under the app's CSP.
import { describe, it, assert } from './runner.js';
import { violations } from './csp-watch.js';

describe('Content-Security-Policy', () => {
  it('the page runs under the app\'s policy', () => {
    assert.ok(document.querySelector('meta[http-equiv="Content-Security-Policy"]'));
  });
  it('nothing the specs did was blocked by it', () => {
    assert.deepEqual(violations, []);
  });
});
