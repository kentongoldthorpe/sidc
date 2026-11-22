// Result: errors as values. { ok: true, value } | { ok: false, error: AppError }
// A failed Result is propagated by returning it as-is.
import { appError, isAppError } from './errors.js';

/**
 * @template T
 * @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: import('./errors.js').AppError }} Result
 */

/** Success. The value is kept by reference (not frozen); the wrapper is frozen. */
export const ok = (value) => Object.freeze({ ok: true, value });

/**
 * Failure with a new AppError.
 * @throws {TypeError} on unknown code, blank message or non-JSON details (programmer error)
 */
export const err = (code, message, details) => Object.freeze({ ok: false, error: appError(code, message, details) });

/** Structural check, also true for results that went through JSON. @returns {boolean} */
export const isResult = (r) => r !== null && typeof r === 'object'
  && ((r.ok === true && 'value' in r) || (r.ok === false && isAppError(r.error)));
