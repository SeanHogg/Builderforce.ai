/**
 * X Ads.
 *
 * The structural surprise here: an X CAMPAIGN HAS NO OBJECTIVE. A campaign is a budget
 * and a schedule; what you are buying is declared on the LINE ITEM beneath it. So
 * `createCampaign` genuinely creates two objects, and `listCampaigns` reads the
 * objective back from the campaign's first line item rather than inventing one.
 *
 * A campaign also cannot exist without a FUNDING INSTRUMENT — X's stored payment
 * method. That call is also the only place the account currency is reported, so
 * identity and funding are resolved together.
 *
 * Money is micros of the account currency.
 */

import {
  AdsProviderError, ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO, unmapObjective,
} from '../adsNormalize';
import {
  type AdCall, type AdInsightRow, type AdObjective, type AdStatus, type AdsProvider,
} from '../adsProviders';

const MICROS = 1_000_000;

const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'REACH',
  traffic: 'WEBSITE_CLICKS',
  engagement: 'ENGAGEMENTS',
  video_views: 'VIDEO_VIEWS',
  app_installs: 'APP_INSTALLS',
  conversions: 'WEBSITE_CONVERSIONS',
};

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
    case 'DRAFT': return 'draft';
    case 'EXPIRED': return 'ended';
    case 'DELETED': case 'ARCHIVED': return 'archived';
    default: return 'draft';
  }
}

function fromStatus(status: AdStatus | undefined): string | undefined {
  if (status === 'active') return 'ACTIVE';
  if (status === 'paused' || status === 'draft') return 'PAUSED';
  if (status === 'archived' || status === 'ended') return 'DELETED';
  return undefined;
}

/** The account's first usable funding instrument, and the currency it bills in. */
async function funding(call: AdCall, accountId: string): Promise<{ id: string; currency: string }> {
  const instruments = list((await ask(call, 'list_funding_instruments', { account_id: accountId, count: 50 })).data).map(rec);
  const usable = instruments.find((i) => !i.deleted && i.able_to_fund !== false) ?? instruments[0];
  return {
    id: usable ? text(usable.id) : '',
    currency: usable ? text(usable.currency) || 'USD' : 'USD',
  };
}

export const xAdsProvider: AdsProvider = {
  network: 'x', label: 'X Ads', connectorKey: 'x-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  accountFields: [{
    key: 'adAccountId', label: 'Ads account ID',
    help: 'The X ads account this connection spends on.',
  }],

  async identity(call, fields) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const accounts = list((await ask(call, 'list_accounts', { count: 200 })).data).map(rec);
    const match = accounts.find((a) => text(a.id) === accountId);
    const { currency } = await funding(call, accountId);
    return {
      externalId: accountId,
      name: match ? text(match.name) || accountId : accountId,
      currency,
    };
  },

  async listCampaigns(call, fields, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const campaigns = list((await ask(call, 'list_campaigns', { account_id: accountId, count: 200 })).data).map(rec);
    if (campaigns.length === 0) return [];

    // ONE call for every line item on the account, then grouped in memory — the
    // alternative is one request per campaign, which is the N+1 this codebase forbids.
    const lineItems = list((await ask(call, 'list_line_items', { account_id: accountId, count: 1000 })).data).map(rec);
    const objectiveByCampaign = new Map<string, string>();
    for (const item of lineItems) {
      const campaignId = text(item.campaign_id);
      const objective = text(item.objective);
      if (campaignId && objective && !objectiveByCampaign.has(campaignId)) objectiveByCampaign.set(campaignId, objective);
    }

    return campaigns.map((c) => {
      const id = text(c.id);
      const native = objectiveByCampaign.get(id) ?? null;
      return {
        externalId: id,
        name: text(c.name),
        status: toStatus(c.entity_status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: toCents(c.daily_budget_amount_local_micro, MICROS),
        totalBudgetCents: toCents(c.total_budget_amount_local_micro, MICROS),
        currency: identity.currency,
        startsAtISO: toISO(c.start_time),
        endsAtISO: toISO(c.end_time),
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const objective = mapObjective(xAdsProvider, OBJECTIVES, draft.objective);
    const { id: fundingInstrumentId } = await funding(call, accountId);
    if (!fundingInstrumentId) {
      throw new AdsProviderError('This X ads account has no funding instrument, so a campaign cannot be created. Add a payment method in X Ads first.', 409, false);
    }

    const campaign = rec((await ask(call, 'create_campaign', {
      account_id: accountId,
      name: draft.name,
      funding_instrument_id: fundingInstrumentId,
      entity_status: fromStatus(draft.status) ?? 'PAUSED',
      ...(draft.dailyBudgetCents ? { daily_budget_amount_local_micro: fromCents(draft.dailyBudgetCents, MICROS) } : {}),
      ...(draft.totalBudgetCents ? { total_budget_amount_local_micro: fromCents(draft.totalBudgetCents, MICROS) } : {}),
      ...(draft.startsAtISO ? { start_time: draft.startsAtISO } : {}),
      ...(draft.endsAtISO ? { end_time: draft.endsAtISO } : {}),
    })).data);
    const id = text(campaign.id);
    if (!id) throw new AdsProviderError('X accepted the campaign but did not return its id.', 502, true);

    // Without a line item the campaign is inert — it has a budget and no instruction
    // about what to buy, so it can never deliver and never reports a number.
    await ask(call, 'create_line_item', {
      account_id: accountId,
      campaign_id: id,
      name: `${draft.name} line item`,
      objective,
      product_type: 'PROMOTED_TWEETS',
      placements: ['ALL_ON_TWITTER'],
      entity_status: fromStatus(draft.status) ?? 'PAUSED',
    });

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
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const entityStatus = fromStatus(patch.status);
    await ask(call, 'update_campaign', {
      account_id: accountId,
      campaign_id: externalId,
      ...(patch.name ? { name: patch.name } : {}),
      ...(entityStatus ? { entity_status: entityStatus } : {}),
      ...(patch.dailyBudgetCents != null ? { daily_budget_amount_local_micro: fromCents(patch.dailyBudgetCents, MICROS) } : {}),
      ...(patch.totalBudgetCents != null ? { total_budget_amount_local_micro: fromCents(patch.totalBudgetCents, MICROS) } : {}),
    });
  },

  async insights(call, fields, query, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    // X has no "every campaign" stats call — `entity_ids` is required — so an
    // unscoped query resolves the account's campaigns first.
    const ids = query.externalCampaignIds?.length
      ? [...query.externalCampaignIds]
      : (await xAdsProvider.listCampaigns(call, fields, identity)).map((c) => c.externalId);
    if (ids.length === 0) return [];

    const sinceMs = new Date(`${query.since}T00:00:00Z`).getTime();
    // The end bound is EXCLUSIVE on X, so including the requested last day means
    // asking for the start of the day after it.
    const endExclusive = new Date(new Date(`${query.until}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

    const rows: AdInsightRow[] = [];
    // X caps `entity_ids` at 20 per request and rejects the whole call if it is longer,
    // so the batching is explicit rather than a limit discovered at 21 campaigns.
    for (let offset = 0; offset < ids.length; offset += 20) {
      const batch = ids.slice(offset, offset + 20);
      const result = await ask(call, 'get_stats', {
        account_id: accountId,
        entity: 'CAMPAIGN',
        entity_ids: batch.join(','),
        start_time: `${query.since}T00:00:00Z`,
        end_time: `${endExclusive}T00:00:00Z`,
        granularity: 'DAY',
        metric_groups: 'BILLING,ENGAGEMENT,WEB_CONVERSION',
        placement: 'ALL_ON_TWITTER',
      });

      for (const raw of list(result.data)) {
        const entry = rec(raw);
        const externalCampaignId = text(entry.id);
        const series = rec(list(entry.id_data)[0]).metrics;
        const metrics = rec(series);
        // Every metric is an ARRAY, one entry per day in the requested range, and a day
        // with no delivery is `null` rather than 0.
        const spend = list(metrics.billed_charge_local_micro);
        const impressions = list(metrics.impressions);
        const clicks = list(metrics.clicks);
        const conversions = list(metrics.conversion_purchases);
        const days = Math.max(spend.length, impressions.length, clicks.length);
        for (let day = 0; day < days; day += 1) {
          const date = toDay(new Date(sinceMs + day * 86_400_000).toISOString());
          if (!externalCampaignId || !date) continue;
          rows.push({
            date,
            externalCampaignId,
            spendCents: toCents(spend[day], MICROS) ?? 0,
            impressions: count(impressions[day]),
            clicks: count(clicks[day]),
            conversions: count(rec(conversions[day]).post_engagement ?? conversions[day]),
            currency: identity.currency,
          });
        }
      }
    }
    return rows;
  },
};
