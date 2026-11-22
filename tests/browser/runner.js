// A tiny dependency-free test runner for UI adapters, run in a real browser.
// Open tests/browser/ on the dev server. Results are shown on the page and exposed as
// window.__testResults = { passed, failed, results } for headless runs.

const tests = [];
const prefix = [];
const hooks = { beforeEach: [[]], afterEach: [[]] };

export function describe(name, body) {
  prefix.push(name);
  hooks.beforeEach.push([...hooks.beforeEach.at(-1)]);
  hooks.afterEach.push([...hooks.afterEach.at(-1)]);
  try { body(); } finally {
    prefix.pop(); hooks.beforeEach.pop(); hooks.afterEach.pop();
  }
}

export const beforeEach = (fn) => hooks.beforeEach.at(-1).push(fn);
export const afterEach = (fn) => hooks.afterEach.at(-1).push(fn);

export function it(name, fn) {
  tests.push({ name: [...prefix, name].join(' › '), fn, before: [...hooks.beforeEach.at(-1)], after: [...hooks.afterEach.at(-1)] });
}

class AssertionError extends Error {}
const show = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
const canonical = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

export const assert = {
  ok(value, message = `expected truthy, got ${show(value)}`) { if (!value) throw new AssertionError(message); },
  equal(actual, expected, message) {
    if (!Object.is(actual, expected)) throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
  },
  deepEqual(actual, expected, message) {
    if (canonical(actual) !== canonical(expected)) throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
  },
  match(text, pattern, message) {
    if (!pattern.test(text)) throw new AssertionError(message ?? `expected ${show(text)} to match ${pattern}`);
  },
  throws(fn, ErrorType = Error, message) {
    try { fn(); } catch (error) {
      if (error instanceof ErrorType) return;
      throw new AssertionError(message ?? `expected ${ErrorType.name}, got ${error}`);
    }
    throw new AssertionError(message ?? `expected ${ErrorType.name} to be thrown`);
  },
};

/** Run every registered test in order and render the results into `output`. */
export async function run(output = document.body) {
  const results = [];
  for (const t of tests) {
    let error = null;
    try {
      for (const hook of t.before) await hook();
      await t.fn();
    } catch (e) { error = e; }
    for (const hook of t.after) {
      try { await hook(); } catch (e) { error ??= e; }
    }
    results.push({ name: t.name, ok: !error, error: error ? String(error.stack ?? error) : null });
  }
  const failed = results.filter((r) => !r.ok).length;
  window.__testResults = { passed: results.length - failed, failed, results };

  const summary = document.createElement('h2');
  summary.textContent = `${results.length - failed} passed, ${failed} failed`;
  summary.className = failed ? 'fail' : 'pass';
  const list = document.createElement('ol');
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = `${r.ok ? '✓' : '✗'} ${r.name}`;
    if (r.error) {
      const pre = document.createElement('pre');
      pre.textContent = r.error;
      li.append(pre);
    }
    list.append(li);
  }
  output.append(summary, list);
  return window.__testResults;
}
