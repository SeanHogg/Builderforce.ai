/**
 * rules/tlsVerifyDisabled.ts — `tls-verify-disabled` (security, error; C5.6): certificate verification
 * turned off (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `strictSSL: false`,
 * `strict-ssl=false`, `insecureSkipVerify: true`, Python `verify=False`, `curl -k`) in a changed
 * non-test file. Patterns are the `insecureConfig['tls-verify-disabled']` registry row.
 */

import { configPatternRule, isSurfacePath } from './support/configRule.js';

export const tlsVerifyDisabled = configPatternRule({ id: 'tls-verify-disabled', severity: 'error', files: isSurfacePath });
