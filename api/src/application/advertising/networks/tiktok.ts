/**
 * TikTok Ads.
 *
 * The network that answers 200 with a failure. Every response is
 * `{code, message, data, request_id}` and only `code: 0` means the call worked — an
 * expired token, a rejected budget and a malformed objective all arrive as HTTP 200.
 * That is why the ads manifest declares NO `resultPath`: the envelope has to reach this
 * adapter intact, because `data` on a failed call is `{}` and a caller reading it would
 * see "no campaigns" rather than "your token expired".
 *
 * Money is the MAJOR currency unit throughout — `budget: 50` is fifty dollars.
 */

import {
  AdsProviderError, ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, unmapObjective,
} from '../adsNormalize';
import {
  type AdCallResult, type AdInsightRow, type AdObjective, type AdStatus, type AdsProvider,
} from '../adsProviders';

const MAJOR = 1;

const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'REACH',
  traffic: 'TRAFFIC',
  engagement: 'ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  conversions: 'WEB_CONVERSIONS',
  app_installs: 'APP_PROMOTION',
  video_views: 'VIDEO_VIEWS',
};

/**
 * Unwrap TikTok's envelope, or throw with the reason TikTok actually gave.
 *
 * `40100` and the token family are permanent — retrying re-sends a credential the
 * network has already rejected. Rate limits and internal errors are worth another go.
 */
function unwrap(result: AdCallResult): Record<string, unknown> {
  const envelope = rec(result.data);
  const code = Number(envelope.code ?? 0);
  if (code !== 0) {
    const retryable = code === 40016 || code === 50000 || code >= 50000;
    throw new AdsProviderError(
      text(envelope.message) || `TikTok rejected the call (${code})`,
      retryable ? 429 : 400,
      retryable,
    );
  }
  return rec(envelope.data);
}

function toStatus(raw: unknown, secondary: unknown): AdStatus {
  const secondaryText = text(secondary).toUpperCase();
  if (secondaryText.includes('DELETE')) return 'archived';
  if (secondaryText.includes('CAMPAIGN_STATUS_END')) return 'ended';
  switch (text(raw).toUpperCase()) {
    case 'ENABLE': return 'active';
    case 'DISABLE': return 'paused';
    default: return 'draft';
  }
}

export const tiktokAdsProvider: AdsProvider = {
  network: 'tiktok', label: 'TikTok Ads', connectorKey: 'tiktok-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  accountFields: [{
    key: 'adAccountId', label: 'Advertiser ID',
    help: 'The TikTok advertiser account this connection spends on.',
  }],

  async identity(_call, fields) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    // `oauth2/advertiser/get` needs the APP id and secret, which are the developer's
    // credentials rather than the tenant's — so identity is taken from the connection
    // instead of pretending to verify it with a call that cannot be made here.
    return { externalId: advertiserId, name: `Advertiser ${advertiserId}`, currency: 'USD' };
  },

  async listCampaigns(call, fields, identity) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const data = unwrap(await ask(call, 'list_campaigns', { advertiser_id: advertiserId, page_size: 1000 }));
    return list(data.list).map(rec).map((c) => {
      const native = text(c.objective_type) || null;
      return {
        externalId: text(c.campaign_id),
        name: text(c.campaign_name),
        status: toStatus(c.operation_status, c.secondary_status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        // TikTok reports ONE budget field whose meaning is set by `budget_mode`.
        dailyBudgetCents: text(c.budget_mode) === 'BUDGET_MODE_DAY' ? toCents(c.budget, MAJOR) : null,
        totalBudgetCents: text(c.budget_mode) === 'BUDGET_MODE_TOTAL' ? toCents(c.budget, MAJOR) : null,
        currency: identity.currency,
        startsAtISO: null,
        endsAtISO: null,
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const daily = fromCents(draft.dailyBudgetCents, MAJOR);
    const total = fromCents(draft.totalBudgetCents, MAJOR);
    const budget = daily ?? total;
    const data = unwrap(await ask(call, 'create_campaign', {
      advertiser_id: advertiserId,
      campaign_name: draft.name,
      objective_type: mapObjective(tiktokAdsProvider, OBJECTIVES, draft.objective),
      operation_status: draft.status === 'active' ? 'ENABLE' : 'DISABLE',
      ...(budget
        ? { budget, budget_mode: daily ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL' }
        : { budget_mode: 'BUDGET_MODE_INFINITE' }),
    }));
    const id = text(data.campaign_id);
    if (!id) throw new AdsProviderError('TikTok accepted the campaign but did not return its id.', 502, true);
    return {
      externalId: id,
      name: draft.name,
      status: draft.status ?? 'paused',
      nativeObjective: OBJECTIVES[draft.objective] ?? null,
      objective: draft.objective,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      totalBudgetCents: draft.totalBudgetCents ?? null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateCampaign(call, fields, externalId, patch) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const daily = fromCents(patch.dailyBudgetCents, MAJOR);
    const total = fromCents(patch.totalBudgetCents, MAJOR);
    const budget = daily ?? total;
    if (patch.name || budget) {
      unwrap(await ask(call, 'update_campaign', {
        advertiser_id: advertiserId,
        campaign_id: externalId,
        ...(patch.name ? { campaign_name: patch.name } : {}),
        ...(budget ? { budget, budget_mode: daily ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL' } : {}),
      }));
    }
    // Status is its OWN endpoint on TikTok — sending it to `campaign/update` is
    // accepted and ignored.
    if (patch.status) {
      const operation = patch.status === 'active' ? 'ENABLE' : patch.status === 'archived' ? 'DELETE' : 'DISABLE';
      unwrap(await ask(call, 'update_campaign_status', {
        advertiser_id: advertiserId, campaign_ids: [externalId], operation_status: operation,
      }));
    }
  },

  async insights(call, fields, query, identity) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const data = unwrap(await ask(call, 'get_report', {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
      start_date: query.since,
      end_date: query.until,
      page_size: 1000,
    }));
    return list(data.list).map(rec).flatMap((row) => {
      const dimensions = rec(row.dimensions);
      const metrics = rec(row.metrics);
      const externalCampaignId = text(dimensions.campaign_id);
      const date = toDay(dimensions.stat_time_day);
      if (!externalCampaignId || !date) return [];
      return [{
        date,
        externalCampaignId,
        spendCents: toCents(metrics.spend, MAJOR) ?? 0,
        impressions: count(metrics.impressions),
        clicks: count(metrics.clicks),
        conversions: count(metrics.conversion),
        currency: identity.currency,
      } satisfies AdInsightRow];
    });
  },
};
