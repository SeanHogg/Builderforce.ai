import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Retention purge — daily deletion of rows from append-only diagnostic/telemetry
 * tables that would otherwise grow unbounded. Run from the daily cron tick
 * (scheduled() in index.ts), mirroring the vendor-health cron.
 *
 * WHICH tables and HOW LONG each keeps is not decided here: it is the shared
 * {@link SWEPT_TABLES} registry, because the vacuum sweep that reclaims the space
 * these deletes free has to act on exactly the same set. Add a new unbounded log
 * table THERE — one place, one policy (DRY).
 *
 * Every table in that registry is a diagnostic/event log (no business records), so
 * deletion is safe and never cascades to domain data. The one purge that is not
 * age-based lives at the bottom of this file.
 */
import { buildDatabase, buildTransactionalDatabase, type Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { SWEPT_TABLES } from './sweptTables';
import { purgeExpiredMemories } from '../memory/memoryService';

const DAY_MS = 24 * 60 * 60 * 1000;
const cutoff = (now: number, days: number) => new Date(now - days * DAY_MS);

/**
 * Delete expired rows from every unbounded log table. Best-effort per table — a
 * failure on one is logged and does not block the others. `now` is injectable for
 * tests; defaults to the cron's wall clock.
 */
export async function runRetentionPurge(env: Env, now: number = Date.now()): Promise<void> {
  const db = buildDatabase(env);
  const transactionalDb = buildTransactionalDatabase(env);
  const dbFor = (connection: 'primary' | 'transactional'): Db => (connection === 'primary' ? db : transactionalDb);

  const targets: Array<{ name: string; run: () => Promise<unknown> }> = [
    ...SWEPT_TABLES.map((table) => ({
      name: table.relation,
      run: () => table.purge(dbFor(table.connection), cutoff(now, table.retentionDays)),
    })),
    // Lapsed agent memories (0371). NOT an age-based purge like the rest, and
    // deliberately NOT in SWEPT_TABLES: a fact expires when its own author said it
    // would, so the policy lives on the row, this only reclaims what recall already
    // stopped returning, and the relations behind it are domain data no maintenance
    // sweep may rewrite.
    { name: 'expired_memories', run: () => purgeExpiredMemories(env, db) },
  ];

  for (const t of targets) {
    try {
      await t.run();
    } catch (err) {
      reportCaughtError(err, { source: "application/maintenance/retentionPurge.ts", operation: "runRetentionPurge", context: { logMessage: `[cron:retention] purge ${t.name} failed`, details: err } });
    }
  }
}
