// SIDC value object: structural rules only. Whether a well-formed SIDC names a real
// symbol is the SymbolRenderer port's job (INVALID_SIDC, COA-1.11).
//
//   2525D/E, APP-6D/E: 20 or 30 digits
//   2525C:             15 characters of A–Z, 0–9, '-' and '*'

const NUMERIC = /^(?:\d{20}|\d{30})$/;
const LETTER_FORM = /^[A-Z0-9*-]{15}$/;

/** @returns {{ value: string } | { problems: {field:string, reason:string}[] }} trimmed, upper-cased */
export function parseSidc(raw, field = 'sidc') {
  if (typeof raw !== 'string') return { problems: [{ field, reason: 'must be a string' }] };
  const sidc = raw.trim().toUpperCase();
  if (sidc === '') return { problems: [{ field, reason: 'must not be blank' }] };
  if (!NUMERIC.test(sidc) && !LETTER_FORM.test(sidc)) {
    return { problems: [{ field, reason: 'must be 20 or 30 digits (2525D/E) or 15 characters A-Z 0-9 - * (2525C)' }] };
  }
  return { value: sidc };
}
