/**
 * "The method" funnel on builderforce.ai's own Insights site (PRD 33 §5.3.6).
 *
 * The four acts of the method — read the idea, choose a proof, build it, grade it —
 * are emitted by the app as `BFReplay.event(<act>)` from the realization client
 * (`frontend/src/lib/methodEvents.ts`). This seeds, on ONE site an operator names,
 * the four smart events (rule kind `custom`) and the funnel
 * `/ (prefix) → composer.submit → idea.read → proof.choose → proof.build → proof.grade`
 * with a 30-day window, so "where do people drop out of the method?" is a funnel
 * like any other. Seeded by an operator action, not a migration with a fixed uuid,
 * because the Builderforce workspace's site does not exist until someone creates it.
 *
 * Idempotent: smart events ride the `(site_id, name)` unique index; the funnel is
 * found by name first. A re-run creates nothing and says so.
 *
 * Only on a Builderforce site (D17): the site's workspace must be one the acting
 * superadmin is an active member of (`operatorWorkspaces.ts` — there is no platform
 * tenant id to compare against). The funnel and its steps are written in ONE
 * transaction (`inTransaction`), so a failed step insert never leaves a stepless
 * funnel that a re-run would then find by name and skip.
 */

import { and, eq } from 'drizzle-orm';
import type { ReplayMethodFunnelSeedDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import { inTransaction, type Db } from '../../infrastructure/database/connection';
import { replayFunnelSteps, replayFunnels, replaySmartEvents } from '../../infrastructure/database/schema';
import { writeAdminAudit } from '../../infrastructure/audit/adminAudit';
import { ForbiddenError, NotFoundError } from '../../domain/shared/errors';
import { bumpSiteVersion } from './replayCacheKeys';
import { getSite } from './replaySites';
import { operatorWorkspaceTenantIds } from './operatorWorkspaces';
import { FUNNEL_WINDOW_MAX_MINUTES } from './ReplayFunnelService';

export const METHOD_FUNNEL_NAME = 'The method';
/** 30 days — the longest window a funnel takes: the method is a month-long loop, not a session. */
export const METHOD_FUNNEL_WINDOW_MINUTES = FUNNEL_WINDOW_MAX_MINUTES;
export const METHOD_ACTS = ['idea.read', 'proof.choose', 'proof.build', 'proof.grade'] as const;

export const METHOD_FUNNEL_STEPS: ReadonlyArray<{ stepKind: 'page' | 'event'; match: string; matchMode: 'equals' | 'prefix' }> = [
  { stepKind: 'page', match: '/', matchMode: 'prefix' },
  { stepKind: 'event', match: 'composer.submit', matchMode: 'equals' },
  ...METHOD_ACTS.map((act) => ({ stepKind: 'event' as const, match: act, matchMode: 'equals' as const })),
];

export async function seedMethodFunnel(
  db: Db,
  env: Env,
  input: { siteId: string; actorId: string; ipAddress?: string | null },
): Promise<ReplayMethodFunnelSeedDto> {
  const site = await getSite(env, db, input.siteId);
  if (!site) throw new NotFoundError('Insights site', input.siteId);
  if (!(await operatorWorkspaceTenantIds(db, input.actorId)).includes(site.tenantId)) {
    throw new ForbiddenError('"The method" is seeded only on a site of a workspace you are a member of (the Builderforce workspace)');
  }

  const created = await db
    .insert(replaySmartEvents)
    .values(METHOD_ACTS.map((act) => ({ siteId: site.id, name: act, ruleKind: 'custom', match: act, matchMode: 'equals', createdBy: input.actorId })))
    .onConflictDoNothing()
    .returning({ name: replaySmartEvents.name });

  const { funnelId, createdFunnel } = await inTransaction(db, async (tx) => {
    const [existing] = await tx
      .select({ id: replayFunnels.id })
      .from(replayFunnels)
      .where(and(eq(replayFunnels.siteId, site.id), eq(replayFunnels.name, METHOD_FUNNEL_NAME)))
      .limit(1);
    if (existing) return { funnelId: existing.id, createdFunnel: false };
    const [row] = await tx
      .insert(replayFunnels)
      .values({ siteId: site.id, name: METHOD_FUNNEL_NAME, windowMinutes: METHOD_FUNNEL_WINDOW_MINUTES, createdBy: input.actorId })
      .returning({ id: replayFunnels.id });
    const id = row!.id;
    await tx.insert(replayFunnelSteps).values(METHOD_FUNNEL_STEPS.map((step, ord) => ({ funnelId: id, ord, ...step })));
    return { funnelId: id, createdFunnel: true };
  });

  const result: ReplayMethodFunnelSeedDto = {
    siteId: site.id,
    funnelId,
    createdSmartEvents: created.map((c) => c.name),
    createdFunnel,
  };
  if (result.createdFunnel || result.createdSmartEvents.length > 0) {
    await writeAdminAudit(db, 'REPLAY_METHOD_FUNNEL_SEEDED', input.actorId, {
      tenantId: site.tenantId,
      metadata: { ...result },
      ipAddress: input.ipAddress ?? null,
    });
    await bumpSiteVersion(env, site.id);
  }
  return result;
}
