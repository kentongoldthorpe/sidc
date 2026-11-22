import { defineMessage, validationFailed } from '../message-definition.js';
import { parseSidc } from '../../domain/sidc.js';
import { parseSymbolFields } from '../../domain/map-symbol.js';
import { ok } from '../../shared/result.js';

export const PREVIEW_SIZE = Object.freeze({ min: 10, max: 200, default: 40 });

const checkSize = (size) => (typeof size === 'number' && Number.isFinite(size) && size >= PREVIEW_SIZE.min && size <= PREVIEW_SIZE.max
  ? [] : [{ field: 'size', reason: `must be a number from ${PREVIEW_SIZE.min} to ${PREVIEW_SIZE.max}` }]);

/**
 * symbol.preview { sidc, label?, modifiers?, size? } → ok({ svg, valid, warnings, anchor, width, height })
 * Works for any SIDC string so an editor can preview as the user types: a malformed SIDC is still
 * drawn, reported as invalid with a format warning first.
 */
export const previewSymbol = defineMessage({
  kind: 'query', type: 'symbol.preview', v: 1,
  required: ['sidc'], optional: ['label', 'modifiers', 'size'],
  async handle({ payload: { sidc, size = PREVIEW_SIZE.default, ...fields }, ports: { symbolRenderer } }) {
    const parsedFields = parseSymbolFields({ label: '', modifiers: {}, ...fields });
    const problems = [
      ...(typeof sidc === 'string' ? [] : [{ field: 'sidc', reason: 'must be a string' }]),
      ...parsedFields.problems,
      ...checkSize(size),
    ];
    if (problems.length) return validationFailed('Invalid symbol.preview payload', problems);

    const parsedSidc = parseSidc(sidc);
    const formatWarnings = (parsedSidc.problems ?? []).map((p) => `${p.field} ${p.reason}`);
    const rendered = symbolRenderer.render(parsedSidc.value ?? sidc.trim().toUpperCase(), {
      label: parsedFields.value.label, modifiers: parsedFields.value.modifiers, size,
    });
    return ok({
      ...rendered,
      valid: formatWarnings.length === 0 && rendered.valid,
      warnings: [...formatWarnings, ...rendered.warnings],
    });
  },
});
