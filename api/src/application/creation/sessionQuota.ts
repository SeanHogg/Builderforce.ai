/**
 * "May this workspace save one more canvas board?" — THE saved-board plan check.
 *
 * `POST /claim`, `POST /` and the sync importer for a new board
 * (`creation/sync/importSyncedCanvasBoard.ts`) all ask this exact question, and a plan
 * limit that is decided in three places is a limit that three paths disagree about. The
 * policy itself (`resolveCreationSessionQuota`, platform superadmins unlimited) lives in
 * the domain; this is the read that feeds it.
 */

import { and, eq, ne, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessions } from '../../infrastructure/database/schema';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { getLimits } from '../../domain/tenant/PlanLimits';
import { resolveCreationSessionQuota, type CreationSessionQuota } from '../../domain/tenant/creationSessionQuota';
import { resolveTenantEffectivePlan } from '../tenant/tenantPlanSnapshot';

export async function creationSessionQuota(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string },
): Promise<CreationSessionQuota> {
  const currentPlan = await resolveTenantEffectivePlan(env, input.tenantId, db);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creationSessions)
    .where(and(eq(creationSessions.tenantId, input.tenantId), ne(creationSessions.status, 'deleted')));
  return resolveCreationSessionQuota({
    used: Number(row?.count ?? 0),
    planLimit: getLimits(currentPlan).maxCreationSessions,
    currentPlan,
    isSuperadmin: await resolveIsSuperadmin(env, input.userId),
  });
}
