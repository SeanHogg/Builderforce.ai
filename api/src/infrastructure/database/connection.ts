import { neon } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import type { Env } from '../../env';

export type Db = NeonHttpDatabase<typeof schema>;

/**
 * THE database access type. Drizzle is the single access layer: every query in
 * the API goes through a `Db` built here — either via the typed query builder
 * (`db.select().from(...)`) or, for SQL the builder cannot express (window
 * functions, `pg_stat_*`, `VACUUM`), via `db.execute(sql\`...\`)`.
 *
 * Nothing outside this module may import `@neondatabase/serverless` — a raw
 * `neon()` client bypasses the schema types and was the source of the drift
 * this layer now prevents. `npm run check:db-access` enforces that.
 */
function connect(url: string | undefined, variable: string): Db {
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error(
      `${variable} is not set. Set it with: wrangler secret put ${variable} (in the api/ directory)`
    );
  }
  return drizzle(neon(url), { schema });
}

/**
 * Build a Drizzle database instance using the Neon HTTP driver.
 *
 * @neondatabase/serverless uses HTTP fetch instead of TCP, making it
 * fully compatible with Cloudflare Workers without nodejs_compat TCP quirks.
 */
export function buildDatabase(env: Env): Db {
  return connect(env.NEON_DATABASE_URL, 'NEON_DATABASE_URL');
}

/**
 * Build the isolated operational-data client. Cross-account references are
 * deliberately plain IDs: Neon cannot enforce foreign keys across databases.
 * The fallback keeps tests and staged deployments working until the new secret
 * is installed; production should always bind NEON_TRANSACTIONAL_DATABASE_URL.
 */
export function buildTransactionalDatabase(env: Env): Db {
  return connect(
    env.NEON_TRANSACTIONAL_DATABASE_URL?.trim() || env.NEON_DATABASE_URL,
    'NEON_TRANSACTIONAL_DATABASE_URL'
  );
}
