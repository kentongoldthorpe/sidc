// Chooses where everything is kept (COAs, settings, systems, threat models), at start-up:
//   1. GeoJSON files, when serve.ps1 is serving the app (GET /api/health → { storage: "files" })
//   2. this browser's localStorage, when it is usable
//   3. memory only (nothing survives a reload), and the label says so
import { HttpFileDocumentRepository } from './http-file-document-repository.js';
import { LocalStorageDocumentRepository } from './local-storage-document-repository.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';

const PROBE_KEY = 'coa-builder:probe';

async function fileServerInfo(fetch, baseUrl) {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    if (!response.ok) return null;
    const info = await response.json();
    return info?.storage === 'files' ? info : null;
  } catch {
    return null; // not served by serve.ps1 (or offline)
  }
}

function usableStorage(getStorage) {
  try {
    const storage = getStorage?.();
    if (!storage) return null;
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch {
    return null; // blocked, private mode without quota, …
  }
}

/**
 * @param {{ fetch?: typeof fetch, getStorage?: () => Storage, baseUrl?: string }} options
 *   getStorage is a function because merely reading window.localStorage can throw.
 * @returns {Promise<{ kind: 'files'|'browser'|'memory', label: string, documentRepository: object }>}
 */
export async function pickStorage({ fetch, getStorage, baseUrl = '' } = {}) {
  const info = await fileServerInfo(fetch, baseUrl);
  if (info) {
    return { kind: 'files', label: info.dataDir ? `Saved as files in ${info.dataDir}` : 'Saved as files', documentRepository: new HttpFileDocumentRepository({ fetch, baseUrl }) };
  }
  const storage = usableStorage(getStorage);
  if (storage) return { kind: 'browser', label: 'Saved in this browser only', documentRepository: new LocalStorageDocumentRepository({ storage }) };
  return { kind: 'memory', label: 'Not saved: memory only', documentRepository: new InMemoryDocumentRepository() };
}
