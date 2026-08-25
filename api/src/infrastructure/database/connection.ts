import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import type { Env } from '../../env';

export type Db = NeonHttpDatabase<typeof schema>;

/**
 * Point the HTTP driver at a self-hosted Neon SQL endpoint.
 *
 * The driver normally derives its endpoint from the connection string host
 * (`https://<host>/sql`), which is correct against Neon and impossible to
 * satisfy with a local Postgres. Binding NEON_FETCH_ENDPOINT redirects it at
 * the `db-proxy` container from docker-compose.yml, which speaks the same
 * HTTP SQL protocol in front of plain Postgres.
 *
 * Production never binds this var, so the call below is a no-op there and the
 * endpoint stays derived from the Neon host. Assigning is idempotent, so
 * doing it per-connect costs nothing.
 */
function applyFetchEndpoint(endpoint: string | undefined): void {
  if (endpoint && endpoint.trim()) {
    neonConfig.fetchEndpoint = endpoint.trim();
  }
}

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
  applyFetchEndpoint(env.NEON_FETCH_ENDPOINT);
  return connect(env.NEON_DATABASE_URL, 'NEON_DATABASE_URL');
}

/**
 * Build the isolated operational-data client. Cross-account references are
 * deliberately plain IDs: Neon cannot enforce foreign keys across databases.
 * The fallback keeps tests and staged deployments working until the new secret
 * is installed; production should always bind NEON_TRANSACTIONAL_DATABASE_URL.
 */
export function buildTransactionalDatabase(env: Env): Db {
  applyFetchEndpoint(env.NEON_FETCH_ENDPOINT);
  return connect(
    env.NEON_TRANSACTIONAL_DATABASE_URL?.trim() || env.NEON_DATABASE_URL,
    'NEON_TRANSACTIONAL_DATABASE_URL'
  );
}
