/**
 * Composition — the usage ledger port the sync usage importer writes through
 * (PRD 36.4): the ONE canonical writer (`writeUsageRow`), which holds a synced row to
 * one per idempotency key with a unique index. The dedupe has to live there, not in the
 * sync transaction: `llm_usage_log` is in the usage database (`resolveUsageDatabase`),
 * not in the database the push's unit of work commits to.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { writeUsageRow } from '../llm/usageLedger';
import type { SyncUsageLedger } from './syncPorts';

export function syncUsageLedger(db: Db, env: Env): SyncUsageLedger {
  return {
    async record(row) {
      await writeUsageRow(db, env, row, { syncImport: true });
    },
  };
}
