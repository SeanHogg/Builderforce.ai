import { sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';

/**
 * boundedPurge — how the retention sweep deletes: in BOUNDED statements, sent in as few
 * neon-http round trips as the driver allows.
 *
 * WHY BOUNDED. A table that was never swept (a new registry entry, an endpoint that lost
 * its writer, a window shortened under storage pressure) can hold millions of expired
 * rows, and one unbounded DELETE over them is one huge transaction: minutes of WAL and
 * lock time on a small Neon compute, and a single failure that undoes all of it. Each
 * statement now deletes at most {@link PURGE_BATCH_ROWS}; the rest goes on the next run.
 *
 * WHY BATCHED. Each statement on neon-http is one HTTPS round trip; the registry holds
 * ~30 relations, most on two endpoints, so the purge was ~55 sequential trips. `db.batch`
 * sends one endpoint's whole set in ONE request.
 */

/**
 * Max rows one purge statement deletes. The retention pass runs daily; the busiest
 * relation measured (`tool_audit_events`) writes under ~11k rows/day, so 25k keeps any
 * table's steady state fully drained with >2x headroom, while a backlog drains by 25k a
 * day per table instead of in one statement. A full batch of every relation at this
 * bound is still a transaction the endpoint finishes in seconds.
 */
export const PURGE_BATCH_ROWS = 25_000;

/** One not-yet-executed statement `db.batch` accepts. */
export type PurgeStatement = Parameters<Db['batch']>[0][number];

/**
 * `DELETE FROM t WHERE ctid = ANY(ARRAY(SELECT ctid FROM t WHERE <expired> LIMIT n))`.
 * `ctid` (not `id`) because several swept relations — the daily rollups — have composite
 * keys; a tid lookup is the cheapest way back to the rows the subquery chose.
 * Returned UNEXECUTED so the caller can batch it.
 */
export function boundedDelete(db: Db, table: PgTable, expired: SQL): PurgeStatement {
  return db.delete(table).where(sql`ctid = any(array(select ctid from ${table} where ${expired} limit ${PURGE_BATCH_ROWS}))`);
}

export interface NamedPurge {
  name: string;
  statement: PurgeStatement;
}

/**
 * Run every purge for ONE endpoint in a single round trip. A neon-http batch is one
 * transaction, so one failing table would roll back all of them; on any batch error the
 * statements are re-sent one at a time so each table keeps its own best-effort isolation
 * (`onError` is told which ones failed). The per-table retry is safe: these are
 * idempotent deletes of rows past a window.
 */
export async function runPurgeBatch(db: Db, purges: NamedPurge[], onError: (name: string, error: unknown) => void): Promise<void> {
  if (purges.length === 0) return;
  const [first, ...rest] = purges.map((p) => p.statement);
  try {
    await db.batch([first!, ...rest]);
    return;
  } catch (batchError) {
    // Recorded once, then fall through to per-table: the batch error names no
    // table, the retries will (and a table that succeeds alone stays quiet).
    onError(`batch(${purges.length})`, batchError);
  }
  for (const p of purges) {
    try {
      await db.batch([p.statement]);
    } catch (error) {
      onError(p.name, error);
    }
  }
}
