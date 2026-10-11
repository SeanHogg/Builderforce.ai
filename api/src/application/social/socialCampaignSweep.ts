/**
 * The `social-publish` cron sweep: which campaigns are due, and advancing each by one
 * batch. Split out of the campaign service so that service stays the campaign's
 * reads, writes and batch — the sweep is a scheduler concern over it.
 */

import { asc, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { socialCampaignPosts, socialCampaigns, youtubeUploads } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { runSocialCampaignBatch } from './socialCampaignService';

/**
 * Campaigns the sweep should advance: mid-publish, or scheduled and now due.
 *
 * A `publishing` campaign whose only open posts are `uploading` is NOT due: nothing in
 * the batch can move it, and its upload job settles it. One with nothing open at all
 * still is, so a campaign whose settle was lost to an eviction gets recounted — and so
 * is one holding an `uploading` post whose upload has already finished, so a lost
 * write-back is reconciled by the batch rather than read as "uploading" forever.
 */
export async function socialCampaignsDue(db: Db, limit = 5): Promise<Array<{ id: number; tenantId: number }>> {
  return db
    .select({ id: socialCampaigns.id, tenantId: socialCampaigns.tenantId })
    .from(socialCampaigns)
    .where(sql`(${socialCampaigns.status} = 'publishing' AND (
        EXISTS (SELECT 1 FROM ${socialCampaignPosts} p WHERE p.campaign_id = ${socialCampaigns.id} AND p.status = 'queued')
        OR NOT EXISTS (SELECT 1 FROM ${socialCampaignPosts} p WHERE p.campaign_id = ${socialCampaigns.id} AND p.status = 'uploading')
        OR EXISTS (
          SELECT 1 FROM ${socialCampaignPosts} p JOIN ${youtubeUploads} u ON u.campaign_post_id = p.id
          WHERE p.campaign_id = ${socialCampaigns.id} AND p.status = 'uploading' AND u.state IN ('succeeded', 'failed')
            AND NOT EXISTS (SELECT 1 FROM ${youtubeUploads} live WHERE live.campaign_post_id = p.id AND live.state IN ('queued', 'uploading'))
        )
      ))
      OR (${socialCampaigns.status} = 'scheduled' AND ${socialCampaigns.scheduledAt} IS NOT NULL AND ${socialCampaigns.scheduledAt} <= NOW())`)
    .orderBy(asc(socialCampaigns.scheduledAt), asc(socialCampaigns.id))
    .limit(limit);
}

/**
 * Advance every due social campaign by one batch.
 *
 * Without this, a `scheduled` campaign would sit forever and a campaign larger than
 * one batch would stop halfway — the same reason the email engine has a sweep.
 */
export async function runSocialCampaignSweep(
  env: Env, db: Db, opts: { maxCampaigns?: number } = {},
): Promise<{ campaigns: number; published: number; failed: number }> {
  const due = await socialCampaignsDue(db, opts.maxCampaigns ?? 5);
  let published = 0;
  let failed = 0;
  for (const campaign of due) {
    try {
      const batch = await runSocialCampaignBatch(db, env, campaign.tenantId, campaign.id, 'agent');
      published += batch.published;
      failed += batch.failed;
    } catch (error) {
      // One tenant's broken campaign must not stop the tick for everyone else.
      reportCaughtError(error, {
        source: 'application/social/socialCampaignSweep.ts',
        operation: 'runSocialCampaignSweep',
        context: { campaignId: campaign.id },
      });
    }
  }
  return { campaigns: due.length, published, failed };
}
