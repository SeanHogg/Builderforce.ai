import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { withDatabaseAvailability } from './neonAvailability';
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
/**
 * The env each core handle was built from.
 *
 * Production splits the data across Neon accounts, and some readers hold only the
 * core handle when they need a sibling database — the usage ledger lives in the
 * operational one. Threading `env` through every signature that ends in such a read
 * (the finance lens alone has eleven callers, most with no env in reach) is what left
 * those readers querying the core database's frozen copy. A handle that remembers its
 * env lets {@link siblingDatabaseOf} resolve the right database from what the caller
 * already holds. Handles built any other way (test doubles, a sibling handle) are
 * simply not found and resolve to themselves.
 */
const handleEnv = new WeakMap<object, Env>();

function connect(url: string | undefined, variable: string): Db {
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error(
      `${variable} is not set. Set it with: wrangler secret put ${variable} (in the api/ directory)`
    );
  }
  return drizzle(withDatabaseAvailability(neon(url)), { schema });
}

/**
 * Build a Drizzle database instance using the Neon HTTP driver.
 *
 * @neondatabase/serverless uses HTTP fetch instead of TCP, making it
 * fully compatible with Cloudflare Workers without nodejs_compat TCP quirks.
 */
export function buildDatabase(env: Env): Db {
  applyFetchEndpoint(env.NEON_FETCH_ENDPOINT);
  const db = connect(env.NEON_DATABASE_URL, 'NEON_DATABASE_URL');
  handleEnv.set(db, env);
  return db;
}

/**
 * THE SIBLING DATABASES — the endpoints split out of the core one, by role, and the
 * variable that binds each. ONE rule for all of them: a sibling whose URL is bound is
 * its own Neon endpoint; one whose URL is unbound (local, tests, a staged rollout) is
 * served by the core database, where its tables also exist.
 *
 *   • operational — logs, audit, telemetry and the usage ledger.
 *   • apps        — the marketplace apps' runtime (`project_sites`, `site_*`), so
 *                   public app traffic wakes that endpoint and not the core one.
 *
 * Cross-database references are plain ids: Postgres cannot enforce a foreign key
 * across accounts. The migration tracks mirror this list (scripts/lib/migrationTracks.mjs).
 */
const SIBLING_URL = {
  operational: 'NEON_TRANSACTIONAL_DATABASE_URL',
  apps: 'NEON_APPS_DATABASE_URL',
} as const;

export type SiblingDatabase = keyof typeof SIBLING_URL;

/** Whether `which` is split out to its own endpoint in this environment. */
export function hasSiblingDatabase(env: Env | undefined, which: SiblingDatabase): boolean {
  return Boolean(env?.[SIBLING_URL[which]]?.trim());
}

function buildSibling(env: Env, which: SiblingDatabase): Db {
  applyFetchEndpoint(env.NEON_FETCH_ENDPOINT);
  return connect(env[SIBLING_URL[which]]?.trim() || env.NEON_DATABASE_URL, SIBLING_URL[which]);
}

/** The operational-data client (falls back to the core database when unbound). */
export function buildTransactionalDatabase(env: Env): Db {
  return buildSibling(env, 'operational');
}

/**
 * One sibling handle per core handle and role, built on first use.
 *
 * Callers resolve a sibling per call rather than threading it through, and some do so
 * in loops (a sweep's per-tenant pass) or group work by the handle they get back (the
 * entity layer runs one UNION per database). A fresh client per call would make every
 * resolution a different object — defeating that grouping, one statement per table
 * instead of per database — so the handle is memoised against the core one it came from.
 */
const siblingHandles = new WeakMap<object, Map<SiblingDatabase, Db>>();

/** The sibling `which`, or `core` itself when that sibling is not split out here. */
export function siblingDatabase(env: Env | undefined, core: Db, which: SiblingDatabase): Db {
  if (!env || !hasSiblingDatabase(env, which)) return core;
  let byRole = siblingHandles.get(core);
  if (!byRole) {
    byRole = new Map();
    siblingHandles.set(core, byRole);
  }
  let handle = byRole.get(which);
  if (!handle) {
    handle = buildSibling(env, which);
    byRole.set(which, handle);
  }
  return handle;
}

/**
 * {@link siblingDatabase} for a caller holding only a core handle — the env comes from
 * the handle itself. Idempotent: a sibling handle (or a test double) resolves to itself.
 */
export function siblingDatabaseOf(core: Db, which: SiblingDatabase): Db {
  return siblingDatabase(handleEnv.get(core), core, which);
}
