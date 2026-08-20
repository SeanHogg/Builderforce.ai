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
  AdsProviderError, ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO, unmapObjective,
} from '../adsNormalize';
import {
  ageFromBuckets, bucketedAgeKeys, mapTargetingValues, readNativeValues, requireTargetingSupport,
  type AdDevice, type AdGender, type AdPlacement, type AdTargeting, type AdTargetingDimension,
  type AgeBucket,
} from '../adTargeting';
import {
  type AdCreativeRemote, type AdInsightRow, type AdObjective, type AdSetRemote,
  type AdStatus, type AdsProvider,
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

/** Pinterest's gender values are lower case words, and `unknown` is a third bucket this
 *  vocabulary has no name for — so it is never sent, only read. */
const GENDERS: Readonly<Record<AdGender, string>> = { male: 'male', female: 'female' };

/**
 * Placements → Pinterest's `placement_traffic_type`.
 *
 * Pinterest sells the browse feed and search results. It has no stories, video-feed or
 * audience-network placement to buy, so those three are REFUSED by name rather than
 * folded into "all placements".
 */
const PLACEMENTS: Readonly<Record<AdPlacement, string | undefined>> = {
  feed: 'BROWSE',
  search: 'SEARCH',
  stories: undefined,
  video: undefined,
  audience_network: undefined,
};

/**
 * What Pinterest can place through this adapter.
 *
 * `interests` and `devices` are absent: Pinterest's interest targeting is id-valued and
 * the ads manifest carries no interest lookup, and its `targeting_spec` has no device
 * key at all. Both are refused by name rather than sent and ignored.
 */
const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = ['geo', 'age', 'gender', 'placements'];

/** Pinterest's contiguous age BUCKETS, as [inclusive min, inclusive max] in our terms.
 *  The top bucket is "65 and over", which is `AD_MAX_AGE` here. */
const AGE_BUCKETS: readonly AgeBucket[] = [
  { key: '18-24', min: 18, max: 24 },
  { key: '25-34', min: 25, max: 34 },
  { key: '35-44', min: 35, max: 44 },
  { key: '45-49', min: 45, max: 49 },
  { key: '50-54', min: 50, max: 54 },
  { key: '55-64', min: 55, max: 64 },
  { key: '65+', min: 65, max: 65 },
];

/** Our spec → Pinterest's `targeting_spec`. Every key is a LIST on Pinterest, including
 *  the ones that hold a single value. */
function targetingSpec(targeting: AdTargeting): Record<string, unknown> {
  requireTargetingSupport(pinterestAdsProvider, targeting);
  const spec: Record<string, unknown> = {};
  // Pinterest takes ISO country codes directly in `LOCATION`, with no id lookup.
  if (targeting.countries?.length) spec.LOCATION = [...targeting.countries];
  if (targeting.ageMin != null || targeting.ageMax != null) {
    spec.AGE_BUCKET = bucketedAgeKeys(pinterestAdsProvider, AGE_BUCKETS, targeting);
  }
  if (targeting.genders?.length) {
    spec.GENDER = mapTargetingValues(pinterestAdsProvider, 'gender', GENDERS, targeting.genders);
  }
  if (targeting.placements?.length) {
    spec.PLACEMENT_TRAFFIC_TYPE = mapTargetingValues(pinterestAdsProvider, 'placements', PLACEMENTS, targeting.placements);
  }
  return spec;
}

/** Pinterest's spec → as much of our vocabulary as it holds. Never throws. */
function readPinterestTargeting(raw: unknown): AdTargeting {
  const spec = rec(raw);
  const targeting: {
    countries?: string[]; ageMin?: number; ageMax?: number;
    genders?: AdGender[]; interests?: string[]; placements?: AdPlacement[]; devices?: AdDevice[];
  } = {};

  const countries = list(spec.LOCATION).map(text).filter((value) => /^[A-Za-z]{2}$/.test(value));
  if (countries.length) targeting.countries = countries.map((value) => value.toUpperCase());

  const window = ageFromBuckets(AGE_BUCKETS, list(spec.AGE_BUCKET).map(text));
  if (window) {
    targeting.ageMin = window.min;
    targeting.ageMax = window.max;
  }

  const genders = list(spec.GENDER)
    .map((value) => text(value).toLowerCase())
    .filter((value): value is AdGender => value === 'male' || value === 'female');
  if (genders.length) targeting.genders = genders;

  const placements = readNativeValues(PLACEMENTS, list(spec.PLACEMENT_TRAFFIC_TYPE).map(text));
  if (placements.length) targeting.placements = placements;

  return targeting;
}

export const pinterestAdsProvider: AdsProvider = {
  network: 'pinterest', label: 'Pinterest Ads', connectorKey: 'pinterest-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  targetingDimensions: TARGETING_DIMENSIONS,
  // A Pinterest campaign with no ad group is a valid paused shell the console shows; it
  // simply never delivers. Nothing is auto-created on its behalf.
  requiresAdSet: false,
  /**
   * Pinterest ads ALWAYS reference an existing pin — `create_ads` takes a `pin_id` and
   * there is no ad-authoring endpoint. So a `creativeRef` is required, and a form can
   * ask for it up front rather than discovering it as a vendor error.
   */
  requiresCreativeRef: true,
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

  // ── Ad groups (this port's ad set) ───────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_ad_groups', {
      ad_account_id: accountId,
      page_size: 250,
      ...(externalCampaignId ? { campaign_ids: externalCampaignId } : {}),
    })).data).map(rec);
    return rows.map((row) => ({
      externalId: text(row.id),
      externalCampaignId: text(row.campaign_id) || null,
      name: text(row.name),
      status: toStatus(row.status),
      targeting: readPinterestTargeting(row.targeting_spec),
      nativeTargeting: row.targeting_spec ?? null,
      bidStrategy: text(row.bid_strategy_type) || text(row.billable_event) || null,
      bidCents: toCents(row.bid_in_micro_currency, MICROS),
      dailyBudgetCents: toCents(row.budget_in_micro_currency, MICROS),
      currency: identity.currency,
      startsAtISO: toISO(row.start_time),
      endsAtISO: toISO(row.end_time),
    } satisfies AdSetRemote));
  },

  async createAdSet(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const spec = targetingSpec(draft.targeting);
    const daily = fromCents(draft.dailyBudgetCents, MICROS);
    const bid = fromCents(draft.bidCents, MICROS);

    const created = rec(list((await ask(call, 'create_ad_groups', {
      ad_account_id: accountId,
      // One element: `createAdSet` makes ONE ad group, which is the contract every other
      // network here honours — see this file's header on Pinterest's array bodies.
      ad_groups: [{
        campaign_id: draft.externalCampaignId,
        name: draft.name,
        status: fromStatus(draft.status) ?? 'PAUSED',
        // Pinterest bills the objective's own event; `billable_event` disagreeing with
        // the campaign is rejected rather than degraded.
        billable_event: draft.objective === 'awareness' ? 'IMPRESSION' : 'CLICKTHROUGH',
        ...(daily ? { budget_in_micro_currency: daily, budget_type: 'DAILY' } : {}),
        ...(bid ? { bid_in_micro_currency: bid } : {}),
        ...(draft.startsAtISO ? { start_time: draft.startsAtISO } : {}),
        ...(draft.endsAtISO ? { end_time: draft.endsAtISO } : {}),
        ...(Object.keys(spec).length ? { targeting_spec: spec } : {}),
      }],
    })).data)[0]);
    // Pinterest answers a batch write with per-item outcomes, so a 200 is not a success:
    // the element carries its own `data`/`exceptions` pair.
    const id = text(rec(created.data ?? created).id);
    if (!id) {
      const reason = text(rec(list(created.exceptions)[0]).message);
      throw new AdsProviderError(
        reason || 'Pinterest accepted the ad group request but did not return its id.',
        reason ? 400 : 502,
        !reason,
      );
    }

    return {
      externalId: id,
      externalCampaignId: draft.externalCampaignId,
      name: draft.name,
      status: draft.status ?? 'paused',
      targeting: draft.targeting,
      nativeTargeting: spec,
      bidStrategy: draft.objective === 'awareness' ? 'IMPRESSION' : 'CLICKTHROUGH',
      bidCents: draft.bidCents ?? null,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateAdSet(call, fields, externalId, patch) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const status = fromStatus(patch.status);
    const daily = fromCents(patch.dailyBudgetCents, MICROS);
    const bid = fromCents(patch.bidCents, MICROS);
    // A REPLACEMENT spec, not a merge — Pinterest overwrites the whole `targeting_spec`,
    // and pretending otherwise would drop every dimension the caller left out.
    const spec = patch.targeting ? targetingSpec(patch.targeting) : undefined;

    await ask(call, 'update_ad_groups', {
      ad_account_id: accountId,
      ad_groups: [{
        id: externalId,
        ...(patch.name ? { name: patch.name } : {}),
        ...(status ? { status } : {}),
        ...(daily ? { budget_in_micro_currency: daily, budget_type: 'DAILY' } : {}),
        ...(bid ? { bid_in_micro_currency: bid } : {}),
        ...(spec ? { targeting_spec: spec } : {}),
      }],
    });
  },

  // ── Promoted pins (this port's ad) ───────────────────────────────────────

  async listAds(call, fields, _identity, externalAdSetId) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_ads', {
      ad_account_id: accountId,
      page_size: 250,
      ...(externalAdSetId ? { ad_group_ids: externalAdSetId } : {}),
    })).data).map(rec);
    return rows.map((row) => ({
      externalId: text(row.id),
      externalAdSetId: text(row.ad_group_id) || null,
      name: text(row.name),
      status: toStatus(row.status),
      // The copy belongs to the PIN, which is a different resource and a different
      // scope; reporting it absent beats reporting a guess.
      headline: null,
      body: null,
      destinationUrl: text(row.destination_url) || null,
      callToAction: null,
    } satisfies AdCreativeRemote));
  },

  async createAd(call, fields, draft) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const pinId = (draft.creativeRef ?? '').trim();
    if (!pinId) {
      throw new AdsProviderError(
        'Pinterest promotes an existing pin — pass its id as creativeRef. There is no Pinterest endpoint that authors new ad copy, so one cannot be written for you.',
        400,
        false,
      );
    }

    const created = rec(list((await ask(call, 'create_ads', {
      ad_account_id: accountId,
      ads: [{
        ad_group_id: draft.externalAdSetId,
        pin_id: pinId,
        creative_type: 'REGULAR',
        name: draft.name,
        status: fromStatus(draft.status) ?? 'PAUSED',
        ...(draft.destinationUrl ? { destination_url: draft.destinationUrl } : {}),
      }],
    })).data)[0]);
    const id = text(rec(created.data ?? created).id);
    if (!id) {
      const reason = text(rec(list(created.exceptions)[0]).message);
      throw new AdsProviderError(
        reason || 'Pinterest accepted the ad request but did not return its id.',
        reason ? 400 : 502,
        !reason,
      );
    }

    return {
      externalId: id,
      externalAdSetId: draft.externalAdSetId,
      name: draft.name,
      status: draft.status ?? 'paused',
      headline: draft.headline ?? null,
      body: draft.body ?? null,
      callToAction: draft.callToAction ?? null,
      destinationUrl: draft.destinationUrl ?? null,
    };
  },

  async updateAd(call, fields, externalId, patch) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const status = fromStatus(patch.status);
    if (!patch.name && !status) return;
    await ask(call, 'update_ads', {
      ad_account_id: accountId,
      ads: [{
        id: externalId,
        ...(patch.name ? { name: patch.name } : {}),
        ...(status ? { status } : {}),
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
