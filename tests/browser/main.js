// Loads every spec and runs them. A module (not inline) so the page can run under the app's CSP.
import './csp-watch.js'; // first: records policy violations from the start
import { run } from './runner.js';
import './shell.spec.js';
import './coa-list.spec.js';
import './map-view.spec.js';
import './symbol-editor.spec.js';
import './export-view.spec.js';
import './slide-export.spec.js';
import './graphics.spec.js';
import './active-coa.spec.js';
import './storage-health.spec.js';
import './undo.spec.js';
import './sync.spec.js';
import './a11y.spec.js';
import './keyboard.spec.js';
import './performance.spec.js';
import './systems.spec.js';
import './threat-workspace.spec.js';
import './threat-coas.spec.js';
import './placement.spec.js';
import './csp.spec.js'; // last: no violations while everything above ran

run(document.getElementById('results'));
