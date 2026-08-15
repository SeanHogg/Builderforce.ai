/**
 * LinkedIn Ads — sponsored content and lead generation.
 *
 * Two shapes this adapter absorbs:
 *
 *   1. A CAMPAIGN CANNOT EXIST OUTSIDE A CAMPAIGN GROUP, and most accounts already have
 *      one. Requiring the caller to supply a group URN would push a LinkedIn-only
 *      concept through a port whose whole purpose is that there isn't one, so this
 *      reuses the account's first live group and creates one only when there is none.
 *   2. UPDATES ARE RESTLI PATCH DOCUMENTS (`{"patch":{"$set":{…}}}`), not a partial
 *      body. A plain body is accepted with a 200 and changes nothing, which is the
 *      worst possible failure mode for a budget change.
 *
 * Money is a decimal STRING in the major unit (`{"amount":"50.00","currencyCode":"USD"}`).
 */

import {
  ask, count, list, mapObjective, rec, requireField, text, toCents, toDay, toISO,
  unmapObjective, AdsProviderError,
  type AdCall, type AdInsightRow, type AdObjective, type AdsProvider, type AdStatus,
} from '../adsProviders';

const MAJOR = 1;

const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'BRAND_AWARENESS',
  traffic: 'WEBSITE_VISITS',
  engagement: 'ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  conversions: 'WEBSITE_CONVERSIONS',
  video_views: 'VIDEO_VIEWS',
};

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
    case 'DRAFT': return 'draft';
    case 'COMPLETED': return 'ended';
    case 'ARCHIVED': case 'CANCELED': return 'archived';
    default: return 'draft';
  }
}

function fromStatus(status: AdStatus | undefined): string | undefined {
  if (status === 'active') return 'ACTIVE';
  if (status === 'paused') return 'PAUSED';
  if (status === 'draft') return 'DRAFT';
  if (status === 'archived' || status === 'ended') return 'ARCHIVED';
  return undefined;
}

/** `{"amount":"50.00","currencyCode":"USD"}` → cents. */
const amountCents = (value: unknown): number | null => toCents(rec(value).amount, MAJOR);

/** cents → the money object LinkedIn takes on a write. */
function moneyFrom(cents: number | null | undefined, currency: string): Record<string, string> | undefined {
  if (cents == null || !Number.isFinite(cents)) return undefined;
  return { amount: (cents / 100).toFixed(2), currencyCode: currency };
}

const accountUrn = (id: string) => `urn:li:sponsoredAccount:${id}`;
const campaignUrn = (id: string) => `urn:li:sponsoredCampaign:${id}`;

/** LinkedIn's analytics finder takes a date as three separate numeric params. */
function dateParts(prefix: 'start' | 'end', day: string): Record<string, number> {
  const [year, month, date] = day.split('-').map(Number);
  return {
    [`dateRange.${prefix}.year`]: year ?? 0,
    [`dateRange.${prefix}.month`]: month ?? 0,
    [`dateRange.${prefix}.day`]: date ?? 0,
  };
}

/** The group a new campaign is parented to — reused if the account has one. */
async function resolveCampaignGroup(call: AdCall, accountId: string, currency: string, name: string): Promise<string> {
  const groups = list((await ask(call, 'list_campaign_groups', { account_id: accountId, q: 'search', count: 50 })).data).map(rec);
  const live = groups.find((g) => ['ACTIVE', 'DRAFT'].includes(text(g.status).toUpperCase()));
  if (live) {
    const urn = text(live.id) ? `urn:li:sponsoredCampaignGroup:${text(live.id)}` : '';
    if (urn) return urn;
  }
  const created = rec((await ask(call, 'create_campaign_group', {
    account_id: accountId,
    name: `${name} group`,
    status: 'ACTIVE',
    account: accountUrn(accountId),
  })).data);
  const id = text(created.id);
  if (!id) throw new AdsProviderError('LinkedIn accepted the campaign group but did not return its id.', 502, true);
  return `urn:li:sponsoredCampaignGroup:${id}`;
}

export const linkedinAdsProvider: AdsProvider = {
  network: 'linkedin', label: 'LinkedIn Ads', connectorKey: 'linkedin-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  accountFields: [{
    key: 'adAccountId', label: 'Ad account ID',
    help: 'The numeric sponsored account id this connection spends on.',
  }],

  async identity(call, fields) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const accounts = list((await ask(call, 'list_ad_accounts', { q: 'search', count: 100 })).data).map(rec);
    const match = accounts.find((a) => text(a.id) === accountId);
    return {
      externalId: accountId,
      name: match ? text(match.name) || accountId : accountId,
      currency: match ? text(match.currency) || 'USD' : 'USD',
    };
  },

  async listCampaigns(call, fields, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_campaigns', { account_id: accountId, q: 'search', count: 100 })).data).map(rec);
    return rows.map((c) => {
      const native = text(c.objectiveType) || null;
      const schedule = rec(c.runSchedule);
      return {
        externalId: text(c.id),
        name: text(c.name),
        status: toStatus(c.status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: amountCents(c.dailyBudget),
        totalBudgetCents: amountCents(c.totalBudget),
        currency: text(rec(c.dailyBudget).currencyCode) || identity.currency,
        startsAtISO: toISO(schedule.start),
        endsAtISO: toISO(schedule.end),
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const objectiveType = mapObjective(linkedinAdsProvider, OBJECTIVES, draft.objective);
    const campaignGroup = await resolveCampaignGroup(call, accountId, identity.currency, draft.name);
    const daily = moneyFrom(draft.dailyBudgetCents, identity.currency);
    const total = moneyFrom(draft.totalBudgetCents, identity.currency);
    const start = draft.startsAtISO ? Date.parse(draft.startsAtISO) : NaN;
    const end = draft.endsAtISO ? Date.parse(draft.endsAtISO) : NaN;

    const created = rec((await ask(call, 'create_campaign', {
      account_id: accountId,
      name: draft.name,
      account: accountUrn(accountId),
      campaignGroup,
      objectiveType,
      type: 'SPONSORED_UPDATES',
      costType: draft.objective === 'awareness' ? 'CPM' : 'CPC',
      status: fromStatus(draft.status) ?? 'DRAFT',
      ...(daily ? { dailyBudget: daily } : {}),
      ...(total ? { totalBudget: total } : {}),
      // LinkedIn schedules in EPOCH MILLISECONDS, and rejects a campaign with no start.
      runSchedule: {
        start: Number.isFinite(start) ? start : Date.now(),
        ...(Number.isFinite(end) ? { end } : {}),
      },
      locale: { country: 'US', language: 'en' },
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('LinkedIn accepted the campaign but did not return its id.', 502, true);

    return {
      externalId: id,
      name: draft.name,
      status: draft.status ?? 'draft',
      nativeObjective: objectiveType,
      objective: draft.objective,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      totalBudgetCents: draft.totalBudgetCents ?? null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateCampaign(call, fields, externalId, patch, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const set: Record<string, unknown> = {};
    if (patch.name) set.name = patch.name;
    const status = fromStatus(patch.status);
    if (status) set.status = status;
    const daily = moneyFrom(patch.dailyBudgetCents, identity.currency);
    if (daily) set.dailyBudget = daily;
    const total = moneyFrom(patch.totalBudgetCents, identity.currency);
    if (total) set.totalBudget = total;
    if (Object.keys(set).length === 0) return;
    await ask(call, 'update_campaign', { account_id: accountId, campaign_id: externalId, patch: { $set: set } });
  },

  async insights(call, fields, query, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const scoped = query.externalCampaignIds?.length
      ? { campaigns: `List(${query.externalCampaignIds.map((id) => encodeURIComponent(campaignUrn(id))).join(',')})` }
      : { accounts: `List(${encodeURIComponent(accountUrn(accountId))})` };
    const rows = list((await ask(call, 'get_analytics', {
      q: 'analytics',
      pivot: 'CAMPAIGN',
      timeGranularity: 'DAILY',
      ...dateParts('start', query.since),
      ...dateParts('end', query.until),
      ...scoped,
      fields: 'costInLocalCurrency,impressions,clicks,externalWebsiteConversions,dateRange,pivotValues',
    })).data).map(rec);

    return rows.flatMap((row) => {
      // The campaign this row belongs to arrives as a URN inside `pivotValues`.
      const pivot = list(row.pivotValues).map(text).find((v) => v.includes('sponsoredCampaign'));
      const externalCampaignId = pivot ? pivot.split(':').pop() ?? '' : '';
      const start = rec(rec(row.dateRange).start);
      const date = toDay(`${text(start.year)}-${text(start.month).padStart(2, '0')}-${text(start.day).padStart(2, '0')}`);
      if (!externalCampaignId || !date) return [];
      return [{
        date,
        externalCampaignId,
        spendCents: toCents(row.costInLocalCurrency, MAJOR) ?? 0,
        impressions: count(row.impressions),
        clicks: count(row.clicks),
        conversions: count(row.externalWebsiteConversions),
        currency: identity.currency,
      } satisfies AdInsightRow];
    });
  },
};
