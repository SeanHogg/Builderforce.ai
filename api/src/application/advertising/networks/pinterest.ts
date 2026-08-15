/**
 * Pinterest Ads.
 *
 * Pinterest's v5 write endpoints take an ARRAY as the whole request body — not an
 * object with an array in it. The manifest expresses that with `bodyPath: '$'`; this
 * adapter simply always sends one element, because a port whose `createCampaign` makes
 * one campaign is the contract every other network here honours.
 *
 * Money is micro-dollars, and the analytics column names are SHOUTED
 * (`SPEND_IN_MICRO_DOLLAR`) while the resource fields are not.
 */

import {
  ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO,
  unmapObjective, AdsProviderError,
  type AdInsightRow, type AdObjective, type AdsProvider, type AdStatus,
} from '../adsProviders';

const MICROS = 1_000_000;

const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'AWARENESS',
  engagement: 'CONSIDERATION',
  traffic: 'WEB_SESSIONS',
  conversions: 'WEB_CONVERSION',
  video_views: 'VIDEO_VIEW',
};

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
    case 'DRAFT': return 'draft';
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

export const pinterestAdsProvider: AdsProvider = {
  network: 'pinterest', label: 'Pinterest Ads', connectorKey: 'pinterest-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  accountFields: [{
    key: 'adAccountId', label: 'Ad account ID',
    help: 'The Pinterest ad account this connection spends on.',
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
    const rows = list((await ask(call, 'list_campaigns', { ad_account_id: accountId, page_size: 250 })).data).map(rec);
    return rows.map((c) => {
      const native = text(c.objective_type) || null;
      return {
        externalId: text(c.id),
        name: text(c.name),
        status: toStatus(c.status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: toCents(c.daily_spend_cap, MICROS),
        totalBudgetCents: toCents(c.lifetime_spend_cap, MICROS),
        currency: identity.currency,
        startsAtISO: toISO(c.start_time),
        endsAtISO: toISO(c.end_time),
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const objectiveType = mapObjective(pinterestAdsProvider, OBJECTIVES, draft.objective);
    const result = await ask(call, 'create_campaigns', {
      ad_account_id: accountId,
      campaigns: [{
        ad_account_id: accountId,
        name: draft.name,
        objective_type: objectiveType,
        status: fromStatus(draft.status) ?? 'PAUSED',
        ...(draft.dailyBudgetCents ? { daily_spend_cap: fromCents(draft.dailyBudgetCents, MICROS) } : {}),
        ...(draft.totalBudgetCents ? { lifetime_spend_cap: fromCents(draft.totalBudgetCents, MICROS) } : {}),
        // Pinterest schedules in epoch SECONDS.
        ...(draft.startsAtISO ? { start_time: Math.floor(Date.parse(draft.startsAtISO) / 1000) } : {}),
        ...(draft.endsAtISO ? { end_time: Math.floor(Date.parse(draft.endsAtISO) / 1000) } : {}),
      }],
    });
    // A batch endpoint reports per-item outcomes, so a 200 is not proof this item
    // succeeded — the created object has to be found in the response.
    const item = rec(list(result.data)[0]);
    const id = text(rec(item.data).id) || text(item.id);
    if (!id) {
      const reason = text(rec(item).exceptions ?? item.error) || 'Pinterest did not return the created campaign.';
      throw new AdsProviderError(reason.slice(0, 300), 502, false);
    }
    return {
      externalId: id,
      name: draft.name,
      status: draft.status ?? 'paused',
      nativeObjective: objectiveType,
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
    await ask(call, 'update_campaigns', {
      ad_account_id: accountId,
      campaigns: [{
        id: externalId,
        ad_account_id: accountId,
        ...(patch.name ? { name: patch.name } : {}),
        ...(status ? { status } : {}),
        ...(patch.dailyBudgetCents != null ? { daily_spend_cap: fromCents(patch.dailyBudgetCents, MICROS) } : {}),
        ...(patch.totalBudgetCents != null ? { lifetime_spend_cap: fromCents(patch.totalBudgetCents, MICROS) } : {}),
      }],
    });
  },

  async insights(call, fields, query, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    // Pinterest's campaign analytics endpoint REQUIRES the campaign ids — there is no
    // "all campaigns" form — so an unscoped query resolves them first.
    const ids = query.externalCampaignIds?.length
      ? [...query.externalCampaignIds]
      : (await pinterestAdsProvider.listCampaigns(call, fields, identity)).map((c) => c.externalId);
    if (ids.length === 0) return [];

    const result = await ask(call, 'get_analytics', {
      ad_account_id: accountId,
      campaign_ids: ids.join(','),
      start_date: query.since,
      end_date: query.until,
      columns: 'CAMPAIGN_ID,SPEND_IN_MICRO_DOLLAR,IMPRESSION_1,CLICKTHROUGH_1,TOTAL_CONVERSIONS',
      granularity: 'DAY',
    });
    return list(result.data).map(rec).flatMap((row) => {
      const externalCampaignId = text(row.CAMPAIGN_ID);
      const date = toDay(row.DATE);
      if (!externalCampaignId || !date) return [];
      return [{
        date,
        externalCampaignId,
        spendCents: toCents(row.SPEND_IN_MICRO_DOLLAR, MICROS) ?? 0,
        impressions: count(row.IMPRESSION_1),
        clicks: count(row.CLICKTHROUGH_1),
        conversions: count(row.TOTAL_CONVERSIONS),
        currency: identity.currency,
      } satisfies AdInsightRow];
    });
  },
};
