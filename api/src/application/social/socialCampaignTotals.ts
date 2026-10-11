/**
 * A campaign's counters and status, recomputed from its post ledger.
 *
 * Two writers settle a campaign: the publish batch (after it has worked through a
 * slice of queued posts) and an upload job (when a YouTube post's video finally lands
 * or fails, possibly hours later on a sweep). Both must arrive at the SAME answer from
 * the same rows, so the arithmetic lives here once rather than in each.
 *
 * Status rule:
 *   · anything still `queued` or `uploading` → `publishing` (it is still going out);
 *   · otherwise `published` when at least one post reached its network, else `failed`.
 * `completedAt` is stamped only when nothing is left in flight.
 */

import { eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { socialCampaignPosts, socialCampaigns } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { signalPendingWork } from '../runtime/cronWorkSignal';

export type SocialCampaignStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
/** `uploading` — handed to a background upload job (YouTube); settles when the job does. */
export type SocialPostStatus = 'queued' | 'uploading' | 'published' | 'pending' | 'failed' | 'skipped';

export interface SocialCampaignSettlement {
  status: SocialCampaignStatus;
  /** Posts still `queued` — what the publish batch has yet to attempt. */
  remaining: number;
  /** Posts handed to an upload job and not yet settled. */
  uploading: number;
  published: number;
  failed: number;
}

/** The campaign status a set of post counts implies. Pure — see the header rule. */
export function campaignStatusFor(counts: Record<string, number>): SocialCampaignStatus {
  const at = (status: SocialPostStatus) => counts[status] ?? 0;
  if (at('queued') > 0 || at('uploading') > 0) return 'publishing';
  return at('published') + at('pending') > 0 ? 'published' : 'failed';
}

export async function markSocialPost(
  db: Db, tenantId: number, id: number,
  patch: Partial<typeof socialCampaignPosts.$inferInsert>,
): Promise<void> {
  await db.update(socialCampaignPosts).set(patch)
    .where(scopedToTenant(socialCampaignPosts, tenantId, eq(socialCampaignPosts.id, id)));
}

/** Recount the ledger and write the campaign's counters and status. */
export async function settleSocialCampaign(db: Db, env: Env, tenantId: number, campaignId: number): Promise<SocialCampaignSettlement> {
  const totals = await db
    .select({ status: socialCampaignPosts.status, count: sql<number>`count(*)::int` })
    .from(socialCampaignPosts)
    .where(scopedToTenant(socialCampaignPosts, tenantId, eq(socialCampaignPosts.campaignId, campaignId)))
    .groupBy(socialCampaignPosts.status);
  const counts: Record<string, number> = {};
  for (const row of totals) counts[row.status] = row.count;
  const at = (status: SocialPostStatus) => counts[status] ?? 0;

  const settlement: SocialCampaignSettlement = {
    status: campaignStatusFor(counts),
    remaining: at('queued'),
    uploading: at('uploading'),
    published: at('published') + at('pending'),
    failed: at('failed'),
  };

  await db.update(socialCampaigns).set({
    status: settlement.status,
    published: settlement.published,
    failed: settlement.failed,
    updatedAt: new Date(),
    ...(settlement.status !== 'publishing' ? { completedAt: new Date() } : {}),
  }).where(scopedToTenant(socialCampaigns, tenantId, eq(socialCampaigns.id, campaignId)));

  // Anything left queued only finishes if the gated cron actually runs.
  if (settlement.remaining > 0) await signalPendingWork(env);
  return settlement;
}
