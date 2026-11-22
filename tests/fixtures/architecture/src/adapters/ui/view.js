// Adapters may use globals and import inward; the checker ignores them.
import { createCoa } from '../../domain/coa.js';
export const el = document.getElementById('app');
export { createCoa };
