// H-3: colour contrast of the design tokens (css/tokens.css), light and dark. Reason for testing the
// stylesheet: contrast is a property of the token values, and every view uses only these tokens.
// WCAG AA: 4.5:1 for normal text; 3:1 for large/bold text and UI component edges (borders of inputs are
// not text, so they are not checked here).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
const block = (selector) => {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start + selector.length) + 1);
  return Object.fromEntries([...body.slice(0, body.indexOf('}')).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(([, k, v]) => [k, v]));
};
const light = block(':root {');
const dark = { ...light, ...block(':root[data-theme="dark"]') };
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum, what]
const PAIRS = [
  ['color-text', 'color-surface', 4.5, 'body text on the panel'],
  ['color-text', 'color-bg', 4.5, 'text in inputs'],
  ['color-text-muted', 'color-surface', 4.5, 'labels and hints on the panel'],
  ['color-text-muted', 'color-bg', 4.5, 'placeholder-like text in inputs'],
  ['color-accent', 'color-surface', 4.5, 'links and status text'],
  ['color-danger', 'color-surface', 4.5, 'errors and Delete buttons'],
  ['color-surface', 'color-accent', 4.5, 'primary button text'],
  ['color-surface', 'color-danger', 4.5, 'confirm-delete button text'],
  ['color-text', 'color-selected', 4.5, 'selected rows'],
  ['color-text-muted', 'color-map-bg', 4.5, 'grid labels on the map'],
];

for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
  describe(`contrast (${theme} theme)`, () => {
    it('defines every token checked', () => {
      for (const [fg, bg] of PAIRS) assert.ok(tokens[fg] && tokens[bg], `${fg} / ${bg}`);
    });
    for (const [fg, bg, min, what] of PAIRS) {
      it(`${what}: ${fg} on ${bg} is at least ${min}:1`, () => {
        const r = ratio(tokens[fg], tokens[bg]);
        assert.ok(r >= min, `${tokens[fg]} on ${tokens[bg]} is ${r.toFixed(2)}:1`);
      });
    }
  });
}

it('the dark theme is the same whether chosen by the OS or by data-theme', () => {
  assert.deepEqual(block(':root:not([data-theme="light"])'), block(':root[data-theme="dark"]'));
});
