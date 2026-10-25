/**
 * Composition — the usage ledger port the sync usage importer writes through
 * (PRD 36.4). The write is the ONE canonical writer (`recordUsageRow`); the
 * existence read is the retry dedupe the sync transaction cannot provide, because
 * `llm_usage_log` lives in the usage database (`resolveUsageDatabase`), not in the
 * database the push's unit of work commits to.
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { recordUsageRow, resolveUsageDatabase } from '../llm/usageLedger';
import type { SyncUsageLedger } from './syncPorts';

export function syncUsageLedger(db: Db, env: Env): SyncUsageLedger {
  return {
    async hasRow(tenantId, idempotencyKey) {
      const [row] = await resolveUsageDatabase(env, db)
        .select({ id: llmUsageLog.id })
        .from(llmUsageLog)
        .where(and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.idempotencyKey, idempotencyKey)))
        .limit(1);
      return !!row;
    },
    record: (row) => recordUsageRow(db, env, row),
  };
}
