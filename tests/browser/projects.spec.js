// M10-2 Projects (D27): the Project section lists projects, opens, creates, renames, exports,
// imports and deletes them. Opening a project is the composition root's job (a reload), so the view
// only asks for it through onOpen.
import { describe, it, afterEach, assert, waitFor } from './runner.js';
import { createTestApp, sandbox, type, texts } from './app-fixture.js';
import { mountProjectsView } from '../../src/adapters/ui/views/projects-view.js';

let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; });

async function setup() {
  const fixture = createTestApp();
  const host = sandbox();
  const opened = [];
  const saved = [];
  const summary = document.createElement('span');
  const view = mountProjectsView({ client: fixture.client, root: host, summary, onOpen: (id) => opened.push(id), saveFile: async (blob, name) => saved.push({ blob, name }) });
  cleanups.push(() => { view.destroy(); host.remove(); });
  await view.ready;
  return { ...fixture, host, view, opened, saved, summary };
}
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
const rows = (host) => texts(host, '[data-project-id] .project-name');

describe('Project section', () => {
  it('shows the open project (Default at first) in the list and the summary', async () => {
    const s = await setup();
    assert.deepEqual(rows(s.host), ['Default']);
    assert.equal(s.host.querySelector('[data-project-id="default"]').querySelector('[aria-current]') !== null, true);
    assert.equal(s.summary.textContent, 'Default');
    assert.equal(button(s.host, 'Open Default'), undefined, 'the open project has no Open button');
  });

  it('creates a project and asks to open it', async () => {
    const s = await setup();
    type(s.host.querySelector('[name="project-name"]'), 'Exercise IRON');
    s.host.querySelector('[data-new-project]').requestSubmit();
    await waitFor(() => s.opened.length === 1);
    assert.match(s.opened[0], /^p[a-z0-9]+$/);
    await waitFor(() => rows(s.host).includes('Exercise IRON'));
  });

  it('opens another project from the list', async () => {
    const s = await setup();
    const other = (await s.client.send('project.create', { name: 'Other' })).value;
    await waitFor(() => button(s.host, 'Open Other'));
    button(s.host, 'Open Other').click();
    assert.deepEqual(s.opened, [other.id]);
  });

  it('renames the open project', async () => {
    const s = await setup();
    const input = s.host.querySelector('[name="project-title"]');
    assert.equal(input.value, 'Default');
    type(input, 'Home station');
    button(s.host, 'Rename').click();
    await waitFor(() => s.summary.textContent === 'Home station');
    assert.deepEqual(rows(s.host), ['Home station']);
  });

  it('exports the open project as one JSON file', async () => {
    const s = await setup();
    await s.client.send('coa.create', { name: 'COA 1' });
    button(s.host, 'Export project').click();
    await waitFor(() => s.saved.length === 1);
    assert.match(s.saved[0].name, /^default-project_\d{6}Z[A-Z]{3}\d{2}\.json$/);
    const doc = JSON.parse(await s.saved[0].blob.text());
    assert.equal(doc.format, 'coa-builder/project');
    assert.deepEqual(doc.coas.map((c) => c.name), ['COA 1']);
  });

  it('imports a project file as a new project and asks to open it; a bad file says why', async () => {
    const s = await setup();
    await s.client.send('coa.create', { name: 'Shared COA' });
    const doc = (await s.client.ask('project.export')).value;
    const input = s.host.querySelector('input[type="file"]');
    const choose = (text, name) => {
      const files = new DataTransfer();
      files.items.add(new File([text], name, { type: 'application/json' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change'));
    };
    choose('{ not json', 'bad.json');
    await waitFor(() => /not a COA Builder project file/i.test(s.host.querySelector('[role="alert"]').textContent));
    choose(JSON.stringify({ ...doc, name: 'From a colleague' }), 'p.json');
    await waitFor(() => s.opened.length === 1);
    await waitFor(() => rows(s.host).includes('From a colleague'));
  });

  it('deletes another project after confirming; the open and Default projects cannot be deleted', async () => {
    const s = await setup();
    await s.client.send('project.create', { name: 'Old exercise' });
    await waitFor(() => button(s.host, 'Delete Old exercise'));
    assert.equal(button(s.host, 'Delete Default'), undefined);
    button(s.host, 'Delete Old exercise').click();
    assert.match(s.host.querySelector('dialog').textContent, /Old exercise/);
    [...s.host.querySelectorAll('dialog button')].find((b) => b.textContent === 'Delete').click();
    await waitFor(() => rows(s.host).length === 1);
    assert.deepEqual(rows(s.host), ['Default']);
  });
});
