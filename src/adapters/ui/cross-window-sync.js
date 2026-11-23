// Keeps several windows (tabs) of the same person in step (decision D20: one user, several tabs).
// Each window announces its own changes on a BroadcastChannel; the others reload the active COA,
// the COA list and the settings. The browser's `storage` event (another tab wrote browser storage)
// and getting focus (a change nobody announced, e.g. in another browser) also reload. Reloading
// teaches the app client the new revisions, so the next command does not hit "changed elsewhere".
import { coalesce } from './views/coalesce.js';

const ANNOUNCED = /^(coa|symbol|graphic)\./;

/**
 * @param {{ client: object, win: EventTarget & { BroadcastChannel?: typeof BroadcastChannel }, activeCoa: object,
 *           refreshList: () => void, refreshSettings: () => void, onUpdated?: (text: string) => void, channelName?: string }} options
 * @returns {{ destroy(): void }}
 */
export function createCrossWindowSync({ client, win, activeCoa, refreshList, refreshSettings, onUpdated = () => {}, channelName = 'coa-builder' }) {
  const channel = typeof win.BroadcastChannel === 'function' ? new win.BroadcastChannel(channelName) : null;
  let settingsChanged = false;

  const reload = coalesce(async () => {
    const before = activeCoa.get();
    refreshList();
    if (settingsChanged) { settingsChanged = false; refreshSettings(); }
    await activeCoa.refresh();
    const after = activeCoa.get();
    if (before && after && after.id === before.id && after.revision !== before.revision) onUpdated('Updated from another window.');
  });

  // Tell the other windows about this window's own changes (app events are this window's only).
  const offEvents = [
    client.subscribe('coa.*', (e) => channel?.postMessage({ kind: 'coa', type: e.type })),
    client.subscribe('symbol.*', (e) => channel?.postMessage({ kind: 'coa', type: e.type })),
    client.subscribe('graphic.*', (e) => channel?.postMessage({ kind: 'coa', type: e.type })),
    client.subscribe('settings.*', (e) => channel?.postMessage({ kind: 'settings', type: e.type })),
  ];
  const onMessage = (message) => {
    if (message.data?.kind === 'settings') settingsChanged = true;
    else if (!ANNOUNCED.test(message.data?.type ?? '')) return;
    reload();
  };
  const onStorage = () => { settingsChanged = true; reload(); };
  const onFocus = () => { settingsChanged = true; reload(); };
  channel?.addEventListener('message', onMessage);
  win.addEventListener('storage', onStorage);
  win.addEventListener('focus', onFocus);

  return {
    destroy() {
      offEvents.forEach((off) => off());
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      win.removeEventListener('storage', onStorage);
      win.removeEventListener('focus', onFocus);
    },
  };
}
