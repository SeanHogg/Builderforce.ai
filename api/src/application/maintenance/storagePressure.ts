/**
 * storagePressure — the sweep that acts when an endpoint is running out of room.
 *
 * WHAT THE OTHER TWO SWEEPS DO NOT DO. `runRetentionPurge` and the vacuum/reclaim pair
 * are a STEADY-STATE policy: every window is the one chosen for that table when nothing
 * is wrong, and the reclaim that actually returns pages to Neon runs weekly. Between
 * them they have no notion of how full the database is, so the failure they cannot see
 * is the one that matters — a write rate that outgrows its own windows. The operational
 * endpoint reached 86.5% of the Free-plan 512 MB branch ceiling with both sweeps
 * running nightly and correctly: nothing was broken, the windows were simply too
 * generous for the volume, and the first anyone knew of it was a console banner.
 *
 * WHAT THIS ADDS. One measurement — `pg_database_size` against the plan ceiling — and
 * a graduated response keyed to it:
 *
 *   < 80%  nothing. The steady-state sweeps own the database and this reports the ratio.
 *   ≥ 80%  purge every compressible table at a window interpolated HALFWAY to its
 *          `pressureFloorDays`, vacuum, then run the bloat reclaim immediately instead
 *          of waiting out the weekly tick.
 *   ≥ 90%  the same, at the floor itself.
 *
 * THE FLOOR IS THE SAFETY PROPERTY. This sweep can shorten a retention window without a
 * human, so what it may never do has to be declared rather than judged: every window it
 * compresses is bounded by that table's own `pressureFloorDays`, stated beside the
 * window it defends, and a table that declares no floor — a compliance window, a metered
 * period — is never compressed at all. The worst this can do at 100% pressure is apply
 * policy someone already wrote down.
 *
 * IT DOES NOT MAKE THE DATABASE SMALLER BY ITSELF. Deleting rows frees pages for reuse;
 * only the `VACUUM (FULL, ANALYZE)` at the end returns them, and on Neon the BILLED size
 * lags the logical one until the PITR window rolls past the old pages. So a sweep that
 * reports a large `freedMb` will still show a high ratio on the next tick, and that is
 * the storage system behaving normally, not the sweep failing.
 */
import { sql } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { buildDatabase, buildTransactionalDatabase, type Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { SWEPT_TABLES, type SweptConnection } from './sweptTables';
import { compressedWindow, runRetentionPurge } from './retentionPurge';
import { runBloatReclaim, runTableVacuum } from './tableMaintenance';

/**
 * The storage a single Neon branch may hold on the Free plan.
 *
 * The default rather than a required binding because it is the limit the platform is
 * actually deployed under, and a sweep that silently did nothing when a var was unset
 * would be worse than one tuned for the wrong plan — the failure it exists to catch is
 * exactly the one nobody is watching for. Override with `NEON_STORAGE_CEILING_BYTES`
 * after a plan change.
 */
export const DEFAULT_STORAGE_CEILING_BYTES = 512 * 1024 * 1024;

/** Ratio at which compression begins, and the pressure applied from there. */
export const PRESSURE_WARN_RATIO = 0.8;
/** Ratio at which every compressible window goes to its floor. */
export const PRESSURE_CRITICAL_RATIO = 0.9;

/** Both endpoints this platform maintains. The apps database is deliberately absent:
 *  it holds no swept log tables, so there is nothing here that could relieve it. */
const CONNECTIONS: readonly SweptConnection[] = ['primary', 'transactional'];

export type PressureTier = 'ok' | 'warn' | 'critical';

export interface EndpointStorage {
  connection: SweptConnection;
  databaseName: string | null;
  totalBytes: number;
  ceilingBytes: number;
  /** totalBytes / ceilingBytes. Can exceed 1 — a cap is enforced by the vendor, not by us. */
  ratio: number;
  tier: PressureTier;
  /** 0 at `ok`, 0.5 at `warn`, 1 at `critical` — what {@link compressedWindow} takes. */
  pressure: number;
  error?: string;
}

export interface StoragePressureResult {
  endpoints: EndpointStorage[];
  /** The highest pressure across the endpoints — what the purge pass ran at. */
  pressure: number;
  tier: PressureTier;
  /** Windows actually shortened this run, for the operator report. Empty at `ok`. */
  compressed: Array<{ relation: string; fromDays: number; toDays: number }>;
  /** Relations rewritten by the early reclaim, and the bytes it returned. */
  reclaimed: Array<{ relation: string; beforeBytes: number; afterBytes: number }>;
  failed: Array<{ target: string; error: string }>;
}

/** The plan ceiling for this deployment. Ignores a non-numeric or non-positive
 *  binding rather than dividing by it. */
export function storageCeilingBytes(env: Env): number {
  const raw = Number(env.NEON_STORAGE_CEILING_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STORAGE_CEILING_BYTES;
}

/** The tier a fill ratio falls in, and the pressure that tier applies. */
export function tierFor(ratio: number): { tier: PressureTier; pressure: number } {
  if (ratio >= PRESSURE_CRITICAL_RATIO) return { tier: 'critical', pressure: 1 };
  if (ratio >= PRESSURE_WARN_RATIO) return { tier: 'warn', pressure: 0.5 };
  return { tier: 'ok', pressure: 0 };
}

function dbFor(env: Env, connection: SweptConnection): Db {
  return connection === 'primary' ? buildDatabase(env) : buildTransactionalDatabase(env);
}

/**
 * Measure one endpoint's total size.
 *
 * `pg_database_size` and not a sum over `pg_total_relation_size`: the gap between them
 * is exactly the part a table-by-table view cannot see — indexes on system catalogs,
 * TOAST, and the free space a bloated relation is still holding — which on the case
 * that motivated this sweep was most of the difference between "our tables look fine"
 * and a console banner at 86.5%.
 *
 * Never throws: an unreachable endpoint is reported as an error row so the OTHER one is
 * still measured and still relieved.
 */
export async function measureEndpointStorage(env: Env, connection: SweptConnection): Promise<EndpointStorage> {
  const ceilingBytes = storageCeilingBytes(env);
  try {
    const [row] = (await dbFor(env, connection).execute(sql`
      SELECT current_database() AS "databaseName",
             pg_database_size(current_database())::bigint AS "totalBytes"
    `)).rows as Array<{ databaseName: string; totalBytes: number | string }>;
    const totalBytes = Number(row?.totalBytes ?? 0);
    const ratio = totalBytes / ceilingBytes;
    const { tier, pressure } = tierFor(ratio);
    return { connection, databaseName: row?.databaseName ?? null, totalBytes, ceilingBytes, ratio, tier, pressure };
  } catch (error) {
    return {
      connection,
      databaseName: null,
      totalBytes: 0,
      ceilingBytes,
      ratio: 0,
      tier: 'ok',
      pressure: 0,
      error: error instanceof Error ? error.message : 'storage measurement failed',
    };
  }
}

/** Every endpoint's fill ratio. The read half of this module, exported on its own so a
 *  superadmin surface can show the same number the sweep acts on rather than a second
 *  query that could disagree with it. */
export function measureStorage(env: Env): Promise<EndpointStorage[]> {
  return Promise.all(CONNECTIONS.map((connection) => measureEndpointStorage(env, connection)));
}

/** Which windows a given pressure actually shortens — the report, and the thing to read
 *  when asking what a run at this tier would delete BEFORE letting it. */
export function compressionPlan(pressure: number): Array<{ relation: string; fromDays: number; toDays: number }> {
  return SWEPT_TABLES
    .map((table) => ({ relation: table.relation, fromDays: table.retentionDays, toDays: compressedWindow(table, pressure) }))
    .filter((row) => row.toDays < row.fromDays);
}

/**
 * Measure, and relieve what the measurement found.
 *
 * ONE pressure for both endpoints — the highest — rather than a per-endpoint window,
 * because four of the swept relations physically exist on BOTH databases and a
 * per-endpoint window would purge the same table to two different depths depending on
 * which copy happened to be fuller. A single figure keeps the policy explicable: at this
 * tier, this table keeps this many days, everywhere.
 *
 * The three actions run in the order that makes each one worth doing: purge frees the
 * rows, `VACUUM (ANALYZE)` records the freed pages AND refreshes the statistics the
 * bloat estimate reads, and only then does the reclaim decide what to rewrite.
 */
export async function runStoragePressureSweep(env: Env, now: number = Date.now()): Promise<StoragePressureResult> {
  const endpoints = await measureStorage(env);
  const pressure = Math.max(0, ...endpoints.map((e) => e.pressure));
  const tier = endpoints.some((e) => e.tier === 'critical')
    ? 'critical'
    : endpoints.some((e) => e.tier === 'warn') ? 'warn' : 'ok';

  const result: StoragePressureResult = { endpoints, pressure, tier, compressed: [], reclaimed: [], failed: [] };
  for (const endpoint of endpoints) {
    if (endpoint.error) result.failed.push({ target: `measure:${endpoint.connection}`, error: endpoint.error });
  }
  if (pressure === 0) return result;

  result.compressed = compressionPlan(pressure);

  // Best-effort per stage, exactly as the sweeps it drives behave: a database that
  // refuses a vacuum must not cost us the purge that already succeeded.
  const stages: Array<{ name: string; run: () => Promise<unknown> }> = [
    { name: 'purge', run: () => runRetentionPurge(env, now, buildDatabase(env), { pressure }) },
    { name: 'vacuum', run: () => runTableVacuum(env) },
    {
      name: 'reclaim',
      run: async () => {
        const reclaim = await runBloatReclaim(env);
        result.reclaimed = reclaim.reclaimed;
        for (const f of reclaim.failed) result.failed.push({ target: `reclaim:${f.relation}`, error: f.error });
      },
    },
  ];
  for (const stage of stages) {
    try {
      await stage.run();
    } catch (error) {
      result.failed.push({ target: stage.name, error: error instanceof Error ? error.message : `${stage.name} failed` });
      reportCaughtError(error, {
        source: 'application/maintenance/storagePressure.ts',
        operation: 'runStoragePressureSweep',
        level: 'warning',
        context: { logMessage: `[cron:db-pressure] ${stage.name} failed at tier ${tier}`, details: { tier, pressure } },
      });
    }
  }
  return result;
}

/** `usage=primary 41% transactional 87% tier=warn compressed=6 freedMb=120` — the line
 *  the cron report prints. Null at `ok` with nothing failed, so a healthy database is
 *  silent in the operator log like every other quiet sweep. */
export function describeStoragePressure(result: StoragePressureResult): string | null {
  if (result.tier === 'ok' && result.failed.length === 0) return null;
  const usage = result.endpoints
    .map((e) => `${e.connection}=${e.error ? 'error' : `${Math.round(e.ratio * 100)}%`}`)
    .join(' ');
  const freed = result.reclaimed.reduce((sum, r) => sum + Math.max(0, r.beforeBytes - r.afterBytes), 0);
  return [
    `usage ${usage}`,
    `tier=${result.tier}`,
    result.compressed.length ? `compressed=${result.compressed.length}` : null,
    result.reclaimed.length ? `reclaimed=${result.reclaimed.map((r) => r.relation).join(',')} freedMb=${Math.round(freed / 1048576)}` : null,
    result.failed.length ? `failed=${result.failed.length}` : null,
  ].filter(Boolean).join(' ');
}
