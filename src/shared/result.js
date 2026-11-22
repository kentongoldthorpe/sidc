// Result: errors as values. { ok: true, value } | { ok: false, error: AppError }
import { appError, isAppError } from './errors.js';

/**
 * @template T
 * @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: import('./errors.js').AppError }} Result
 */

/** Success. The value is kept by reference (not frozen); the wrapper is frozen. */
export const ok = (value) => Object.freeze({ ok: true, value });

/**
 * Failure. Either `err(code, message, details?)` or `err(existingAppError)` to propagate.
 * @throws {TypeError} on unknown code (programmer error)
 */
export function err(codeOrError, message, details) {
  if (isAppError(codeOrError)) {
    const e = codeOrError;
    // Reuse an error built by appError(); normalise (copy + freeze) one that came from JSON.
    return Object.freeze({ ok: false, error: Object.isFrozen(e) ? e : appError(e.code, e.message, e.details) });
  }
  return Object.freeze({ ok: false, error: appError(codeOrError, message, details) });
}

/** @returns {boolean} */
export const isResult = (r) => r !== null && typeof r === 'object'
  && ((r.ok === true && 'value' in r) || (r.ok === false && isAppError(r.error)));

export const isOk = (r) => isResult(r) && r.ok === true;
export const isErr = (r) => isResult(r) && r.ok === false;
