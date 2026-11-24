// export.header { format, formatVersion? } → ok(Header): the marking, project, DTG and application for
// a file about to be written (Epic 5 X-1). Exporters in the adapters put it in every file.
import { defineMessage, validationFailed } from '../message-definition.js';
import { exportHeader } from '../../domain/export-header.js';
import { DEFAULT_SETTINGS } from '../../domain/settings.js';
import { DEFAULT_PROJECT, DEFAULT_PROJECT_ID } from '../../domain/project.js';
import { VERSION } from '../../shared/version.js';
import { ok } from '../../shared/result.js';

export const APPLICATION = `COA Builder ${VERSION}`;

/** The header for `format`, from the open project's settings and name. */
export async function headerFor({ settingsStore, allDocuments, projectId, clock }, format, formatVersion = 1) {
  const settings = await settingsStore.get();
  if (!settings.ok) return settings;
  const project = await allDocuments.get('projects', projectId);
  const name = project.ok ? project.value.name : projectId === DEFAULT_PROJECT_ID ? DEFAULT_PROJECT.name : projectId;
  return ok(exportHeader({ marking: (settings.value ?? DEFAULT_SETTINGS).marking, project: name, exportedAt: clock.now(), application: APPLICATION, format, formatVersion }));
}

export const getExportHeader = defineMessage({
  kind: 'query', type: 'export.header', v: 1, required: ['format'], optional: ['formatVersion'],
  async handle({ payload: { format, formatVersion = 1 }, ports }) {
    const problems = [
      ...(typeof format === 'string' && /^[a-z0-9./+-]{1,60}$/.test(format) ? [] : [{ field: 'format', reason: 'must name the file format, e.g. coa-builder/import or geojson' }]),
      ...(Number.isInteger(formatVersion) && formatVersion >= 1 ? [] : [{ field: 'formatVersion', reason: 'must be an integer ≥ 1' }]),
    ];
    if (problems.length) return validationFailed('Invalid export.header payload', problems);
    return headerFor(ports, format, formatVersion);
  },
});
