/**
 * LinkedIn Ads — sponsored content and lead generation.
 *
 * ── WHICH LINKEDIN OBJECT IS WHICH LEVEL ─────────────────────────────────────
 * LinkedIn has three levels — campaign GROUP, campaign, creative — and this port has
 * three: campaign, ad set, ad. They line up in the obvious way, and the obvious way is
 * NOT the one that reads the same:
 *
 *     our campaign  →  urn:li:sponsoredCampaignGroup   (the budget envelope)
 *     our ad set    →  urn:li:sponsoredCampaign        (objective + targeting + bid)
 *     our ad        →  urn:li:creative                 (what a person sees)
 *
 * A LinkedIn CAMPAIGN is where the objective, the targeting criteria, the daily budget
 * and the bid all live — which is the definition of an ad set everywhere else in this
 * port. The group above it holds a name, a status and a total budget, which is what a
 * campaign is here. Mapping our campaign onto LinkedIn's campaign — as this adapter did
 * until the ad-set level existed — left the middle level with nowhere to go and made
 * LinkedIn the one network where a campaign could not be targeted at all.
 *
 * Migration 1102 re-points the stored ids that were written under the old reading.
 *
 * ── TWO SHAPES THIS ADAPTER ABSORBS ──────────────────────────────────────────
 *   1. UPDATES ARE RESTLI PATCH DOCUMENTS (`{"patch":{"$set":{…}}}`), not a partial
 *      body. A plain body is accepted with a 200 and changes nothing, which is the
 *      worst possible failure mode for a budget change.
 *   2. Money is a decimal STRING in the major unit
 *      (`{"amount":"50.00","currencyCode":"USD"}`).
 */

import {
  AdsProviderError, ask, count, list, mapObjective, rec, requireField, text, toCents, toDay, toISO, unmapObjective,
} from '../adsNormalize';
import {
  requireTargetingSupport,
  type AdTargeting, type AdTargetingDimension,
} from '../adTargeting';
import {
  type AdCall, type AdCreativeRemote, type AdInsightRow, type AdObjective, type AdSetRemote,
  type AdStatus, type AdsProvider,
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

/**
 * What LinkedIn can place FROM THIS VOCABULARY: nothing.
 *
 * Not an oversight — a consequence of how LinkedIn targets. Its `targetingCriteria` is
 * an include/exclude tree of FACET URNs (`urn:li:geo:…`, `urn:li:interest:…`, and the
 * professional facets — seniority, job function, company size — that are the reason
 * anyone buys LinkedIn). Every value is an id, resolved through an
 * `adTargetingFacets`/`adTargetingEntities` lookup the ads manifest does not carry, and
 * LinkedIn offers no country-code shortcut the way Reddit, Pinterest and Snap do.
 *
 * So every dimension here is REFUSED BY NAME through {@link requireTargetingSupport},
 * with the sentence that names what it can do instead. The alternative — accepting
 * "Germany, 25-34" and creating an untargeted campaign because the facet could not be
 * built — is the exact failure `adTargeting` exists to prevent, and it would be
 * invisible in every report while the budget went to everybody.
 */
const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = [];

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
const campaignGroupUrn = (id: string) => `urn:li:sponsoredCampaignGroup:${id}`;

/** The numeric id at the end of any LinkedIn URN. */
const idOfUrn = (urn: string): string => urn.split(':').pop() ?? '';

/** LinkedIn's analytics finder takes a date as three separate numeric params. */
function dateParts(prefix: 'start' | 'end', day: string): Record<string, number> {
  const [year, month, date] = day.split('-').map(Number);
  return {
    [`dateRange.${prefix}.year`]: year ?? 0,
    [`dateRange.${prefix}.month`]: month ?? 0,
    [`dateRange.${prefix}.day`]: date ?? 0,
  };
}

/** LinkedIn schedules in EPOCH MILLISECONDS and rejects an object with no start. */
function runSchedule(startISO: string | null | undefined, endISO: string | null | undefined): Record<string, number> {
  const start = startISO ? Date.parse(startISO) : NaN;
  const end = endISO ? Date.parse(endISO) : NaN;
  return {
    start: Number.isFinite(start) ? start : Date.now(),
    ...(Number.isFinite(end) ? { end } : {}),
  };
}

export const linkedinAdsProvider: AdsProvider = {
  network: 'linkedin', label: 'LinkedIn Ads', connectorKey: 'linkedin-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  targetingDimensions: TARGETING_DIMENSIONS,
  /**
   * A LinkedIn campaign GROUP carries no objective and no targeting — a group with no
   * campaign under it can never deliver and never reports a number. So `adsService`
   * composes one through `createAdSet` after every create, which is also where the
   * requested daily budget lands: a group has no daily budget of its own.
   */
  requiresAdSet: true,
  /**
   * A LinkedIn creative RENDERS an existing post (`inlineContent` is the share URN).
   * There is no endpoint that authors ad copy from a headline and a body, so a
   * `creativeRef` is required and asked for up front.
   */
  requiresCreativeRef: true,
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

  // ── Campaign groups (this port's campaign) ───────────────────────────────

  async listCampaigns(call, fields, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const groups = list((await ask(call, 'list_campaign_groups', { account_id: accountId, q: 'search', count: 100 })).data).map(rec);
    if (groups.length === 0) return [];

    /*
     * The OBJECTIVE lives one level down, so it is read back from the group's campaigns
     * — the same move `x.ts` makes for the same reason. ONE call for every campaign on
     * the account, grouped in memory: a request per group is the N+1 this codebase
     * forbids, and the daily budget has to be summed from here anyway.
     */
    const campaigns = list((await ask(call, 'list_campaigns', { account_id: accountId, q: 'search', count: 1000 })).data).map(rec);
    const objectiveByGroup = new Map<string, string>();
    const dailyByGroup = new Map<string, number>();
    for (const campaign of campaigns) {
      const groupId = idOfUrn(text(campaign.campaignGroup));
      if (!groupId) continue;
      const objective = text(campaign.objectiveType);
      if (objective && !objectiveByGroup.has(groupId)) objectiveByGroup.set(groupId, objective);
      const cents = amountCents(campaign.dailyBudget);
      // Several campaigns under one group each carry their own daily budget, and the
      // group's daily rate is their SUM, not the first one seen.
      if (cents != null) dailyByGroup.set(groupId, (dailyByGroup.get(groupId) ?? 0) + cents);
    }

    return groups.map((g) => {
      const id = text(g.id);
      const native = objectiveByGroup.get(id) ?? null;
      const schedule = rec(g.runSchedule);
      return {
        externalId: id,
        name: text(g.name),
        status: toStatus(g.status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: dailyByGroup.get(id) ?? null,
        totalBudgetCents: amountCents(g.totalBudget),
        currency: text(rec(g.totalBudget).currencyCode) || identity.currency,
        startsAtISO: toISO(schedule.start),
        endsAtISO: toISO(schedule.end),
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    // Mapped here even though the campaign beneath is what carries it, so an objective
    // LinkedIn cannot serve is refused BEFORE a group exists rather than after.
    const objectiveType = mapObjective(linkedinAdsProvider, OBJECTIVES, draft.objective);
    const total = moneyFrom(draft.totalBudgetCents, identity.currency);

    const created = rec((await ask(call, 'create_campaign_group', {
      account_id: accountId,
      name: draft.name,
      account: accountUrn(accountId),
      status: fromStatus(draft.status) ?? 'DRAFT',
      ...(total ? { totalBudget: total } : {}),
      runSchedule: runSchedule(draft.startsAtISO, draft.endsAtISO),
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('LinkedIn accepted the campaign group but did not return its id.', 502, true);

    return {
      externalId: id,
      name: draft.name,
      status: draft.status ?? 'draft',
      nativeObjective: objectiveType,
      objective: draft.objective,
      // The daily budget belongs to the campaign beneath — `adsService` puts it there
      // through `createAdSet`, so reporting it here would claim a field the group has not.
      dailyBudgetCents: null,
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
    const total = moneyFrom(patch.totalBudgetCents, identity.currency);
    if (total) set.totalBudget = total;
    /*
     * A DAILY budget is deliberately not applied here. It lives on the campaigns beneath
     * the group, and there is no single one to write it to — spreading it across them
     * would invent an allocation nobody asked for. `updateAdSet` is where a daily rate
     * is changed, against the ad set that actually holds it.
     */
    if (Object.keys(set).length === 0) return;
    await ask(call, 'update_campaign_group', {
      account_id: accountId, campaign_group_id: externalId, patch: { $set: set },
    });
  },

  // ── Campaigns (this port's ad set) ───────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_campaigns', { account_id: accountId, q: 'search', count: 1000 })).data).map(rec);
    // LinkedIn's account-level campaign finder takes no campaign-group filter, so the
    // scope is applied here — one call for the account still beats one per group.
    const scoped = externalCampaignId
      ? rows.filter((row) => idOfUrn(text(row.campaignGroup)) === externalCampaignId)
      : rows;

    return scoped.map((row) => {
      const schedule = rec(row.runSchedule);
      return {
        externalId: text(row.id),
        externalCampaignId: idOfUrn(text(row.campaignGroup)) || null,
        name: text(row.name),
        status: toStatus(row.status),
        // LinkedIn's facet tree has no expression in this vocabulary (see
        // TARGETING_DIMENSIONS), so the spec travels verbatim in `nativeTargeting`
        // rather than being reported as an empty — that is, unrestricted — audience.
        targeting: {},
        nativeTargeting: row.targetingCriteria ?? null,
        bidStrategy: text(row.costType) || null,
        bidCents: amountCents(row.unitCost),
        dailyBudgetCents: amountCents(row.dailyBudget),
        currency: text(rec(row.dailyBudget).currencyCode) || identity.currency,
        startsAtISO: toISO(schedule.start),
        endsAtISO: toISO(schedule.end),
      } satisfies AdSetRemote;
    });
  },

  async createAdSet(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    // Refuses by name for every dimension, since LinkedIn can place none of them here.
    requireTargetingSupport(linkedinAdsProvider, draft.targeting);
    const objectiveType = mapObjective(linkedinAdsProvider, OBJECTIVES, draft.objective);
    const daily = moneyFrom(draft.dailyBudgetCents, identity.currency);
    const bid = moneyFrom(draft.bidCents, identity.currency);

    const created = rec((await ask(call, 'create_campaign', {
      account_id: accountId,
      name: draft.name,
      account: accountUrn(accountId),
      campaignGroup: campaignGroupUrn(draft.externalCampaignId),
      objectiveType,
      type: 'SPONSORED_UPDATES',
      costType: draft.objective === 'awareness' ? 'CPM' : 'CPC',
      status: fromStatus(draft.status) ?? 'DRAFT',
      ...(daily ? { dailyBudget: daily } : {}),
      ...(bid ? { unitCost: bid } : {}),
      runSchedule: runSchedule(draft.startsAtISO, draft.endsAtISO),
      locale: { country: 'US', language: 'en' },
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('LinkedIn accepted the campaign but did not return its id.', 502, true);

    return {
      externalId: id,
      externalCampaignId: draft.externalCampaignId,
      name: draft.name,
      status: draft.status ?? 'draft',
      targeting: draft.targeting,
      nativeTargeting: null,
      bidStrategy: draft.objective === 'awareness' ? 'CPM' : 'CPC',
      bidCents: draft.bidCents ?? null,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateAdSet(call, fields, externalId, patch, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    if (patch.targeting) requireTargetingSupport(linkedinAdsProvider, patch.targeting);

    const set: Record<string, unknown> = {};
    if (patch.name) set.name = patch.name;
    const status = fromStatus(patch.status);
    if (status) set.status = status;
    const daily = moneyFrom(patch.dailyBudgetCents, identity.currency);
    if (daily) set.dailyBudget = daily;
    const bid = moneyFrom(patch.bidCents, identity.currency);
    if (bid) set.unitCost = bid;
    if (Object.keys(set).length === 0) return;

    await ask(call, 'update_campaign', { account_id: accountId, campaign_id: externalId, patch: { $set: set } });
  },

  // ── Creatives (this port's ad) ───────────────────────────────────────────

  async listAds(call, fields, _identity, externalAdSetId) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_creatives', {
      account_id: accountId,
      q: 'criteria',
      count: 1000,
      ...(externalAdSetId ? { campaigns: `List(${encodeURIComponent(campaignUrn(externalAdSetId))})` } : {}),
    })).data).map(rec);

    return rows.map((row) => {
      const urn = text(row.id);
      return {
        // A creative's id IS a URN on this endpoint. Kept whole rather than reduced to
        // its trailing number, because the update path addresses it by URN.
        externalId: urn,
        externalAdSetId: idOfUrn(text(row.campaign)) || null,
        // A creative has no name of its own — it IS the post it renders. Naming it by
        // the content URN is honest; inventing a title is not.
        name: text(row.inlineContent) || urn,
        status: toStatus(row.intendedStatus),
        // The copy belongs to the POST, a separate resource under a different scope.
        headline: null,
        body: null,
        callToAction: null,
        destinationUrl: null,
      } satisfies AdCreativeRemote;
    });
  },

  async createAd(call, fields, draft) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const content = (draft.creativeRef ?? '').trim();
    if (!content) {
      throw new AdsProviderError(
        'LinkedIn renders an existing post as a creative — pass its share or video URN as creativeRef. There is no LinkedIn endpoint that authors ad copy, so one cannot be written for you.',
        400,
        false,
      );
    }

    const created = rec((await ask(call, 'create_creative', {
      account_id: accountId,
      campaign: campaignUrn(draft.externalAdSetId),
      inlineContent: content,
      intendedStatus: fromStatus(draft.status) ?? 'DRAFT',
    })).data);
    // The creative id arrives as a URN on the body or in the `x-restli-id` header shape;
    // either way what is stored is what `update_creative` will be given back.
    const id = text(created.id) || content;
    if (!id) throw new AdsProviderError('LinkedIn accepted the creative but did not return its id.', 502, true);

    return {
      externalId: id,
      externalAdSetId: draft.externalAdSetId,
      name: content,
      status: draft.status ?? 'draft',
      headline: draft.headline ?? null,
      body: draft.body ?? null,
      callToAction: draft.callToAction ?? null,
      destinationUrl: draft.destinationUrl ?? null,
    };
  },

  async updateAd(call, fields, externalId, patch) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const status = fromStatus(patch.status);
    // Only STATUS is patchable. A creative's content is the post it renders, and
    // pointing it at a different one is a different creative — which `AdPatch` already
    // declines to offer, and LinkedIn would re-review anyway.
    if (!status) return;
    await ask(call, 'update_creative', {
      account_id: accountId,
      creative_id: encodeURIComponent(externalId),
      patch: { $set: { intendedStatus: status } },
    });
  },

  async insights(call, fields, query, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    /*
     * Pivoted on CAMPAIGN_GROUP, because that is what this port calls a campaign — see
     * the header. Pivoting on CAMPAIGN would return one row per LinkedIn campaign, which
     * is an AD SET here, and `ad_insights` is keyed by campaign: the numbers would be
     * filed against ids that do not exist at that level, and a group running three
     * campaigns would report a third of its spend.
     */
    const scoped = query.externalCampaignIds?.length
      ? { campaignGroups: `List(${query.externalCampaignIds.map((id) => encodeURIComponent(campaignGroupUrn(id))).join(',')})` }
      : { accounts: `List(${encodeURIComponent(accountUrn(accountId))})` };
    const rows = list((await ask(call, 'get_analytics', {
      q: 'analytics',
      pivot: 'CAMPAIGN_GROUP',
      timeGranularity: 'DAILY',
      ...dateParts('start', query.since),
      ...dateParts('end', query.until),
      ...scoped,
      fields: 'costInLocalCurrency,impressions,clicks,externalWebsiteConversions,dateRange,pivotValues',
    })).data).map(rec);

    return rows.flatMap((row) => {
      // The group this row belongs to arrives as a URN inside `pivotValues`.
      const pivot = list(row.pivotValues).map(text).find((v) => v.includes('sponsoredCampaignGroup'));
      const externalCampaignId = pivot ? idOfUrn(pivot) : '';
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
