/**
 * Google Ads — Search, Display, Video and Demand Gen.
 *
 * The odd one out in three ways, all of which are absorbed here so nothing above this
 * file knows about them:
 *
 *   1. IT IS QUERY-SHAPED. Campaigns, their budgets and their metrics are all read
 *      through one GAQL `search` call. There is no `GET /campaigns`.
 *   2. A CAMPAIGN CANNOT EXIST WITHOUT A BUDGET RESOURCE. Creating one is therefore two
 *      mutates — budget, then campaign referencing it. Google will not accept them in
 *      one call, so `createCampaign` genuinely is a two-step, and the budget is created
 *      first because a campaign that fails leaves an orphan budget (harmless, reusable)
 *      whereas the reverse would leave a campaign with no funding.
 *   3. MONEY IS MICROS. `cost_micros: 1_230_000` is $1.23.
 */

import {
  AdsProviderError, ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, unmapObjective,
} from '../adsNormalize';
import {
  type AdInsightRow, type AdObjective, type AdStatus, type AdsProvider,
} from '../adsProviders';

const MICROS = 1_000_000;

/**
 * Objective → advertising channel type.
 *
 * `engagement` and `app_installs` are absent deliberately. App campaigns need
 * `MULTI_CHANNEL` plus an `APP_CAMPAIGN` subtype plus a linked app id, and Google has no
 * generic engagement channel — so both are refused by name rather than quietly bought
 * as something adjacent.
 */
const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  traffic: 'SEARCH',
  leads: 'SEARCH',
  conversions: 'SEARCH',
  awareness: 'DISPLAY',
  video_views: 'VIDEO',
};

/** Which bidding strategy Google will accept for each objective on its channel. */
const BIDDING: Partial<Record<AdObjective, Record<string, unknown>>> = {
  traffic: { manualCpc: { enhancedCpcEnabled: false } },
  awareness: { manualCpc: { enhancedCpcEnabled: false } },
  video_views: { manualCpc: { enhancedCpcEnabled: false } },
  leads: { maximizeConversions: {} },
  conversions: { maximizeConversions: {} },
};

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ENABLED': return 'active';
    case 'PAUSED': return 'paused';
    case 'REMOVED': return 'archived';
    default: return 'draft';
  }
}

function fromStatus(status: AdStatus | undefined): string | undefined {
  if (status === 'active') return 'ENABLED';
  if (status === 'paused') return 'PAUSED';
  if (status === 'archived' || status === 'ended') return 'REMOVED';
  return undefined;
}

/** Google dates are `YYYY-MM-DD` or `YYYYMMDD`, never a timestamp. */
function toDateISO(value: unknown): string | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const dashed = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
  const parsed = new Date(`${dashed.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Google takes `YYYY-MM-DD` on a write. */
const toGoogleDate = (iso: string | null | undefined): string | undefined =>
  iso ? iso.slice(0, 10) : undefined;

/** A GAQL literal. Only dates and ids reach this, but an unescaped quote in a name
 *  would still be a query-injection seam, so quoting happens in exactly one place. */
const gaqlString = (value: string): string => `'${value.replace(/['\\]/g, '')}'`;

/** Digits only — Google rejects a customer id with dashes, which is how the UI shows it. */
const customerId = (value: string): string => value.replace(/\D/g, '');

async function search(call: Parameters<AdsProvider['identity']>[0], customer: string, query: string): Promise<Record<string, unknown>[]> {
  const result = await ask(call, 'search', { customer_id: customer, query, pageSize: 1000 });
  return list(result.data).map(rec);
}

export const googleAdsProvider: AdsProvider = {
  network: 'google', label: 'Google Ads', connectorKey: 'google-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  accountFields: [{
    key: 'adAccountId', label: 'Customer ID',
    help: 'The Google Ads customer id this connection spends on, digits only.',
  }],

  async identity(call, fields) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const rows = await search(call, customer, 'SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1');
    const c = rec(rows[0]?.customer);
    return {
      externalId: customer,
      name: text(c.descriptiveName) || customer,
      currency: text(c.currencyCode) || 'USD',
    };
  },

  async listCampaigns(call, fields, identity) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const rows = await search(call, customer, [
      'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,',
      'campaign.start_date, campaign.end_date, campaign_budget.amount_micros,',
      'campaign_budget.total_amount_micros FROM campaign WHERE campaign.status != \'REMOVED\'',
    ].join(' '));
    return rows.map((row) => {
      const c = rec(row.campaign);
      const budget = rec(row.campaignBudget);
      const native = text(c.advertisingChannelType) || null;
      return {
        externalId: text(c.id),
        name: text(c.name),
        status: toStatus(c.status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: toCents(budget.amountMicros, MICROS),
        totalBudgetCents: toCents(budget.totalAmountMicros, MICROS),
        currency: identity.currency,
        startsAtISO: toDateISO(c.startDate),
        endsAtISO: toDateISO(c.endDate),
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const channel = mapObjective(googleAdsProvider, OBJECTIVES, draft.objective);
    const dailyMicros = fromCents(draft.dailyBudgetCents, MICROS);
    if (!dailyMicros) {
      // Not a Google restriction we can work around: a campaign budget resource is
      // required and it is denominated as a DAILY amount.
      throw new AdsProviderError('A Google Ads campaign needs a daily budget. Set one and try again.', 400, false);
    }

    // `resultPath: 'results'` on the manifest means `data` IS the operations array.
    const budgetResults = list((await ask(call, 'mutate_campaign_budgets', {
      customer_id: customer,
      operations: [{
        create: {
          // The budget name must be unique per account, and Google's own error for a
          // collision names neither the budget nor the campaign — so the campaign name
          // is suffixed with the start date to keep re-runs distinguishable.
          name: `${draft.name} budget ${toGoogleDate(draft.startsAtISO) ?? 'default'}`,
          amountMicros: String(dailyMicros),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      }],
    })).data);
    const budgetResource = text(rec(budgetResults[0]).resourceName);
    if (!budgetResource) throw new AdsProviderError('Google Ads created the budget but did not return its resource name.', 502, true);

    const campaignResults = list((await ask(call, 'mutate_campaigns', {
      customer_id: customer,
      operations: [{
        create: {
          name: draft.name,
          status: fromStatus(draft.status) ?? 'PAUSED',
          advertisingChannelType: channel,
          campaignBudget: budgetResource,
          ...(BIDDING[draft.objective] ?? {}),
          ...(toGoogleDate(draft.startsAtISO) ? { startDate: toGoogleDate(draft.startsAtISO) } : {}),
          ...(toGoogleDate(draft.endsAtISO) ? { endDate: toGoogleDate(draft.endsAtISO) } : {}),
          // Search campaigns default to opting into the Display network, which spends
          // the budget somewhere the objective did not ask for.
          ...(channel === 'SEARCH' ? { networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false } } : {}),
        },
      }],
    })).data);
    const resourceName = text(rec(campaignResults[0]).resourceName);
    const id = resourceName.split('/').pop() ?? '';
    if (!id) throw new AdsProviderError('Google Ads accepted the campaign but did not return its id.', 502, true);

    return {
      externalId: id,
      name: draft.name,
      status: draft.status ?? 'paused',
      nativeObjective: channel,
      objective: draft.objective,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      totalBudgetCents: draft.totalBudgetCents ?? null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateCampaign(call, fields, externalId, patch) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const status = fromStatus(patch.status);
    const update: Record<string, unknown> = { resourceName: `customers/${customer}/campaigns/${externalId}` };
    const paths: string[] = [];
    if (patch.name) { update.name = patch.name; paths.push('name'); }
    if (status) { update.status = status; paths.push('status'); }
    if (paths.length > 0) {
      // Google requires an explicit field mask: a field absent from it is IGNORED, so
      // building the mask from what was actually set is what makes a patch a patch.
      await ask(call, 'mutate_campaigns', { customer_id: customer, operations: [{ update, updateMask: paths.join(',') }] });
    }

    // A budget change is a different resource entirely — the campaign only points at it.
    const dailyMicros = fromCents(patch.dailyBudgetCents, MICROS);
    if (dailyMicros) {
      const rows = await search(call, customer, `SELECT campaign_budget.resource_name FROM campaign WHERE campaign.id = ${gaqlString(externalId)}`);
      const budgetResource = text(rec(rows[0]?.campaignBudget).resourceName);
      if (!budgetResource) throw new AdsProviderError('That Google Ads campaign has no budget to change.', 404, false);
      await ask(call, 'mutate_campaign_budgets', {
        customer_id: customer,
        operations: [{ update: { resourceName: budgetResource, amountMicros: String(dailyMicros) }, updateMask: 'amount_micros' }],
      });
    }
  },

  async insights(call, fields, query, identity) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const scope = query.externalCampaignIds?.length
      ? ` AND campaign.id IN (${query.externalCampaignIds.map((id) => gaqlString(id)).join(',')})`
      : '';
    const rows = await search(call, customer, [
      'SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions,',
      'metrics.clicks, metrics.conversions FROM campaign',
      `WHERE segments.date BETWEEN ${gaqlString(query.since)} AND ${gaqlString(query.until)}${scope}`,
    ].join(' '));
    return rows.flatMap((row) => {
      const externalCampaignId = text(rec(row.campaign).id);
      const date = toDay(rec(row.segments).date);
      if (!externalCampaignId || !date) return [];
      const metrics = rec(row.metrics);
      return [{
        date,
        externalCampaignId,
        spendCents: toCents(metrics.costMicros, MICROS) ?? 0,
        impressions: count(metrics.impressions),
        clicks: count(metrics.clicks),
        // Google reports fractional conversions by design (a conversion can be
        // value-weighted across attributions); the ledger stores whole events.
        conversions: count(metrics.conversions),
        currency: identity.currency,
      } satisfies AdInsightRow];
    });
  },
};
