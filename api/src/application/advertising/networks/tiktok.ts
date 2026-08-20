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
  AdsProviderError, ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO, unmapObjective,
} from '../adsNormalize';
import {
  ageFromBuckets, bucketedAgeKeys, mapTargetingValues, readNativeValues, requireTargetingSupport,
  type AdDevice, type AdGender, type AdPlacement, type AdTargeting, type AdTargetingDimension,
  type AgeBucket,
} from '../adTargeting';
import {
  type AdCall, type AdCallResult, type AdCreativeRemote, type AdInsightRow, type AdObjective,
  type AdSetRemote, type AdStatus, type AdsProvider,
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

/**
 * What an ad group OPTIMIZES for, and what TikTok therefore bills.
 *
 * Carried down from the parent campaign's objective (`AdSetDraft.objective`) rather than
 * re-read, because TikTok REJECTS an ad group whose optimization goal disagrees with the
 * campaign above it — and reports the disagreement as a generic parameter error.
 */
const OPTIMIZATION: Partial<Record<AdObjective, string>> = {
  awareness: 'REACH',
  traffic: 'CLICK',
  engagement: 'ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  conversions: 'CONVERT',
  app_installs: 'INSTALL',
  video_views: 'VIDEO_VIEW',
};

/** How TikTok charges for each goal. A wrong pair is refused by TikTok, not degraded. */
const BILLING: Partial<Record<AdObjective, string>> = {
  awareness: 'CPM',
  traffic: 'CPC',
  engagement: 'OCPM',
  leads: 'OCPM',
  conversions: 'OCPM',
  app_installs: 'OCPM',
  video_views: 'CPM',
};

const GENDERS: Readonly<Record<AdGender, string>> = {
  male: 'GENDER_MALE',
  female: 'GENDER_FEMALE',
};

/**
 * Placements → TikTok's own surfaces.
 *
 * TikTok sells the TikTok app and Pangle (its audience network); it has no separate
 * story, search or video-feed placement to buy, so those three are REFUSED by name
 * rather than quietly resolved to "the whole app".
 */
const PLACEMENTS: Readonly<Record<AdPlacement, string | undefined>> = {
  feed: 'PLACEMENT_TIKTOK',
  audience_network: 'PLACEMENT_PANGLE',
  stories: undefined,
  search: undefined,
  video: undefined,
};

/** Devices are absent: `create_adgroup`/`update_adgroup` take no device parameter at
 *  all, so TikTok cannot place the dimension and says so through
 *  {@link requireTargetingSupport} rather than dropping it. */
const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = ['geo', 'age', 'gender', 'interests', 'placements'];

/**
 * TikTok's age BUCKETS, in order, as [inclusive min, inclusive max] in this port's terms.
 * The top bucket is "55 and over", which is `AD_MAX_AGE` here.
 */
const AGE_BUCKETS: readonly AgeBucket[] = [
  { key: 'AGE_13_17', min: 13, max: 17 },
  { key: 'AGE_18_24', min: 18, max: 24 },
  { key: 'AGE_25_34', min: 25, max: 34 },
  { key: 'AGE_35_44', min: 35, max: 44 },
  { key: 'AGE_45_54', min: 45, max: 54 },
  { key: 'AGE_55_100', min: 55, max: 65 },
];

/**
 * Country codes → the numeric location ids TikTok requires.
 *
 * TikTok takes `location_ids`, never country codes, and IGNORES an id it does not know
 * rather than failing — so an unresolved country would produce an ad group targeted at
 * whatever else did resolve, at the full budget. Unresolved codes are refused instead.
 */
async function resolveLocationIds(
  call: AdCall, advertiserId: string, countries: readonly string[],
): Promise<string[]> {
  const data = unwrap(await ask(call, 'list_regions', { advertiser_id: advertiserId }));
  const byCode = new Map<string, string>();
  for (const raw of list(data.region_info ?? data.list)) {
    const region = rec(raw);
    const code = text(region.region_code).toUpperCase();
    const id = text(region.region_id ?? region.location_id);
    if (code && id && !byCode.has(code)) byCode.set(code, id);
  }
  const ids: string[] = [];
  for (const country of countries) {
    const id = byCode.get(country.toUpperCase());
    if (!id) {
      throw new AdsProviderError(
        `TikTok does not sell ads in "${country}", or not for this objective. `
        + 'Drop that country or choose another network — it will not be skipped silently.',
        400,
        false,
      );
    }
    ids.push(id);
  }
  return ids;
}

/**
 * Interest PHRASES → TikTok interest category ids.
 *
 * Same contract as the location lookup and for the same reason: TikTok reads the id and
 * ignores the name, so an unmatched phrase yields a technically-targeted, practically
 * untargeted ad group.
 */
async function resolveInterestIds(
  call: AdCall, advertiserId: string, phrases: readonly string[],
): Promise<string[]> {
  const data = unwrap(await ask(call, 'list_interest_categories', { advertiser_id: advertiserId, language: 'en' }));
  const byName = new Map<string, string>();
  const walk = (nodes: unknown): void => {
    for (const raw of list(nodes)) {
      const node = rec(raw);
      const name = text(node.interest_category_name ?? node.name).toLowerCase();
      const id = text(node.interest_category_id ?? node.id);
      if (name && id && !byName.has(name)) byName.set(name, id);
      walk(node.sub_categories ?? node.children);
    }
  };
  walk(data.interest_categories ?? data.list);

  const ids: string[] = [];
  for (const phrase of phrases) {
    const id = byName.get(phrase.trim().toLowerCase());
    if (!id) {
      throw new AdsProviderError(
        `TikTok has no interest category called "${phrase}". Interests are ids on TikTok, not `
        + 'free text — use a category name it recognises, or drop the interest dimension.',
        400,
        false,
      );
    }
    ids.push(id);
  }
  return ids;
}

/** Our spec → the ad group fields TikTok takes. Refuses before the write, never after. */
async function targetingFields(
  call: AdCall, advertiserId: string, targeting: AdTargeting,
): Promise<Record<string, unknown>> {
  requireTargetingSupport(tiktokAdsProvider, targeting);
  const fields: Record<string, unknown> = {};

  if (targeting.countries?.length) {
    fields.location_ids = await resolveLocationIds(call, advertiserId, targeting.countries);
  }
  if (targeting.ageMin != null || targeting.ageMax != null) {
    fields.age_groups = bucketedAgeKeys(tiktokAdsProvider, AGE_BUCKETS, targeting);
  }
  if (targeting.genders?.length) {
    // TikTok takes ONE gender, not a list. `parseTargeting` already drops "both", which
    // is the unrestricted default rather than a constraint, so a list here is a single.
    const mapped = mapTargetingValues(tiktokAdsProvider, 'gender', GENDERS, targeting.genders);
    fields.gender = mapped.length === 1 ? mapped[0] : 'GENDER_UNLIMITED';
  }
  if (targeting.interests?.length) {
    fields.interest_category_ids = await resolveInterestIds(call, advertiserId, targeting.interests);
  }
  if (targeting.placements?.length) {
    fields.placements = mapTargetingValues(tiktokAdsProvider, 'placements', PLACEMENTS, targeting.placements);
    fields.placement_type = 'PLACEMENT_TYPE_NORMAL';
  }
  return fields;
}

/** A TikTok ad group row → as much of our vocabulary as it carries. Never throws. */
function readTiktokTargeting(row: Record<string, unknown>): AdTargeting {
  const targeting: {
    countries?: string[]; ageMin?: number; ageMax?: number;
    genders?: AdGender[]; interests?: string[]; placements?: AdPlacement[]; devices?: AdDevice[];
  } = {};

  // `location_ids` are numeric and mean nothing without a lookup this read path does not
  // perform, so geography travels in `nativeTargeting` rather than being guessed at.
  const window = ageFromBuckets(AGE_BUCKETS, list(row.age_groups).map(text));
  if (window) {
    targeting.ageMin = window.min;
    targeting.ageMax = window.max;
  }
  const gender = text(row.gender).toUpperCase();
  if (gender === 'GENDER_MALE') targeting.genders = ['male'];
  if (gender === 'GENDER_FEMALE') targeting.genders = ['female'];

  const placements = readNativeValues(PLACEMENTS, list(row.placements).map(text));
  if (placements.length) targeting.placements = placements;

  return targeting;
}

/** TikTok schedules in `YYYY-MM-DD HH:MM:SS`, not ISO. */
function tiktokTime(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString().slice(0, 19).replace('T', ' ');
}

/** The `filtering` bag TikTok scopes list calls with — a JSON STRING, not an object. */
const filterBy = (filter: Record<string, unknown>): string => JSON.stringify(filter);

export const tiktokAdsProvider: AdsProvider = {
  network: 'tiktok', label: 'TikTok Ads', connectorKey: 'tiktok-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  targetingDimensions: TARGETING_DIMENSIONS,
  // A TikTok campaign with no ad group is a valid paused shell that Ads Manager shows;
  // it simply never delivers. Nothing is auto-created on its behalf.
  requiresAdSet: false,
  // TikTok can author new copy (`ad_text` + `landing_page_url`), so a creative id is
  // optional — but every ad is published BY an identity, which is asked for below.
  requiresCreativeRef: false,
  accountFields: [{
    key: 'adAccountId', label: 'Advertiser ID',
    help: 'The TikTok advertiser account this connection spends on.',
  }, {
    key: 'identityId', label: 'TikTok identity ID', optional: true,
    help: 'The TikTok account an ad is published from. Campaigns and ad groups do not need it; a new ad does.',
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

  // ── Ad groups (this port's ad set) ───────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const data = unwrap(await ask(call, 'list_adgroups', {
      advertiser_id: advertiserId,
      page_size: 1000,
      ...(externalCampaignId ? { filtering: filterBy({ campaign_ids: [externalCampaignId] }) } : {}),
    }));
    return list(data.list).map(rec).map((row) => ({
      externalId: text(row.adgroup_id),
      externalCampaignId: text(row.campaign_id) || null,
      name: text(row.adgroup_name),
      status: toStatus(row.operation_status, row.secondary_status),
      targeting: readTiktokTargeting(row),
      nativeTargeting: {
        location_ids: row.location_ids ?? null,
        age_groups: row.age_groups ?? null,
        gender: row.gender ?? null,
        interest_category_ids: row.interest_category_ids ?? null,
        placements: row.placements ?? null,
      },
      bidStrategy: text(row.bid_type) || text(row.optimization_goal) || null,
      bidCents: toCents(row.bid_price, MAJOR),
      // One budget field again, its meaning set by `budget_mode` — see `listCampaigns`.
      dailyBudgetCents: text(row.budget_mode) === 'BUDGET_MODE_DAY' ? toCents(row.budget, MAJOR) : null,
      currency: identity.currency,
      startsAtISO: toISO(row.schedule_start_time),
      endsAtISO: toISO(row.schedule_end_time),
    } satisfies AdSetRemote));
  },

  async createAdSet(call, fields, draft, identity) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const optimizationGoal = OPTIMIZATION[draft.objective];
    if (!optimizationGoal) {
      throw new AdsProviderError(`TikTok Ads cannot optimize an ad group for "${draft.objective}".`, 400, false);
    }
    const targeting = await targetingFields(call, advertiserId, draft.targeting);
    const daily = fromCents(draft.dailyBudgetCents, MAJOR);
    const bid = fromCents(draft.bidCents, MAJOR);
    const start = tiktokTime(draft.startsAtISO);
    const end = tiktokTime(draft.endsAtISO);

    const data = unwrap(await ask(call, 'create_adgroup', {
      advertiser_id: advertiserId,
      campaign_id: draft.externalCampaignId,
      adgroup_name: draft.name,
      promotion_type: draft.objective === 'app_installs' ? 'APP_ANDROID' : draft.objective === 'leads' ? 'LEAD_GENERATION' : 'WEBSITE',
      optimization_goal: optimizationGoal,
      billing_event: BILLING[draft.objective] ?? 'OCPM',
      operation_status: draft.status === 'active' ? 'ENABLE' : 'DISABLE',
      // An ad group with no placement choice is AUTOMATIC placement, which is TikTok's
      // own default and a real choice — not the same as an unset field.
      placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
      ...targeting,
      ...(daily ? { budget: daily, budget_mode: 'BUDGET_MODE_DAY' } : {}),
      ...(bid ? { bid_price: bid, bid_type: 'BID_TYPE_CUSTOM' } : { bid_type: 'BID_TYPE_NO_BID' }),
      ...(end && start
        ? { schedule_type: 'SCHEDULE_START_END', schedule_start_time: start, schedule_end_time: end }
        : { schedule_type: 'SCHEDULE_FROM_NOW', ...(start ? { schedule_start_time: start } : {}) }),
    }));
    const id = text(data.adgroup_id);
    if (!id) throw new AdsProviderError('TikTok accepted the ad group but did not return its id.', 502, true);

    return {
      externalId: id,
      externalCampaignId: draft.externalCampaignId,
      name: draft.name,
      status: draft.status ?? 'paused',
      targeting: draft.targeting,
      nativeTargeting: targeting,
      bidStrategy: optimizationGoal,
      bidCents: draft.bidCents ?? null,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateAdSet(call, fields, externalId, patch) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const daily = fromCents(patch.dailyBudgetCents, MAJOR);
    const bid = fromCents(patch.bidCents, MAJOR);
    // A REPLACEMENT spec, not a merge — TikTok overwrites each targeting field it is
    // sent, and omitting one leaves the previous value, so a partial merge here would
    // report a spec the ad group does not have.
    const targeting = patch.targeting ? await targetingFields(call, advertiserId, patch.targeting) : {};

    if (patch.name || daily || bid || Object.keys(targeting).length > 0) {
      unwrap(await ask(call, 'update_adgroup', {
        advertiser_id: advertiserId,
        adgroup_id: externalId,
        ...(patch.name ? { adgroup_name: patch.name } : {}),
        ...(daily ? { budget: daily, budget_mode: 'BUDGET_MODE_DAY' } : {}),
        ...(bid ? { bid_price: bid } : {}),
        ...targeting,
      }));
    }
    // Status is its OWN endpoint here too — `adgroup/update` accepts and ignores it.
    if (patch.status) {
      const operation = patch.status === 'active' ? 'ENABLE' : patch.status === 'archived' ? 'DELETE' : 'DISABLE';
      unwrap(await ask(call, 'update_adgroup_status', {
        advertiser_id: advertiserId, adgroup_ids: [externalId], operation_status: operation,
      }));
    }
  },

  // ── Ads ──────────────────────────────────────────────────────────────────

  async listAds(call, fields, _identity, externalAdSetId) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const data = unwrap(await ask(call, 'list_ads', {
      advertiser_id: advertiserId,
      page_size: 1000,
      ...(externalAdSetId ? { filtering: filterBy({ adgroup_ids: [externalAdSetId] }) } : {}),
    }));
    return list(data.list).map(rec).map((row) => ({
      externalId: text(row.ad_id),
      externalAdSetId: text(row.adgroup_id) || null,
      name: text(row.ad_name),
      status: toStatus(row.operation_status, row.secondary_status),
      headline: text(row.ad_text) || null,
      body: text(row.ad_text) || null,
      callToAction: text(row.call_to_action) || null,
      destinationUrl: text(row.landing_page_url) || null,
    } satisfies AdCreativeRemote));
  },

  async createAd(call, fields, draft) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    const link = (draft.destinationUrl ?? '').trim();
    if (!link) throw new AdsProviderError('A TikTok ad needs a landing page URL — that is what the click buys.', 400, false);

    // Every TikTok ad is published BY an identity (the account whose handle appears on
    // it), exactly as every Meta ad is published by a Page. There is no account-level
    // default to fall back on, so it is asked for rather than invented.
    const identityId = (fields.identityId ?? '').trim();
    if (!identityId) {
      throw new AdsProviderError(
        'TikTok needs the identity an ad is published from. Add a TikTok identity ID to this connection.',
        409,
        false,
      );
    }

    const data = unwrap(await ask(call, 'create_ad', {
      advertiser_id: advertiserId,
      adgroup_id: draft.externalAdSetId,
      creatives: [{
        ad_name: draft.name,
        ad_format: 'SINGLE_VIDEO',
        ad_text: draft.body ?? draft.headline ?? draft.name,
        landing_page_url: link,
        identity_id: identityId,
        identity_type: 'CUSTOMIZED_USER',
        ...(draft.callToAction ? { call_to_action: draft.callToAction } : {}),
        // A creative TikTok already holds (a video id), when the ad promotes something
        // that exists rather than new copy.
        ...(draft.creativeRef ? { video_id: draft.creativeRef } : {}),
      }],
    }));
    const id = list(data.ad_ids).map(text).find(Boolean) ?? text(rec(list(data.list)[0]).ad_id);
    if (!id) throw new AdsProviderError('TikTok accepted the ad but did not return its id.', 502, true);

    return {
      externalId: id,
      externalAdSetId: draft.externalAdSetId,
      name: draft.name,
      status: draft.status ?? 'paused',
      headline: draft.headline ?? null,
      body: draft.body ?? null,
      callToAction: draft.callToAction ?? null,
      destinationUrl: link,
    };
  },

  async updateAd(call, fields, externalId, patch) {
    const advertiserId = requireField(fields, 'adAccountId', 'the advertiser ID');
    // Only STATUS is patchable: TikTok re-reviews changed creative text, so a copy edit
    // is a new ad — which `AdPatch` already declines to offer. A rename alone has no
    // endpoint (`ad/update` is a creative replace), so it is not silently claimed.
    if (!patch.status) return;
    const operation = patch.status === 'active' ? 'ENABLE' : patch.status === 'archived' ? 'DELETE' : 'DISABLE';
    unwrap(await ask(call, 'update_ad_status', {
      advertiser_id: advertiserId, ad_ids: [externalId], operation_status: operation,
    }));
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
