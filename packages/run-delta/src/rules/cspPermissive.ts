/**
 * rules/cspPermissive.ts — `csp-permissive` (security, warn; C5.6): a content security policy that allows
 * `'unsafe-inline'` / `'unsafe-eval'`, a `default-src` / `script-src` wildcard, or helmet's
 * `contentSecurityPolicy: false`, in a changed non-test file (code, `_headers`, HTML, config). Patterns
 * are the `insecureConfig['csp-permissive']` registry row.
 */

import { configPatternRule, isSurfacePath } from './support/configRule.js';

export const cspPermissive = configPatternRule({ id: 'csp-permissive', severity: 'warn', files: isSurfacePath });
