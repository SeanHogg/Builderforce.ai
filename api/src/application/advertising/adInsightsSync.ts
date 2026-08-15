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

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { adCampaigns, adInsights, connectorConnections } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  readAccountCampaignsLive, readAdInsights, resolveSpendableAccounts, type ResolvedAdAccount,
} from './adsService';
import {
  ADS_CONNECTOR_KEYS, AdsProviderError, isAdNetwork, type AdCampaignRemote, type AdNetwork,
} from './adsProviders';

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

/**
 * The scheduled sweep: sync every workspace that has a connected ad account.
 *
 * DAILY rather than frequent, deliberately. Ad networks report on a daily grain and
 * restate for days afterwards, so a five-minute cadence would re-read the same
 * unchanged days ~288 times, spending upstream rate limit and Neon writes against a
 * budget that has to stay under $5/month — for numbers that cannot have moved.
 *
 * Tenants are discovered from the connections themselves rather than from a tenant
 * list: a workspace with no ad account is not work, and iterating every tenant to
 * discover that would be the expensive half of the sweep.
 */
export async function runAdInsightsSweep(
  env: Env, db: Db, now = new Date(),
): Promise<{ tenants: number; accounts: number; daysWritten: number; failed: number }> {
  const rows = await db
    .selectDistinct({ tenantId: connectorConnections.tenantId })
    .from(connectorConnections)
    .where(and(
      inArray(connectorConnections.connectorKey, [...ADS_CONNECTOR_KEYS]),
      eq(connectorConnections.enabled, true),
    ));

  let accounts = 0;
  let daysWritten = 0;
  let failed = 0;
  for (const row of rows) {
    // Serial across tenants for the same reason it is serial within one: a Worker has
    // a bounded subrequest allowance, and a fan-out would spend it in the first tenant.
    const results = await syncTenantAdInsights(db, env, row.tenantId, now);
    accounts += results.length;
    daysWritten += results.reduce((total, result) => total + result.daysWritten, 0);
    failed += results.filter((result) => result.error).length;
  }
  return { tenants: rows.length, accounts, daysWritten, failed };
}

/** One day of one campaign, as the ledger holds it plus the parent's identity. */
export interface AdInsightLedgerRow {
  date: string;
  platform: string;
  campaignId: number;
  campaignName: string;
  /** Null when the network never told us what the campaign was for. */
  objective: string | null;
  status: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
}

export interface AdInsightLedgerRead {
  window: { since: string; until: string };
  rows: AdInsightLedgerRow[];
  totals: {
    spendCents: number;
    impressions: number;
    clicks: number;
    conversions: number;
    /** Derived, never stored — a stored rate is a number its own inputs can
     *  contradict the moment a day is restated. Null rather than 0 when the
     *  denominator is 0, because "no clicks yet" is not "£0.00 per click". */
    costPerClickCents: number | null;
    costPerConversionCents: number | null;
    clickThroughRate: number | null;
  };
}

/**
 * Read the ad-spend LEDGER — what the sweep stored, not what the networks say now.
 *
 * ── WHY THIS IS AN APPLICATION USE CASE AND NOT A ROUTE HANDLER ──────────────
 * It was a handler: `presentation/routes/adsRoutes.ts` imported `adInsights`,
 * `adCampaigns` and `scopedToTenant` and assembled the join itself, which the
 * layering guard caught as the first new presentation→infrastructure import in
 * the frozen baseline. The rule it broke is not bookkeeping. A route that owns a
 * query owns the tenant scoping in it, and `scopedToTenant` applied in a
 * presentation file is a tenancy decision sitting where no other caller can reuse
 * it and no test that exercises the use case will cover it.
 *
 * Reading our own ledger rather than the networks is what makes the panel fast,
 * makes it work when a grant has expired, and makes the number on screen the same
 * number every other rollup sees.
 */
export async function readAdInsightsLedger(
  db: Db,
  tenantId: number,
  query: { since: string; until: string; networks?: readonly string[] },
): Promise<AdInsightLedgerRead> {
  const networks = (query.networks ?? []).filter(isAdNetwork);
  const withinWindow = and(gte(adInsights.date, query.since), lte(adInsights.date, query.until));
  const rows = await db
    .select({
      date: adInsights.date,
      platform: adInsights.platform,
      campaignId: adInsights.campaignId,
      campaignName: adCampaigns.name,
      objective: adCampaigns.objective,
      status: adCampaigns.status,
      spendCents: adInsights.spendCents,
      impressions: adInsights.impressions,
      clicks: adInsights.clicks,
      conversions: adInsights.conversions,
      currency: adInsights.currency,
    })
    .from(adInsights)
    // The campaign name lives on the parent; joining here is what lets ONE query
    // answer the whole panel instead of a lookup per row.
    .innerJoin(adCampaigns, eq(adCampaigns.id, adInsights.campaignId))
    .where(scopedToTenant(
      adInsights,
      tenantId,
      networks.length ? and(withinWindow, inArray(adInsights.platform, networks)) : withinWindow,
    ))
    .orderBy(desc(adInsights.date));

  const totals = rows.reduce(
    (acc, row) => ({
      spendCents: acc.spendCents + row.spendCents,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      conversions: acc.conversions + row.conversions,
    }),
    { spendCents: 0, impressions: 0, clicks: 0, conversions: 0 },
  );

  return {
    window: { since: query.since, until: query.until },
    rows,
    totals: {
      ...totals,
      costPerClickCents: totals.clicks > 0 ? Math.round(totals.spendCents / totals.clicks) : null,
      costPerConversionCents: totals.conversions > 0 ? Math.round(totals.spendCents / totals.conversions) : null,
      clickThroughRate: totals.impressions > 0 ? totals.clicks / totals.impressions : null,
    },
  };
}
