// Tiny DOM helpers for views. User data only ever goes in as text, never as markup.

/**
 * el('li', { class: 'x', dataset: { coaId }, attrs: { 'aria-label': '…' }, on: { click } }, ...children)
 * Children may be elements, strings (set as text) or null.
 */
export function el(tag, { class: className, dataset = {}, attrs = {}, on = {}, text } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(dataset)) node.dataset[k] = v;
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
  for (const [type, fn] of Object.entries(on)) node.addEventListener(type, fn);
  if (text !== undefined) node.textContent = text;
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

/** A readable message for a failed Result: field problems for VALIDATION_FAILED, otherwise its message. */
export function describeError(error) {
  if (error?.code === 'VALIDATION_FAILED' && Array.isArray(error.details?.problems)) {
    return error.details.problems.map((p) => p.reason.replace(/^./, (c) => c.toUpperCase())).join('. ');
  }
  return error?.message ?? 'Something went wrong';
}
