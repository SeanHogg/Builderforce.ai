/**
 * Reddit Ads.
 *
 * A Reddit CAMPAIGN carries a lifetime spend cap and an objective; the daily budget and
 * the schedule live on the AD GROUP beneath it. So `dailyBudgetCents` is read from the
 * campaign's ad groups rather than reported as null — a campaign whose ad group spends
 * $50/day is not a campaign with no daily budget.
 *
 * Money is micros of the account currency.
 */

import {
  AdsProviderError, ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO, unmapObjective,
} from '../adsNormalize';
import {
  type AdInsightRow, type AdObjective, type AdStatus, type AdsProvider,
} from '../adsProviders';

const MICROS = 1_000_000;

const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'IMPRESSIONS',
  traffic: 'TRAFFIC',
  conversions: 'CONVERSIONS',
  app_installs: 'APP_INSTALLS',
  video_views: 'VIDEO_VIEWABLE_IMPRESSIONS',
};

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
    case 'DRAFT': return 'draft';
    case 'COMPLETED': return 'ended';
    case 'ARCHIVED': case 'DELETED': return 'archived';
    default: return 'draft';
  }
}

function fromStatus(status: AdStatus | undefined): string | undefined {
  if (status === 'active') return 'ACTIVE';
  if (status === 'paused' || status === 'draft') return 'PAUSED';
  if (status === 'archived' || status === 'ended') return 'ARCHIVED';
  return undefined;
}

export const redditAdsProvider: AdsProvider = {
  network: 'reddit', label: 'Reddit Ads', connectorKey: 'reddit-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  accountFields: [{
    key: 'adAccountId', label: 'Ad account ID',
    help: 'The Reddit ad account this connection spends on.',
  }],

  async identity(call, fields) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const accounts = list((await ask(call, 'list_ad_accounts', { page_size: 100 })).data).map(rec);
    const match = accounts.find((a) => text(a.id) === accountId);
    return {
      externalId: accountId,
      name: match ? text(match.name) || accountId : accountId,
      currency: match ? text(match.currency) || 'USD' : 'USD',
    };
  },

  async listCampaigns(call, fields, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const campaigns = list((await ask(call, 'list_campaigns', { ad_account_id: accountId, page_size: 200 })).data).map(rec);
    if (campaigns.length === 0) return [];

    // ONE call for every ad group, grouped in memory — the daily budget lives there,
    // and a request per campaign would be an N+1 across the whole account.
    const adGroups = list((await ask(call, 'list_ad_groups', { ad_account_id: accountId, page_size: 500 })).data).map(rec);
    const dailyByCampaign = new Map<string, number>();
    const scheduleByCampaign = new Map<string, { start: string | null; end: string | null }>();
    for (const group of adGroups) {
      const campaignId = text(group.campaign_id);
      if (!campaignId) continue;
      if (text(group.goal_type).toUpperCase() === 'DAILY_SPEND') {
        const cents = toCents(group.goal_value, MICROS);
        // Several ad groups under one campaign each carry their own daily spend, and
        // the campaign's daily rate is their SUM, not the first one seen.
        if (cents != null) dailyByCampaign.set(campaignId, (dailyByCampaign.get(campaignId) ?? 0) + cents);
      }
      if (!scheduleByCampaign.has(campaignId)) {
        scheduleByCampaign.set(campaignId, { start: toISO(group.start_time), end: toISO(group.end_time) });
      }
    }

    return campaigns.map((c) => {
      const id = text(c.id);
      const native = text(c.objective) || null;
      const schedule = scheduleByCampaign.get(id);
      return {
        externalId: id,
        name: text(c.name),
        status: toStatus(c.configured_status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: dailyByCampaign.get(id) ?? null,
        totalBudgetCents: toCents(c.spend_cap, MICROS),
        currency: identity.currency,
        startsAtISO: schedule?.start ?? null,
        endsAtISO: schedule?.end ?? null,
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const objective = mapObjective(redditAdsProvider, OBJECTIVES, draft.objective);
    const created = rec((await ask(call, 'create_campaign', {
      ad_account_id: accountId,
      name: draft.name,
      objective,
      configured_status: fromStatus(draft.status) ?? 'PAUSED',
      ...(draft.totalBudgetCents ? { spend_cap: fromCents(draft.totalBudgetCents, MICROS) } : {}),
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('Reddit accepted the campaign but did not return its id.', 502, true);

    // A Reddit campaign carries no daily budget of its own, so the requested daily
    // rate becomes an ad group — otherwise "$50/day" would be silently dropped.
    if (draft.dailyBudgetCents) {
      await ask(call, 'create_ad_group', {
        ad_account_id: accountId,
        campaign_id: id,
        name: `${draft.name} ad group`,
        configured_status: fromStatus(draft.status) ?? 'PAUSED',
        bid_strategy: 'MAXIMIZE_VOLUME',
        goal_type: 'DAILY_SPEND',
        goal_value: fromCents(draft.dailyBudgetCents, MICROS),
        ...(draft.startsAtISO ? { start_time: draft.startsAtISO } : {}),
        ...(draft.endsAtISO ? { end_time: draft.endsAtISO } : {}),
      });
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
    const configured = fromStatus(patch.status);
    await ask(call, 'update_campaign', {
      ad_account_id: accountId,
      campaign_id: externalId,
      ...(patch.name ? { name: patch.name } : {}),
      ...(configured ? { configured_status: configured } : {}),
      ...(patch.totalBudgetCents != null ? { spend_cap: fromCents(patch.totalBudgetCents, MICROS) } : {}),
    });
  },

  async insights(call, fields, query, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const result = await ask(call, 'get_report', {
      ad_account_id: accountId,
      data: 'CAMPAIGN',
      breakdowns: ['DATE'],
      fields: ['spend', 'impressions', 'clicks', 'conversion_signup_total_items', 'campaign_id', 'date'],
      starts_at: `${query.since}T00:00:00Z`,
      ends_at: `${query.until}T23:59:59Z`,
      time_zone_id: 'UTC',
    });
    return list(rec(result.data).metrics ?? result.data).map(rec).flatMap((row) => {
      const externalCampaignId = text(row.campaign_id);
      const date = toDay(row.date);
      if (!externalCampaignId || !date) return [];
      return [{
        date,
        externalCampaignId,
        spendCents: toCents(row.spend, MICROS) ?? 0,
        impressions: count(row.impressions),
        clicks: count(row.clicks),
        conversions: count(row.conversion_signup_total_items),
        currency: identity.currency,
      } satisfies AdInsightRow];
    });
  },
};
