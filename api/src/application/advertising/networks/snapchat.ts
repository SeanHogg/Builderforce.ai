/**
 * Snapchat Ads.
 *
 * Snap wraps every list element in a per-item envelope carrying its own
 * `sub_request_status` — `{"campaigns":[{"sub_request_status":"SUCCESS","campaign":{…}}]}`.
 * A batch write can therefore report HTTP 200 while the one item in it FAILED, which is
 * why `createCampaign` reads the item status rather than the response code.
 *
 * Money is micros of the account currency.
 */

import {
  ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO,
  unmapObjective, AdsProviderError,
  type AdInsightRow, type AdObjective, type AdsProvider, type AdStatus,
} from '../adsProviders';

const MICROS = 1_000_000;

const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'AWARENESS',
  traffic: 'TRAFFIC',
  engagement: 'ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  conversions: 'WEBSITE_CONVERSIONS',
  app_installs: 'APP_INSTALL',
  video_views: 'VIDEO_VIEW',
};

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
    case 'COMPLETED': return 'ended';
    case 'ARCHIVED': return 'archived';
    default: return 'draft';
  }
}

function fromStatus(status: AdStatus | undefined): string | undefined {
  if (status === 'active') return 'ACTIVE';
  if (status === 'paused' || status === 'draft') return 'PAUSED';
  if (status === 'archived' || status === 'ended') return 'ARCHIVED';
  return undefined;
}

/** Unwrap Snap's per-item envelope: `{sub_request_status, campaign: {…}}` → the object. */
const unwrapItem = (raw: unknown): Record<string, unknown> => {
  const entry = rec(raw);
  return rec(entry.campaign ?? entry);
};

export const snapchatAdsProvider: AdsProvider = {
  network: 'snapchat', label: 'Snapchat Ads', connectorKey: 'snapchat-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  accountFields: [{
    key: 'adAccountId', label: 'Ad account ID',
    help: 'The Snapchat ad account this connection spends on.',
  }],

  async identity(_call, fields) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    // Listing Snap ad accounts requires the ORGANIZATION id, which is not part of this
    // connection — so identity is taken from the connection rather than claimed from a
    // call that cannot be made with what the tenant supplied.
    return { externalId: accountId, name: `Ad account ${accountId}`, currency: 'USD' };
  },

  async listCampaigns(call, fields, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_campaigns', { ad_account_id: accountId, limit: 500 })).data).map(unwrapItem);
    return rows.map((c) => {
      const native = text(c.objective) || null;
      return {
        externalId: text(c.id),
        name: text(c.name),
        status: toStatus(c.status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: toCents(c.daily_budget_micro, MICROS),
        totalBudgetCents: toCents(c.lifetime_spend_cap_micro, MICROS),
        currency: identity.currency,
        startsAtISO: toISO(c.start_time),
        endsAtISO: toISO(c.end_time),
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const objective = mapObjective(snapchatAdsProvider, OBJECTIVES, draft.objective);
    const result = await ask(call, 'create_campaign', {
      ad_account_id: accountId,
      campaigns: [{
        ad_account_id: accountId,
        name: draft.name,
        objective,
        status: fromStatus(draft.status) ?? 'PAUSED',
        // Snap rejects a campaign with no start time.
        start_time: draft.startsAtISO ?? new Date().toISOString(),
        ...(draft.endsAtISO ? { end_time: draft.endsAtISO } : {}),
        ...(draft.dailyBudgetCents ? { daily_budget_micro: fromCents(draft.dailyBudgetCents, MICROS) } : {}),
        ...(draft.totalBudgetCents ? { lifetime_spend_cap_micro: fromCents(draft.totalBudgetCents, MICROS) } : {}),
      }],
    });

    const entry = rec(list(result.data)[0]);
    const created = unwrapItem(entry);
    const id = text(created.id);
    if (!id) {
      const reason = text(entry.sub_request_status) === 'ERROR'
        ? text(rec(entry.errors ?? {}).message) || 'Snapchat rejected the campaign.'
        : 'Snapchat accepted the request but did not return a campaign id.';
      throw new AdsProviderError(reason.slice(0, 300), 502, false);
    }
    return {
      externalId: id,
      name: draft.name,
      status: draft.status ?? 'paused',
      nativeObjective: objective,
      objective: draft.objective,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      totalBudgetCents: draft.totalBudgetCents ?? null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateCampaign(call, fields, externalId, patch) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const status = fromStatus(patch.status);
    await ask(call, 'update_campaign', {
      ad_account_id: accountId,
      campaigns: [{
        id: externalId,
        ad_account_id: accountId,
        ...(patch.name ? { name: patch.name } : {}),
        ...(status ? { status } : {}),
        ...(patch.dailyBudgetCents != null ? { daily_budget_micro: fromCents(patch.dailyBudgetCents, MICROS) } : {}),
        ...(patch.totalBudgetCents != null ? { lifetime_spend_cap_micro: fromCents(patch.totalBudgetCents, MICROS) } : {}),
      }],
    });
  },

  async insights(call, fields, query, identity) {
    // Snap's stats endpoint is PER CAMPAIGN — there is no account-wide daily report —
    // so an unscoped query resolves the campaigns and reads each one.
    const ids = query.externalCampaignIds?.length
      ? [...query.externalCampaignIds]
      : (await snapchatAdsProvider.listCampaigns(call, fields, identity)).map((c) => c.externalId);
    if (ids.length === 0) return [];

    const reads = await Promise.all(ids.map(async (externalCampaignId) => {
      const result = await ask(call, 'get_stats', {
        campaign_id: externalCampaignId,
        granularity: 'DAY',
        start_time: `${query.since}T00:00:00.000-00:00`,
        end_time: `${query.until}T00:00:00.000-00:00`,
        fields: 'spend,impressions,swipes,conversion_purchases',
      });
      // `resultPath: 'timeseries_stats'` leaves the per-item envelope array; the days
      // are one level further in, under `timeseries_stat.timeseries`.
      const stat = rec(rec(list(result.data)[0]).timeseries_stat);
      return list(stat.timeseries).map(rec).flatMap((point) => {
        const date = toDay(point.start_time);
        const stats = rec(point.stats);
        if (!date) return [];
        return [{
          date,
          externalCampaignId,
          spendCents: toCents(stats.spend, MICROS) ?? 0,
          impressions: count(stats.impressions),
          // Snap counts a "swipe up" where every other network counts a click.
          clicks: count(stats.swipes),
          conversions: count(stats.conversion_purchases),
          currency: identity.currency,
        } satisfies AdInsightRow];
      });
    }));
    return reads.flat();
  },
};
