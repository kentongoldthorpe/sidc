// The COA file API contract against the Node fake (always) and the real serve.ps1 (when PowerShell exists).
import { describe, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { startFileServer } from '../../support/file-server.js';
import { describeFileApiContract } from '../../contracts/file-api.contract.js';
import { describeDocApiContract } from '../../contracts/doc-api.contract.js';
import { createFakeFileApi } from '../../support/fake-file-api.js';

describeFileApiContract('Node fake', async () => createFakeFileApi());
describeDocApiContract('Node fake', async () => createFakeFileApi());

const hasPwsh = spawnSync(process.env.PWSH || 'pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

describe('real serve.ps1', { skip: hasPwsh ? false : 'PowerShell not found (set PWSH or put pwsh on PATH)' }, () => {
  let server;
  before(async () => { server = await startFileServer(); });
  after(async () => { await server?.stop(); });
  describeFileApiContract('serve.ps1', async () => server);
  describeDocApiContract('serve.ps1', async () => server);
});
