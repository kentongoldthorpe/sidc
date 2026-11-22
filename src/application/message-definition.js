// Message definitions: each command/query the application accepts is declared as data
// (kind, type, payload version, payload fields) plus a handle() function. The shared
// wrapper checks version and payload shape before handle() runs.
import { MessageKind } from '../shared/envelope.js';
import { ErrorCode } from '../shared/errors.js';
import { ok, err } from '../shared/result.js';

/**
 * @typedef {Object} MessageDefinition
 * @property {'command'|'query'} kind
 * @property {string} type
 * @property {number} v                 the payload version this handler accepts
 * @property {string[]} required        payload fields that must be present
 * @property {string[]} optional        payload fields that may be present
 * @property {(args: { payload: Object, ctx: Object, ports: Object, envelope: Object }) =>
 *            Promise<import('../shared/result.js').Result<unknown>>} handle
 */

/** @returns {Readonly<MessageDefinition>} */
export function defineMessage({ kind, type, v = 1, required = [], optional = [], handle }) {
  if (kind !== MessageKind.COMMAND && kind !== MessageKind.QUERY) throw new TypeError(`defineMessage: bad kind for ${type}`);
  if (typeof handle !== 'function') throw new TypeError(`defineMessage: ${type} needs handle()`);
  return Object.freeze({ kind, type, v, required: Object.freeze([...required]), optional: Object.freeze([...optional]), handle });
}

export const validationFailed = (message, problems) => err(ErrorCode.VALIDATION_FAILED, message, { problems });

/** Version and field-presence checks. @returns {import('../shared/result.js').Result<void>} */
export function checkPayload(definition, { v, payload }) {
  if (v !== definition.v) {
    return err(ErrorCode.UNSUPPORTED_VERSION, `${definition.type} v${v} is not supported`, {
      type: definition.type, v, supported: [definition.v],
    });
  }
  const known = new Set([...definition.required, ...definition.optional]);
  const problems = [
    ...definition.required.filter((f) => !(f in payload)).map((field) => ({ field, reason: 'is required' })),
    ...Object.keys(payload).filter((f) => !known.has(f)).map((field) => ({ field, reason: 'unknown field' })),
  ];
  return problems.length ? validationFailed(`Invalid ${definition.type} payload`, problems) : ok();
}

/** @returns {{field:string, reason:string}[]} */
export const checkId = (field, value) =>
  typeof value === 'string' && value.trim() !== '' ? [] : [{ field, reason: 'must be a non-blank id' }];

/** expectedRevision-style fields: an integer ≥ 1. @returns {{field:string, reason:string}[]} */
export const checkRevision = (field, value) =>
  Number.isInteger(value) && value >= 1 ? [] : [{ field, reason: 'must be an integer ≥ 1' }];

/** CONFLICT when the client's view of the COA is out of date. */
export const staleRevision = (coaId, expectedRevision, actualRevision) =>
  err(ErrorCode.CONFLICT, `COA ${coaId} was changed elsewhere; reload and try again`, {
    coaId, expectedRevision, actualRevision,
  });

/**
 * INVALID_SIDC when a well-formed SIDC is not one the SymbolRenderer recognises.
 * @returns {import('../shared/result.js').Result<void>}
 */
export function checkSidcKnown(symbolRenderer, sidc) {
  const { valid, warnings } = symbolRenderer.render(sidc, {});
  return valid ? ok() : err(ErrorCode.INVALID_SIDC, `SIDC ${sidc} is not a recognised symbol`, { sidc, warnings });
}
