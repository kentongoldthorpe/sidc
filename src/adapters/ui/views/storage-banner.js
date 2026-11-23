// Storage banner (driving adapter): tells the user when a change was not saved, why, and what to do.
import { el } from './dom.js';

const MESSAGES = Object.freeze({
  STORAGE_UNAVAILABLE: 'Your last change was not saved: the COA store cannot be reached. If you use serve.ps1, check that it is still running. Checking again every few seconds.',
  STORAGE_QUOTA_EXCEEDED: 'Your last change was not saved: browser storage is full. Back up your COAs, then delete ones you no longer need.',
  UNEXPECTED: 'Something went wrong and your last change may not have been saved. Back up your COAs, then reload the page.',
});
const RECOVERED_MS = 6000;

/**
 * @param {{ root: HTMLElement, health: object, backup: () => Promise<string> }} options
 * @returns {{ destroy(): void }}
 */
export function mountStorageBanner({ root, health, backup }) {
  let timer = null;
  const text = el('p', { class: 'storage-banner-text' });
  const status = el('p', { class: 'status' });
  const retry = el('button', { attrs: { type: 'button' }, text: 'Retry now', on: { click: () => health.retry() } });
  const backupButton = el('button', { attrs: { type: 'button' }, text: 'Back up all COAs', on: { click: onBackup } });
  const dismiss = el('button', { class: 'link', attrs: { type: 'button' }, text: 'Dismiss', on: { click: () => { banner.hidden = true; } } });
  const banner = el('div', { class: 'storage-banner', dataset: { storageBanner: '' }, attrs: { role: 'alert', hidden: true } },
    text, el('div', { class: 'actions' }, retry, backupButton, dismiss), status);
  root.append(banner);

  async function onBackup() {
    status.textContent = 'Backing up…';
    try { status.textContent = await backup(); } catch (error) { status.textContent = `Backup failed: ${error?.message ?? error}`; }
  }

  function show(state) {
    clearTimeout(timer);
    status.textContent = '';
    if (state.ok) {
      if (!state.recovered) { banner.hidden = true; return; }
      banner.dataset.state = 'ok';
      text.textContent = 'Saving is working again. Changes that failed were not saved; check your last edits.';
      retry.hidden = true;
      backupButton.hidden = true;
      banner.hidden = false;
      timer = setTimeout(() => { banner.hidden = true; }, RECOVERED_MS);
      return;
    }
    banner.dataset.state = 'problem';
    text.textContent = MESSAGES[state.code] ?? MESSAGES.UNEXPECTED;
    retry.hidden = state.code === 'STORAGE_QUOTA_EXCEEDED';
    backupButton.hidden = false;
    banner.hidden = false;
  }
  const off = health.subscribe(show);

  return { destroy() { off(); clearTimeout(timer); banner.remove(); } };
}
