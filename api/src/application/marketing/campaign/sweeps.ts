/**
 * The cron sweeps — start what is due, then advance every in-flight campaign by
 * one batch. Split out of `../campaignEngine.ts`, which re-exports it.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { marketingCampaigns } from '../../../infrastructure/database/schema';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { resolveTrackingOrigin } from './render';
import { runCampaignBatch } from './send';
import { startCampaign } from './start';

/** Campaigns still mid-send, for the cron sweep to advance. Bounded. */
export async function campaignsInFlight(db: Db, limit = 10): Promise<Array<{ id: number; tenantId: number }>> {
  return db
    .select({ id: marketingCampaigns.id, tenantId: marketingCampaigns.tenantId })
    .from(marketingCampaigns)
    .where(eq(marketingCampaigns.status, 'sending'))
    .orderBy(asc(marketingCampaigns.startedAt))
    .limit(limit);
}

/**
 * Advance every in-flight campaign by one batch.
 *
 * A send larger than one batch cannot complete inside the request that started
 * it — a Worker invocation is bounded — so this is what actually finishes a
 * campaign. Oldest-started first, so a large send cannot be starved by newer
 * ones, and the whole sweep is capped so one tenant cannot consume the tick.
 */
export async function runCampaignSendSweep(
  env: Env,
  db: Db,
  opts: { maxCampaigns?: number; maxDue?: number } = {},
): Promise<{ campaigns: number; sent: number; failed: number; started: number }> {
  // Due-first, so a campaign scheduled for now begins on the SAME tick it became
  // due rather than waiting a second one.
  const started = await startDueCampaigns(env, db, opts.maxDue);
  const inFlight = await campaignsInFlight(db, opts.maxCampaigns ?? 5);
  const trackingOrigin = resolveTrackingOrigin(env);
  let sent = 0;
  let failed = 0;
  for (const campaign of inFlight) {
    const batch = await runCampaignBatch(env, db, campaign.tenantId, campaign.id, { trackingOrigin });
    sent += batch.sent;
    failed += batch.failed;
  }
  return { campaigns: inFlight.length, sent, failed, started: started.started };
}

// ---------------------------------------------------------------------------
// Scheduled sends
// ---------------------------------------------------------------------------

export interface DueSweepResult {
  /** Campaigns that moved from `draft` to `sending` on this tick. */
  started: number;
  /** Due campaigns that REFUSED to start, with the reason. Reported rather than
   *  swallowed: "it was scheduled and never went" with no explanation anywhere is
   *  the failure this whole path exists to avoid. */
  refused: Array<{ campaignId: number; tenantId: number; error: string }>;
}

/**
 * Start every campaign whose scheduled time has arrived.
 *
 * `marketing_campaigns.scheduled_at` shipped in 0412 and nothing ever read it:
 * the sweep only advanced campaigns already in `sending`, so a draft with a
 * future time silently never left. This is the step that was missing.
 *
 * It calls `startCampaign` rather than flipping the status itself, which is the
 * whole design. Every precondition — a resolvable sender, a body, a non-empty
 * audience, suppression applied — is re-checked AT THE MOMENT IT STARTS, not
 * when it was scheduled. A mailbox grant revoked between Friday and Tuesday, an
 * audience emptied, a sender identity that lapsed: each of those must stop the
 * send, and a sweep that only wrote `status = 'sending'` would have started it
 * anyway and discovered the problem one batch later, against a real audience.
 *
 * A refusal leaves the campaign in `draft` with its `scheduled_at` intact, so a
 * fixed precondition means it goes on the next tick with no re-scheduling.
 * Bounded per tick so one tenant's backlog cannot consume the sweep.
 */
export async function startDueCampaigns(env: Env, db: Db, limit = 5): Promise<DueSweepResult> {
  const due = await db
    .select({ id: marketingCampaigns.id, tenantId: marketingCampaigns.tenantId })
    .from(marketingCampaigns)
    .where(and(
      eq(marketingCampaigns.status, 'draft'),
      sql`${marketingCampaigns.scheduledAt} IS NOT NULL`,
      sql`${marketingCampaigns.scheduledAt} <= NOW()`,
    ))
    // Oldest scheduled time first: a campaign that has been due longest goes
    // first, so a backlog drains in the order it was promised.
    .orderBy(asc(marketingCampaigns.scheduledAt))
    .limit(Math.min(Math.max(1, limit), 25));

  let started = 0;
  const refused: DueSweepResult['refused'] = [];
  for (const campaign of due) {
    const result = await startCampaign(env, db, campaign.tenantId, campaign.id);
    if (result.ok) {
      started += 1;
      continue;
    }
    refused.push({ campaignId: campaign.id, tenantId: campaign.tenantId, error: result.error });
    reportCaughtError(new Error(result.error), {
      source: 'application/marketing/campaign/sweeps.ts',
      operation: `startDueCampaigns:${campaign.id}`,
    });
  }
  return { started, refused };
}
