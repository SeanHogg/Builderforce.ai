import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool, type NeonDatabase } from 'drizzle-orm/neon-serverless';
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
    // The same proxy carries the WebSocket protocol `inTransaction` speaks, on its
    // `/v2` path. A local proxy is a plain socket and does no TLS pipelining.
    const proxy = new URL(endpoint.trim());
    neonConfig.wsProxy = () => `${proxy.host}/v2`;
    neonConfig.useSecureWebSocket = proxy.protocol === 'https:';
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
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

/** The connection string each handle was built from — what `inTransaction` opens. */
const handleUrl = new WeakMap<object, string>();

function connect(url: string | undefined, variable: string): Db {
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error(
      `${variable} is not set. Set it with: wrangler secret put ${variable} (in the api/ directory)`
    );
  }
  const db = drizzle(withDatabaseAvailability(neon(url)), { schema });
  handleUrl.set(db, url);
  return db;
}

/**
 * Build a Drizzle database instance using the Neon HTTP driver.
 *
 * @neondatabase/serverless uses HTTP fetch instead of TCP, making it
 * fully compatible with Cloudflare Workers without nodejs_compat TCP quirks.
 */
export function buildDatabase(env: Env): Db {
  const existing = coreHandles.get(env);
  if (existing) return existing;
  applyFetchEndpoint(env.NEON_FETCH_ENDPOINT);
  const db = connect(env.NEON_DATABASE_URL, 'NEON_DATABASE_URL');
  handleEnv.set(db, env);
  coreHandles.set(env, db);
  return db;
}

/**
 * One core handle per env, i.e. per isolate — the same key `presentation/appCache.ts`
 * builds the app against. The HTTP driver holds no connection, so a handle is just a
 * configured client; building one per request (the auth middleware did, and ~125
 * other call sites still ask) only allocated a new client and threw away every memo
 * keyed on the handle, the sibling handles above among them.
 */
const coreHandles = new WeakMap<Env, Db>();

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

/**
 * The operational-data client (the core handle itself when unbound). Memoised like
 * every other handle: building one runs `drizzle({ schema })`, which walks every
 * table and relation, and this is resolved per request on the trace/usage paths.
 */
export function buildTransactionalDatabase(env: Env): Db {
  return siblingDatabase(env, buildDatabase(env), 'operational');
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

/** The handle a transaction body receives: the same query builder as {@link Db}. */
export type Tx = Parameters<Parameters<NeonDatabase<typeof schema>['transaction']>[0]>[0];

/**
 * Run `work` in ONE interactive database transaction — reads and writes that see
 * each other, commit together, or roll back together.
 *
 * THE way to get a transaction. `db.transaction()` on a {@link Db} THROWS: the HTTP
 * driver is one request per statement and has no session to hold a transaction open
 * ("No transactions support in neon-http driver"). Its `db.batch([...])` is atomic
 * but non-interactive — no statement can branch on what an earlier one returned.
 * Every read-check-write (a slot that must still be free, a posting that must still
 * be open) needs the real thing, so this opens a short-lived WebSocket pool to the
 * same database the handle points at, runs the transaction there, and closes it.
 *
 * Writes only, and only where atomicity is the point: a socket handshake costs more
 * than an HTTP query, so a plain read or a single statement stays on `db`.
 *
 * A handle not built here (a test double) has no connection string, and is handed
 * its own `transaction()` — which is what those doubles implement.
 */
export async function inTransaction<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  const url = handleUrl.get(db);
  if (!url) return db.transaction(work as never) as Promise<T>;
  const pool = new Pool({ connectionString: url });
  try {
    return await drizzlePool(pool, { schema }).transaction(work);
  } finally {
    await pool.end();
  }
}
