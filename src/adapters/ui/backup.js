// "Back up all COAs": every COA in one coa-builder/import JSON file (docs/IMPORT-FORMAT.md), so it
// can be imported again here or elsewhere. When stored COAs cannot be read (the file server has
// stopped), the COA on screen is still saved from memory, and the message says what is missing.
import { writeCoaData, DATA_FORMATS } from '../files/coa-data.js';
import { formatDtg } from '../export/slide-layout.js';

const plural = (n) => `${n} COA${n === 1 ? '' : 's'}`;

/**
 * @param {{ client: object, activeCoa?: object, saveFile: (blob: Blob, name: string) => Promise<void>, now?: () => string }} options
 * @returns {Promise<string>} what was saved, for a status line
 */
export async function backupAllCoas({ client, activeCoa = null, saveFile, now = () => new Date().toISOString() }) {
  const coas = [];
  let unreadable = 0;
  const listed = await client.ask('coa.list', {});
  if (listed.ok) {
    for (const { id } of listed.value) {
      const loaded = await client.ask('coa.get', { coaId: id });
      if (loaded.ok) coas.push(loaded.value);
      else if (activeCoa?.get()?.id === id) coas.push(activeCoa.get());
      else unreadable += 1;
    }
  } else if (activeCoa?.get()) {
    coas.push(activeCoa.get());
  }
  if (coas.length === 0) return listed.ok ? 'There are no COAs to back up.' : 'Nothing could be backed up: the stored COAs could not be read.';

  const name = `coas-backup_${formatDtg(now())}.${DATA_FORMATS.json.extension}`;
  await saveFile(new Blob([writeCoaData('json', coas)], { type: DATA_FORMATS.json.mimeType }), name);
  if (!listed.ok) return `Backed up ${plural(coas.length)} (the one on screen) to ${name}; the stored COAs could not be read.`;
  return unreadable
    ? `Backed up ${plural(coas.length)} to ${name}; ${plural(unreadable)} could not be read.`
    : `Backed up ${plural(coas.length)} to ${name}.`;
}
