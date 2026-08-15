/**
 * Pulling paid delivery back out of the networks and into `ad_campaigns` +
 * `ad_insights` — the ONE writer of both from a network's point of view.
 *
 * ── WHY A TRAILING WINDOW, NOT "YESTERDAY" ───────────────────────────────────
 * Every network RESTATES history. A conversion attributed three days after the click
 * changes what Tuesday cost per lead, and Meta, Google and TikTok all re-report a
 * trailing window for that reason. Syncing only the previous day would freeze each day
 * at its first, most incomplete reading — the numbers would be permanently low and
 * permanently wrong in the flattering direction.
 *
 * ── WHY REMOTE CAMPAIGNS ARE IMPORTED ────────────────────────────────────────
 * Insights arrive keyed by the NETWORK's campaign id, and most accounts have campaigns
 * created in the network's own console. Storing delivery only for campaigns Builderforce
 * happened to create would make the spend total silently exclude most of the spend,
 * which is worse than not reporting it. So a campaign seen on the network is upserted
 * locally first, and `ad_insights.campaign_id` is always a real row.
 *
 * ── IDEMPOTENCY ──────────────────────────────────────────────────────────────
 * Both writes are upserts against the natural key —
 * `(tenant, platform, external_id)` for a campaign, `(tenant, campaign, date)` for a
 * day. Re-running the sweep converges rather than accumulating. There is no
 * transaction because the Neon HTTP driver has none; the upserts are ordered so a
 * partial run leaves campaigns without their newest day, never days without a campaign.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { adCampaigns, adInsights } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  readAccountCampaignsLive, readAdInsights, resolveSpendableAccounts, type ResolvedAdAccount,
} from './adsService';
import { AdsProviderError, type AdCampaignRemote, type AdNetwork } from './adsProviders';

/**
 * How many days back each sweep re-reads.
 *
 * Seven is the widest restatement window the eight networks documented here actually
 * use; a longer window multiplies the cost of every sweep against a Neon-Free budget
 * for days that have stopped moving.
 */
export const AD_INSIGHT_RESTATEMENT_DAYS = 7;

export interface AdSyncResult {
  network: AdNetwork;
  connectionId: string;
  campaignsSeen: number;
  daysWritten: number;
  error?: string;
}

const dayString = (date: Date): string => date.toISOString().slice(0, 10);

/** The inclusive window a sweep re-reads, ending today. */
export function restatementWindow(now: Date, days = AD_INSIGHT_RESTATEMENT_DAYS): { since: string; until: string } {
  return {
    since: dayString(new Date(now.getTime() - days * 86_400_000)),
    until: dayString(now),
  };
}

/**
 * Upsert the campaigns this account reports, and return external id → local row id.
 *
 * The returned map is what lets insights be stored against a real FK. A campaign the
 * network reports but whose upsert failed is simply absent from it, so its days are
 * skipped rather than written against a guessed parent.
 */
async function importCampaigns(
  db: Db, tenantId: number, account: ResolvedAdAccount, campaigns: readonly AdCampaignRemote[],
): Promise<Map<string, number>> {
  const network = account.provider.network;
  const now = new Date();

  for (const campaign of campaigns) {
    if (!campaign.externalId) continue;
    await db
      .insert(adCampaigns)
      .values({
        tenantId,
        platform: network,
        externalId: campaign.externalId,
        name: campaign.name || campaign.externalId,
        objective: campaign.objective,
        nativeObjective: campaign.nativeObjective,
        dailyBudgetCents: campaign.dailyBudgetCents,
        totalBudgetCents: campaign.totalBudgetCents,
        currency: campaign.currency || 'USD',
        status: campaign.status,
        startsAt: campaign.startsAtISO ? new Date(campaign.startsAtISO) : null,
        endsAt: campaign.endsAtISO ? new Date(campaign.endsAtISO) : null,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [adCampaigns.tenantId, adCampaigns.platform, adCampaigns.externalId],
        set: {
          // The NETWORK is the source of truth for everything a network owns. A local
          // edit that was never pushed is not a fact about the campaign.
          name: campaign.name || campaign.externalId,
          objective: campaign.objective,
          nativeObjective: campaign.nativeObjective,
          dailyBudgetCents: campaign.dailyBudgetCents,
          totalBudgetCents: campaign.totalBudgetCents,
          currency: campaign.currency || 'USD',
          status: campaign.status,
          startsAt: campaign.startsAtISO ? new Date(campaign.startsAtISO) : null,
          endsAt: campaign.endsAtISO ? new Date(campaign.endsAtISO) : null,
          lastSyncedAt: now,
          updatedAt: now,
        },
      });
  }

  const externalIds = campaigns.map((c) => c.externalId).filter(Boolean);
  if (externalIds.length === 0) return new Map();

  // ONE query for the ids, after the upserts — not a returning clause per insert,
  // which would be one round trip per campaign on a driver with no pipelining.
  const rows = await db
    .select({ id: adCampaigns.id, externalId: adCampaigns.externalId })
    .from(adCampaigns)
    .where(scopedToTenant(
      adCampaigns,
      tenantId,
      and(eq(adCampaigns.platform, network), inArray(adCampaigns.externalId, externalIds)),
    ));

  return new Map(rows.flatMap((row) => (row.externalId ? [[row.externalId, row.id] as const] : [])));
}

/** Sync ONE connected ad account. Never throws — a failing account is reported. */
export async function syncAdAccount(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount, now = new Date(),
): Promise<AdSyncResult> {
  const network = account.provider.network;
  const base: AdSyncResult = { network, connectionId: account.row.id, campaignsSeen: 0, daysWritten: 0 };
  try {
    const campaigns = await readAccountCampaignsLive(db, env, tenantId, account);
    const idByExternal = await importCampaigns(db, tenantId, account, campaigns);

    const window = restatementWindow(now);
    const rows = await readAdInsights(db, env, tenantId, account, window);

    let daysWritten = 0;
    for (const row of rows) {
      const campaignId = idByExternal.get(row.externalCampaignId);
      // A day whose campaign is not in the map has no parent row to hang from —
      // storing it under a guessed id would attribute someone else's spend.
      if (!campaignId || !row.date) continue;
      await db
        .insert(adInsights)
        .values({
          tenantId,
          campaignId,
          platform: network,
          date: row.date,
          spendCents: row.spendCents,
          impressions: row.impressions,
          clicks: row.clicks,
          conversions: row.conversions,
          currency: row.currency || 'USD',
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [adInsights.tenantId, adInsights.campaignId, adInsights.date],
          set: {
            spendCents: row.spendCents,
            impressions: row.impressions,
            clicks: row.clicks,
            conversions: row.conversions,
            currency: row.currency || 'USD',
            syncedAt: now,
          },
        });
      daysWritten += 1;
    }

    return { ...base, campaignsSeen: campaigns.length, daysWritten };
  } catch (error) {
    const message = error instanceof AdsProviderError
      ? error.message
      : error instanceof Error ? error.message : 'That ad account could not be synced.';
    reportCaughtError(error, {
      source: 'application/advertising/adInsightsSync.ts',
      operation: `syncAdAccount:${network}`,
    });
    return { ...base, error: message };
  }
}

/** Sync every connected, ready ad account for one workspace. */
export async function syncTenantAdInsights(
  db: Db, env: Env, tenantId: number, now = new Date(),
): Promise<AdSyncResult[]> {
  const accounts = await resolveSpendableAccounts(db, env, tenantId);
  // Serial on purpose: each account is several upstream calls plus a write per day,
  // and a Worker has a bounded subrequest allowance that a fan-out over eight
  // networks would spend all at once.
  const results: AdSyncResult[] = [];
  for (const account of accounts) {
    results.push(await syncAdAccount(db, env, tenantId, account, now));
  }
  return results;
}
