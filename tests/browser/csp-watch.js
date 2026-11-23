// Records Content-Security-Policy violations while the specs run (the page carries the app's CSP).
export const violations = [];
document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`));
