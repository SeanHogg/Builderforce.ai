/**
 * Meta Ads — Facebook, Instagram, Messenger and Audience Network.
 *
 * Two unit conventions in ONE API, which is the whole reason `toCents` exists: budgets
 * are integers in the currency's minor unit (`daily_budget: 5000` is $50.00), while
 * reported `spend` is a DECIMAL STRING in the major unit (`"49.97"`). Reading both with
 * the same scale is a 100x error in a money column, in the direction that looks
 * plausible on a dashboard.
 */

import {
  ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO,
  unmapObjective,
  type AdCampaignDraft, type AdCampaignPatch, type AdCampaignRemote, type AdInsightRow,
  type AdObjective, type AdsProvider, type AdStatus,
} from '../adsProviders';

/** Meta's Outcome-Driven objectives. `video_views` is absent on purpose: Meta retired it
 *  as a campaign objective, so claiming it would silently buy something else. */
const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'OUTCOME_AWARENESS',
  traffic: 'OUTCOME_TRAFFIC',
  engagement: 'OUTCOME_ENGAGEMENT',
  leads: 'OUTCOME_LEADS',
  conversions: 'OUTCOME_SALES',
  app_installs: 'OUTCOME_APP_PROMOTION',
};

/** Budgets ride in the currency minor unit; reported spend rides in the major unit. */
const BUDGET_SCALE = 100;
const SPEND_SCALE = 1;

const CAMPAIGN_FIELDS = 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time';

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
    case 'ARCHIVED': case 'DELETED': return 'archived';
    default: return 'draft';
  }
}

/** Our normalized status → what Meta will accept on a write. `draft` is deliberately
 *  absent: Meta has no draft state, so writing one would mean silently pausing. */
function fromStatus(status: AdStatus | undefined): string | undefined {
  if (status === 'active') return 'ACTIVE';
  if (status === 'paused') return 'PAUSED';
  if (status === 'archived' || status === 'ended') return 'ARCHIVED';
  return undefined;
}

function toCampaign(raw: unknown, fallbackCurrency: string): AdCampaignRemote {
  const c = rec(raw);
  const native = text(c.objective) || null;
  return {
    externalId: text(c.id),
    name: text(c.name),
    status: toStatus(c.status),
    nativeObjective: native,
    objective: unmapObjective(OBJECTIVES, native),
    dailyBudgetCents: toCents(c.daily_budget, BUDGET_SCALE),
    totalBudgetCents: toCents(c.lifetime_budget, BUDGET_SCALE),
    currency: fallbackCurrency,
    startsAtISO: toISO(c.start_time),
    endsAtISO: toISO(c.stop_time),
  };
}

/**
 * Meta reports conversions as an ACTIONS array, not a column: every action type the
 * pixel saw, each with its own count. Summing all of them would count a page view as a
 * conversion, so only the outcome types are added — and the explicit `conversions`
 * field wins when the account reports one.
 */
const CONVERSION_ACTIONS = new Set([
  'offsite_conversion.fb_pixel_purchase', 'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb_pixel_complete_registration', 'onsite_conversion.lead_grouped',
  'lead', 'purchase', 'complete_registration', 'submit_application', 'start_trial', 'subscribe',
]);

function conversionsFrom(row: Record<string, unknown>): number {
  const explicit = Number(row.conversions);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  return list(row.actions).reduce<number>((total, raw) => {
    const action = rec(raw);
    return CONVERSION_ACTIONS.has(text(action.action_type)) ? total + count(action.value) : total;
  }, 0);
}

export const metaAdsProvider: AdsProvider = {
  network: 'meta', label: 'Meta Ads', connectorKey: 'meta-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  accountFields: [{
    key: 'adAccountId', label: 'Ad account ID',
    help: 'Including the act_ prefix — the Meta account the spend is billed to.',
  }],

  async identity(call, fields) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    // The account list is the only place Meta reports the CURRENCY, and every budget
    // this adapter writes is denominated in it — so identity is where it is read.
    const accounts = list((await ask(call, 'list_ad_accounts', { fields: 'id,name,currency,account_status', limit: 200 })).data);
    const match = accounts.map(rec).find((a) => text(a.id) === accountId);
    return {
      externalId: accountId,
      name: match ? text(match.name) || accountId : accountId,
      currency: match ? text(match.currency) || 'USD' : 'USD',
    };
  },

  async listCampaigns(call, fields, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const result = await ask(call, 'list_campaigns', { ad_account_id: accountId, fields: CAMPAIGN_FIELDS, limit: 200 });
    return list(result.data).map((raw) => toCampaign(raw, identity.currency));
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const daily = fromCents(draft.dailyBudgetCents, BUDGET_SCALE);
    const lifetime = fromCents(draft.totalBudgetCents, BUDGET_SCALE);
    const created = rec((await ask(call, 'create_campaign', {
      ad_account_id: accountId,
      name: draft.name,
      objective: mapObjective(metaAdsProvider, OBJECTIVES, draft.objective),
      status: fromStatus(draft.status) ?? 'PAUSED',
      special_ad_categories: [],
      ...(daily ? { daily_budget: daily } : {}),
      // Meta rejects a campaign carrying both, and a lifetime budget needs an end date.
      ...(!daily && lifetime ? { lifetime_budget: lifetime } : {}),
    })).data);
    const id = text(created.id);
    if (!id) throw new Error('Meta accepted the campaign but did not return its id.');
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

  async updateCampaign(call, _fields, externalId, patch) {
    const status = fromStatus(patch.status);
    const daily = fromCents(patch.dailyBudgetCents, BUDGET_SCALE);
    const lifetime = fromCents(patch.totalBudgetCents, BUDGET_SCALE);
    await ask(call, 'update_campaign', {
      campaign_id: externalId,
      ...(patch.name ? { name: patch.name } : {}),
      ...(status ? { status } : {}),
      ...(daily ? { daily_budget: daily } : {}),
      ...(lifetime ? { lifetime_budget: lifetime } : {}),
    });
  },

  async insights(call, fields, query, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const result = await ask(call, 'get_insights', {
      node_id: accountId,
      level: 'campaign',
      fields: 'campaign_id,spend,impressions,clicks,conversions,actions,date_start',
      // A JSON-encoded object is what Meta takes here — not two separate params.
      time_range: JSON.stringify({ since: query.since, until: query.until }),
      time_increment: 1,
      limit: 500,
    });
    return list(result.data).flatMap((raw) => {
      const row = rec(raw);
      const externalCampaignId = text(row.campaign_id);
      const date = toDay(row.date_start);
      // A row without a day or a campaign cannot be stored idempotently — the daily
      // ledger's identity IS (campaign, date), so a row missing either is dropped
      // rather than written under a guessed key.
      if (!externalCampaignId || !date) return [];
      return [{
        date,
        externalCampaignId,
        spendCents: toCents(row.spend, SPEND_SCALE) ?? 0,
        impressions: count(row.impressions),
        clicks: count(row.clicks),
        conversions: conversionsFrom(row),
        currency: identity.currency,
      } satisfies AdInsightRow];
    });
  },
};

export type { AdCampaignDraft, AdCampaignPatch };
