// A well-behaved domain module: only shared/domain imports, no globals.
// Mentions of window, document and localStorage inside comments are fine.
import { ok } from '../shared/result.js';
import { other } from './other.js';
const documentId = 'id'; // identifier merely containing "document"
const label = "uses window and ms.Symbol only inside a string";
const tpl = `localStorage ${documentId} in template text`;
export const x = { documentId, label, tpl, ok, other, msg: { window: 1 } };
