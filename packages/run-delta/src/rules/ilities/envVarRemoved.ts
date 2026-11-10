/**
 * rules/ilities/envVarRemoved.ts — `env-var-removed` (ilities.compatibility, info; C7 wire contracts): an
 * environment variable or binding the run's changed files read before and no longer read. Other files may
 * still read it, so this is information about the changed files, not a broken contract. One finding per
 * name ({@link envVarRule}).
 *
 * Heuristic: text-level; WS4 call facts replace it.
 */

import { envVarRule } from '../support/envVars.js';

export const envVarRemoved = envVarRule({ id: 'env-var-removed', version: 2, dimension: 'ilities.compatibility', severity: 'info', present: 'before' });
