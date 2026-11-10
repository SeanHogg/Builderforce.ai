/**
 * rules/ilities/envVarAdded.ts — `env-var-added` (ilities.compatibility, info; C7 wire contracts): the
 * run's changed files read an environment variable or binding none of them read before — a new
 * deploy-time requirement. One finding per name ({@link envVarRule}).
 *
 * Heuristic: text-level; WS4 call facts replace it.
 */

import { envVarRule } from '../support/envVars.js';

export const envVarAdded = envVarRule({ id: 'env-var-added', version: 1, dimension: 'ilities.compatibility', severity: 'info', present: 'after' });
