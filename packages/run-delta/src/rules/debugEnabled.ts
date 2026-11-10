/**
 * rules/debugEnabled.ts — `debug-enabled` (security, warn; C5.6): a debug / verbose / trace-level flag
 * switched on in a PRODUCTION config (wrangler, Dockerfile, compose, `.env.production`, a `prod`-named
 * config file). Development configs are not read: names with dev / local / test / override / example
 * are excluded, and so is a wrangler `[env.<name>]` table for a non-production environment. Patterns are
 * the `insecureConfig['debug-enabled']` registry row.
 */

import { configPatternRule, isProdConfigPath, isWranglerPath } from './support/configRule.js';
import type { TextView } from './support/files.js';
import type { Hit } from './support/stateRule.js';

const ENV_TABLE = /^\s*\[\[?\s*env\.([A-Za-z0-9_-]+)/gm;
const PROD_ENV = /^prod(uction)?$/i;

/** In a wrangler file, a hit under a non-production `[env.<name>]` table is not production config. */
function inProdSection(view: TextView, hit: Hit): boolean {
    if (!isWranglerPath(view.path)) return true;
    const tables = view.memo('wrangler:envTables', () => [...view.text.matchAll(ENV_TABLE)].map((m) => ({ offset: m.index, env: m[1]! })));
    let env: string | undefined;
    for (const t of tables) { if (t.offset > hit.offset) break; env = t.env; }
    return env === undefined || PROD_ENV.test(env);
}

export const debugEnabled = configPatternRule({ id: 'debug-enabled', severity: 'warn', files: isProdConfigPath, keep: inProdSection });
