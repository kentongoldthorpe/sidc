// H-3: automated accessibility checks on the whole mounted app (real index.html markup), with
// content and with the unit and line editors open. Every control has an accessible name and ids
// are unique. (Not a full audit: keyboard paths have their own specs.)
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { mountFullApp } from './app-fixture.js';
import { mountUi } from '../../src/adapters/ui/mount-ui.js';
import { createMemoryPrefs } from '../../src/adapters/ui/prefs.js';

let ui; let host;
afterEach(() => { ui?.destroy(); host?.remove(); ui = null; host = null; });

async function mountWithContent() {
  const app = await mountFullApp({ mountUi, createMemoryPrefs });
  ({ ui, host } = app);
  ui.symbolSelection.set(app.coa.symbols[0].id);
  ui.graphicSelection.set(app.coa.graphics[0].id);
  await waitFor(() => host.querySelector('[data-unit-form]') && host.querySelector('[name="graphic-label"]'));
  return app.root;
}

/** The accessible name, the common ways (enough for this app's markup). */
function nameOf(el) {
  const by = (ids) => ids.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
  return (el.getAttribute('aria-label')
    || (el.getAttribute('aria-labelledby') && by(el.getAttribute('aria-labelledby')))
    || (el.id && [...el.ownerDocument.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)].map((l) => l.textContent).join(' '))
    || el.closest('label')?.textContent
    || (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? el.textContent : '')
    || el.getAttribute('title')
    || '').trim();
}
const describeEl = (el) => `<${el.tagName.toLowerCase()}${el.name ? ` name="${el.name}"` : ''}${el.className ? ` class="${el.className}"` : ''}>`;

describe('accessibility checks on the whole app', () => {
  it('every input, dropdown and text box has an accessible name', async () => {
    const root = await mountWithContent();
    const unnamed = [...root.querySelectorAll('input, select, textarea')].filter((el) => !nameOf(el)).map(describeEl);
    assert.deepEqual(unnamed, []);
  });

  it('every button (including map markers and controls) has an accessible name', async () => {
    const root = await mountWithContent();
    const unnamed = [...root.querySelectorAll('button, [role="button"], a[href]')].filter((el) => !nameOf(el)).map(describeEl);
    assert.deepEqual(unnamed, []);
  });

  it('ids are unique', async () => {
    const root = await mountWithContent();
    const ids = [...root.querySelectorAll('[id]')].map((el) => el.id);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  });

  it('status and error messages are announced (live regions)', async () => {
    const root = await mountWithContent();
    for (const selector of ['[data-storage-status]', '.history-status', '[data-import-status]', '[data-storage-banner]']) {
      const el = root.querySelector(selector);
      assert.ok(el, selector);
      assert.ok(['status', 'alert'].includes(el.getAttribute('role')) || el.getAttribute('aria-live'), `${selector} is a live region`);
    }
  });
});
