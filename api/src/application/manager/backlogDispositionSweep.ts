/**
 * backlogDispositionSweep — the scheduled entry for PRD 23's backlog pass. DRY-RUN ONLY:
 * it refreshes the pending `ticket_dispositions` proposals for every workspace that has a
 * manager config and never calls the apply step (that is superadmin-triggered, see
 * `presentation/routes/backlogDispositionRoutes.ts`).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projectManagerConfigs } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { runBacklogDispositionPass } from './backlogDispositionPass';

/** Workspaces refreshed per tick; the rest are picked up on the next daily run order. */
const MAX_TENANTS_PER_TICK = 50;

export interface BacklogSweepResult { tenants: number; considered: number; written: number }

export async function runBacklogDispositionSweep(db: Db): Promise<BacklogSweepResult> {
  const out: BacklogSweepResult = { tenants: 0, considered: 0, written: 0 };
  const tenants = await db.selectDistinct({ tenantId: projectManagerConfigs.tenantId }).from(projectManagerConfigs)
    .orderBy(sql`${projectManagerConfigs.tenantId}`).limit(MAX_TENANTS_PER_TICK);
  for (const { tenantId } of tenants) {
    try {
      const r = await runBacklogDispositionPass(db, { tenantId });
      out.tenants++;
      out.considered += r.considered;
      out.written += r.written;
    } catch (error) {
      reportCaughtError(error, { source: 'application/manager/backlogDispositionSweep.ts', operation: 'runBacklogDispositionSweep', context: { tenantId } });
    }
  }
  return out;
}
