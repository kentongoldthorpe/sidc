// Chooses where COAs are kept, at start-up:
//   1. GeoJSON files, when serve.ps1 is serving the app (GET /api/health → { storage: "files" })
//   2. this browser's localStorage, when it is usable
//   3. memory only (nothing survives a reload), and the label says so
import { HttpFileCoaRepository } from './http-file-coa-repository.js';
import { LocalStorageCoaRepository } from './local-storage-coa-repository.js';
import { InMemoryCoaRepository } from './in-memory-coa-repository.js';
import { HttpFileSettingsRepository } from './http-file-settings-repository.js';
import { LocalStorageSettingsRepository } from './local-storage-settings-repository.js';
import { InMemorySettingsRepository } from './in-memory-settings-repository.js';
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
 * @returns {Promise<{ kind: 'files'|'browser'|'memory', label: string, repository: object, settingsRepository: object, documentRepository: object }>}
 *   COAs, the settings (shared frame, marking) and the other documents (systems, threat models) are
 *   always kept in the same place.
 */
export async function pickCoaRepository({ fetch, getStorage, baseUrl = '' } = {}) {
  const info = await fileServerInfo(fetch, baseUrl);
  if (info) {
    return {
      kind: 'files',
      label: info.dataDir ? `Saved as files in ${info.dataDir}` : 'Saved as files',
      repository: new HttpFileCoaRepository({ fetch, baseUrl }),
      settingsRepository: new HttpFileSettingsRepository({ fetch, baseUrl }),
      documentRepository: new HttpFileDocumentRepository({ fetch, baseUrl }),
    };
  }
  const storage = usableStorage(getStorage);
  if (storage) {
    return {
      kind: 'browser', label: 'Saved in this browser only',
      repository: new LocalStorageCoaRepository({ storage }), settingsRepository: new LocalStorageSettingsRepository({ storage }),
      documentRepository: new LocalStorageDocumentRepository({ storage }),
    };
  }
  return {
    kind: 'memory', label: 'Not saved: memory only',
    repository: new InMemoryCoaRepository(), settingsRepository: new InMemorySettingsRepository(), documentRepository: new InMemoryDocumentRepository(),
  };
}
