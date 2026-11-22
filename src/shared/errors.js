// Application error codes and error values. Errors that callers are expected to
// handle are returned as values (see result.js); only programmer errors throw.
import { cloneJson, isJsonObject } from './freeze.js';

export const ErrorCode = Object.freeze({
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_SIDC: 'INVALID_SIDC',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNKNOWN_MESSAGE_TYPE: 'UNKNOWN_MESSAGE_TYPE',
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  IMPORT_INVALID: 'IMPORT_INVALID',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  UNEXPECTED: 'UNEXPECTED',
});

const KNOWN_CODES = new Set(Object.values(ErrorCode));

/** @param {unknown} code @returns {boolean} */
export const isErrorCode = (code) => typeof code === 'string' && KNOWN_CODES.has(code);

const isNonBlankString = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * @typedef {Object} AppError
 * @property {keyof typeof ErrorCode} code
 * @property {string} message  human-readable, safe to show in the UI
 * @property {Object} details  JSON data, e.g. { field: 'name' }
 */

/**
 * @param {string} code one of ErrorCode
 * @param {string} message
 * @param {Object} [details]
 * @returns {Readonly<AppError>}
 * @throws {TypeError} on unknown code, blank message or non-JSON details
 */
export function appError(code, message, details = {}) {
  if (!isErrorCode(code)) throw new TypeError(`appError: unknown error code "${String(code)}"`);
  if (!isNonBlankString(message)) throw new TypeError('appError: message must be a non-blank string');
  if (!isJsonObject(details)) throw new TypeError('appError: details must be a plain JSON object');
  return Object.freeze({ code, message, details: cloneJson(details) });
}

/** Structural check, also true for errors that went through JSON. @returns {boolean} */
export function isAppError(value) {
  return value !== null && typeof value === 'object'
    && isErrorCode(value.code)
    && isNonBlankString(value.message)
    && isJsonObject(value.details);
}
