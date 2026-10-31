/**
 * The cron sweeps — start what is due, then advance every in-flight campaign by
 * one batch. Split out of `../campaignEngine.ts`, which re-exports it.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import { marketingCampaignSends, marketingCampaigns } from '../../../infrastructure/database/schema';
import { dueStatuses, statusesIn } from '../../shared/campaignLifecycle';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { resolveTrackingOrigin } from './render';
import { runCampaignBatch, STALE_CLAIM_AFTER_MS, STALE_CLAIM_ERROR } from './send';
import { startCampaign } from './start';

/** Campaigns still mid-send, for the cron sweep to advance. Bounded. */
export async function campaignsInFlight(db: Db, limit = 10): Promise<Array<{ id: number; tenantId: number }>> {
  return db
    .select({ id: marketingCampaigns.id, tenantId: marketingCampaigns.tenantId })
    .from(marketingCampaigns)
    .where(inArray(marketingCampaigns.status, statusesIn('email', 'in_flight')))
    .orderBy(asc(marketingCampaigns.startedAt))
    .limit(limit);
}

/**
 * Write off recipients a dead runner left in `sending`, so the campaign can finish.
 *
 * A row is claimed (`queued` → `sending`) before its message goes out and settled after.
 * A Worker evicted between the two leaves it `sending` for good: the campaign's outstanding
 * count never reaches zero, so it is advanced on every tick and never completes. A row that
 * has been `sending` for longer than {@link STALE_CLAIM_AFTER_MS} — or has no claim time at
 * all, because it was claimed before `claimed_at` existed — is moved to `failed`, NOT back to
 * `queued`: the transport call may have succeeded before the runner died, and a second send
 * could deliver the same message twice. Counted in the campaign's `failed` total, so the
 * report agrees with the ledger.
 *
 * Scoped to one campaign so it is served by `idx_marketing_sends_campaign_status`
 * (campaign_id, status) rather than a scan of every send.
 */
export async function reapStaleClaims(db: Db, tenantId: number, campaignId: number): Promise<number> {
  const reaped = await db
    .update(marketingCampaignSends)
    .set({ status: 'failed', error: STALE_CLAIM_ERROR })
    .where(and(
      eq(marketingCampaignSends.campaignId, campaignId),
      eq(marketingCampaignSends.tenantId, tenantId),
      eq(marketingCampaignSends.status, 'sending'),
      sql`(${marketingCampaignSends.claimedAt} IS NULL
        OR ${marketingCampaignSends.claimedAt} < NOW() - (${STALE_CLAIM_AFTER_MS / 1000}::float8 * INTERVAL '1 second'))`,
    ))
    .returning({ id: marketingCampaignSends.id });
  if (reaped.length > 0) {
    await db
      .update(marketingCampaigns)
      .set({ failed: sql`${marketingCampaigns.failed} + ${reaped.length}`, updatedAt: sql`NOW()` })
      .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)));
  }
  return reaped.length;
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
    // Before the batch, so a campaign whose only outstanding rows are dead claims completes
    // on this tick instead of the next.
    await reapStaleClaims(db, campaign.tenantId, campaign.id);
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
 * fixed precondition means it goes on the next tick with no re-scheduling. It also
 * stamps `schedule_refused_at`, and the read below puts never-refused campaigns first:
 * a refused draft stays due for as long as nobody fixes it, so without that order five
 * of them would fill the per-tick limit and every other scheduled send would wait behind
 * them. Refused campaigns still retry — after the ones that have not been refused, the
 * least recently refused first. Editing or starting a campaign clears the stamp.
 * Bounded per tick so one tenant's backlog cannot consume the sweep.
 */
export async function startDueCampaigns(env: Env, db: Db, limit = 5): Promise<DueSweepResult> {
  const due = await db
    .select({ id: marketingCampaigns.id, tenantId: marketingCampaigns.tenantId })
    .from(marketingCampaigns)
    .where(and(
      inArray(marketingCampaigns.status, dueStatuses('email')),
      sql`${marketingCampaigns.scheduledAt} IS NOT NULL`,
      sql`${marketingCampaigns.scheduledAt} <= NOW()`,
    ))
    // Never-refused campaigns first (NULL sorts first ascending), so a pile of refused
    // drafts cannot starve them; then oldest scheduled time first: a campaign that has
    // been due longest goes first, so a backlog drains in the order it was promised.
    // Among refused ones the least recently refused goes first — a round-robin, since a
    // fresh refusal moves the campaign to the back.
    .orderBy(sql`${marketingCampaigns.scheduleRefusedAt} ASC NULLS FIRST`, asc(marketingCampaigns.scheduledAt))
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
    await db
      .update(marketingCampaigns)
      .set({ scheduleRefusedAt: sql`NOW()` })
      .where(and(eq(marketingCampaigns.id, campaign.id), eq(marketingCampaigns.tenantId, campaign.tenantId)));
    reportCaughtError(new Error(result.error), {
      source: 'application/marketing/campaign/sweeps.ts',
      operation: `startDueCampaigns:${campaign.id}`,
    });
  }
  return { started, refused };
}
