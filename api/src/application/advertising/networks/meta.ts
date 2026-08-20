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
  AdsProviderError, ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO, unmapObjective,
} from '../adsNormalize';
import {
  ageWindow, mapTargetingValues, requireTargetingSupport,
  type AdDevice, type AdGender, type AdPlacement, type AdTargeting, type AdTargetingDimension,
} from '../adTargeting';
import {
  type AdCall, type AdCampaignDraft, type AdCampaignPatch, type AdCampaignRemote, type AdCreativeRemote,
  type AdInsightRow, type AdObjective, type AdSetRemote, type AdStatus, type AdsProvider,
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

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

/** Meta encodes gender as a magic number, and has done since 2012. */
const GENDERS: Readonly<Record<AdGender, number>> = { male: 1, female: 2 };

/**
 * Placements → Meta positions.
 *
 * `audience_network` is the odd one: on Meta it is a PUBLISHER PLATFORM, not a position
 * within Facebook, so it is handled separately below rather than forced into this table.
 */
const POSITIONS: Readonly<Record<Exclude<AdPlacement, 'audience_network'>, string>> = {
  feed: 'feed',
  stories: 'story',
  video: 'video_feeds',
  search: 'search',
};

/** Meta's `device_platforms` is exactly two values. A tablet request is REFUSED rather
 *  than folded into `mobile`: "reach tablet users" answered with a phone campaign is a
 *  wrong audience bought at full price. */
const DEVICES: Readonly<Record<AdDevice, string | undefined>> = {
  mobile: 'mobile',
  desktop: 'desktop',
  tablet: undefined,
};

const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = ['geo', 'age', 'gender', 'interests', 'placements', 'devices'];

/**
 * Interest PHRASES → Meta interest ids.
 *
 * Meta accepts `{"name":"Cycling"}` in a flexible spec and matches nobody with it — the
 * id is the only field it reads. So a phrase that resolves to nothing is REFUSED by
 * name; sending it anyway would produce a campaign that is technically targeted and
 * practically untargeted, which reads as "our audience just didn't convert".
 */
async function resolveInterests(call: AdCall, phrases: readonly string[]): Promise<Array<{ id: string; name: string }>> {
  const resolved: Array<{ id: string; name: string }> = [];
  for (const phrase of phrases) {
    const hits = list((await ask(call, 'search_targeting', { type: 'adinterest', q: phrase, limit: 1 })).data).map(rec);
    const hit = hits[0];
    const id = hit ? text(hit.id) : '';
    if (!id) {
      throw new AdsProviderError(
        `Meta has no interest matching "${phrase}". Interests are ids on Meta, not free text — pick a phrase it recognises, or drop the interest dimension.`,
        400,
        false,
      );
    }
    resolved.push({ id, name: text(hit?.name) || phrase });
  }
  return resolved;
}

/** Our vocabulary → Meta's targeting spec. Refuses first, builds second. */
async function targetingSpec(call: AdCall, targeting: AdTargeting): Promise<Record<string, unknown>> {
  requireTargetingSupport(metaAdsProvider, targeting);
  const spec: Record<string, unknown> = {};

  if (targeting.countries?.length) spec.geo_locations = { countries: [...targeting.countries] };
  if (targeting.ageMin != null || targeting.ageMax != null) {
    const window = ageWindow(targeting);
    spec.age_min = window.min;
    spec.age_max = window.max;
  }
  if (targeting.genders?.length) {
    spec.genders = mapTargetingValues(metaAdsProvider, 'gender', GENDERS, targeting.genders);
  }
  if (targeting.interests?.length) {
    spec.flexible_spec = [{ interests: await resolveInterests(call, targeting.interests) }];
  }
  if (targeting.placements?.length) {
    const platforms = new Set<string>();
    const positions = targeting.placements.filter((placement) => placement !== 'audience_network');
    if (positions.length) {
      platforms.add('facebook');
      platforms.add('instagram');
      spec.facebook_positions = mapTargetingValues(metaAdsProvider, 'placements', POSITIONS, positions);
    }
    if (targeting.placements.includes('audience_network')) platforms.add('audience_network');
    spec.publisher_platforms = [...platforms];
  }
  if (targeting.devices?.length) {
    spec.device_platforms = mapTargetingValues(metaAdsProvider, 'devices', DEVICES, targeting.devices);
  }
  return spec;
}

/** Meta's spec → as much of our vocabulary as it contains. Never throws: a set made in
 *  Ads Manager carries custom audiences this port has no name for, and reporting the
 *  half we understand beats reporting nothing. */
function readMetaTargeting(raw: unknown): AdTargeting {
  const spec = rec(raw);
  const targeting: {
    countries?: string[]; ageMin?: number; ageMax?: number;
    genders?: AdGender[]; interests?: string[]; placements?: AdPlacement[]; devices?: AdDevice[];
  } = {};

  const countries = list(rec(spec.geo_locations).countries).map(text).filter(Boolean);
  if (countries.length) targeting.countries = countries;
  if (Number.isFinite(Number(spec.age_min))) targeting.ageMin = Number(spec.age_min);
  if (Number.isFinite(Number(spec.age_max))) targeting.ageMax = Number(spec.age_max);

  const genders = list(spec.genders)
    .map((value) => (Number(value) === 1 ? 'male' : Number(value) === 2 ? 'female' : null))
    .filter((value): value is AdGender => value != null);
  if (genders.length) targeting.genders = genders;

  const interests = list(spec.flexible_spec)
    .flatMap((entry) => list(rec(entry).interests).map((interest) => text(rec(interest).name)))
    .filter(Boolean);
  if (interests.length) targeting.interests = interests;

  const byPosition = new Map(Object.entries(POSITIONS).map(([ours, theirs]) => [theirs, ours as AdPlacement]));
  const placements = list(spec.facebook_positions)
    .map((value) => byPosition.get(text(value)))
    .filter((value): value is AdPlacement => value != null);
  if (list(spec.publisher_platforms).map(text).includes('audience_network')) placements.push('audience_network');
  if (placements.length) targeting.placements = [...new Set(placements)];

  const devices = list(spec.device_platforms)
    .map(text)
    .filter((value): value is AdDevice => value === 'mobile' || value === 'desktop');
  if (devices.length) targeting.devices = devices;

  return targeting;
}

/** Objective → what Meta optimizes an ad set's delivery FOR. An ad set with the wrong
 *  optimization goal delivers, reports, and buys the wrong thing. */
const OPTIMIZATION: Partial<Record<AdObjective, string>> = {
  awareness: 'REACH',
  traffic: 'LINK_CLICKS',
  engagement: 'POST_ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  conversions: 'OFFSITE_CONVERSIONS',
  app_installs: 'APP_INSTALLS',
};

/** What Meta CHARGES for. Impressions everywhere except traffic, where paying per
 *  click is what the objective actually asked for. */
const BILLING: Partial<Record<AdObjective, string>> = { traffic: 'LINK_CLICKS' };

const AD_SET_FIELDS = 'id,name,campaign_id,status,daily_budget,lifetime_budget,bid_amount,bid_strategy,billing_event,optimization_goal,targeting,start_time,end_time';
const AD_FIELDS = 'id,name,adset_id,status,creative{id,title,body,object_story_spec}';

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
  targetingDimensions: TARGETING_DIMENSIONS,
  // A Meta campaign with no ad set is a valid draft: it holds the budget and the
  // objective, and Ads Manager shows it. It simply never delivers until one exists.
  requiresAdSet: false,
  requiresCreativeRef: false,
  accountFields: [{
    key: 'adAccountId', label: 'Ad account ID',
    help: 'Including the act_ prefix — the Meta account the spend is billed to.',
  }, {
    key: 'pageId', label: 'Facebook Page ID', optional: true,
    help: 'The Page an ad is published from. Campaigns and ad sets do not need it; a new ad creative does.',
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

  // ── Ad sets ──────────────────────────────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_adsets', { ad_account_id: accountId, fields: AD_SET_FIELDS, limit: 500 })).data).map(rec);
    // Meta has no `campaign_id` filter on the account-level edge, so the scope is
    // applied here — one call for the account still beats one call per campaign.
    const scoped = externalCampaignId ? rows.filter((row) => text(row.campaign_id) === externalCampaignId) : rows;
    return scoped.map((row) => ({
      externalId: text(row.id),
      externalCampaignId: text(row.campaign_id) || null,
      name: text(row.name),
      status: toStatus(row.status),
      targeting: readMetaTargeting(row.targeting),
      nativeTargeting: row.targeting ?? null,
      bidStrategy: text(row.bid_strategy) || text(row.optimization_goal) || null,
      bidCents: toCents(row.bid_amount, BUDGET_SCALE),
      dailyBudgetCents: toCents(row.daily_budget, BUDGET_SCALE),
      currency: identity.currency,
      startsAtISO: toISO(row.start_time),
      endsAtISO: toISO(row.end_time),
    } satisfies AdSetRemote));
  },

  async createAdSet(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const targeting = await targetingSpec(call, draft.targeting);
    const optimizationGoal = OPTIMIZATION[draft.objective];
    if (!optimizationGoal) {
      throw new AdsProviderError(`Meta Ads cannot optimize an ad set for "${draft.objective}".`, 400, false);
    }
    const daily = fromCents(draft.dailyBudgetCents, BUDGET_SCALE);
    const bid = fromCents(draft.bidCents, BUDGET_SCALE);

    const created = rec((await ask(call, 'create_adset', {
      ad_account_id: accountId,
      campaign_id: draft.externalCampaignId,
      name: draft.name,
      status: fromStatus(draft.status) ?? 'PAUSED',
      optimization_goal: optimizationGoal,
      billing_event: BILLING[draft.objective] ?? 'IMPRESSIONS',
      // Meta REQUIRES a targeting object. An empty one means "everyone", which is a
      // real choice; omitting the key entirely is a 400 with an unhelpful message.
      targeting,
      ...(daily ? { daily_budget: daily } : {}),
      ...(bid ? { bid_amount: bid } : {}),
      ...(draft.startsAtISO ? { start_time: draft.startsAtISO } : {}),
      ...(draft.endsAtISO ? { end_time: draft.endsAtISO } : {}),
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('Meta accepted the ad set but did not return its id.', 502, true);

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

  async updateAdSet(call, _fields, externalId, patch) {
    const status = fromStatus(patch.status);
    const daily = fromCents(patch.dailyBudgetCents, BUDGET_SCALE);
    const bid = fromCents(patch.bidCents, BUDGET_SCALE);
    // A REPLACEMENT spec, not a merge — Meta replaces the whole targeting object, and
    // pretending otherwise would silently drop every dimension the caller left out.
    const targeting = patch.targeting ? await targetingSpec(call, patch.targeting) : undefined;
    await ask(call, 'update_adset', {
      adset_id: externalId,
      ...(patch.name ? { name: patch.name } : {}),
      ...(status ? { status } : {}),
      ...(daily ? { daily_budget: daily } : {}),
      ...(bid ? { bid_amount: bid } : {}),
      ...(targeting ? { targeting } : {}),
    });
  },

  // ── Ads ──────────────────────────────────────────────────────────────────

  async listAds(call, fields, _identity, externalAdSetId) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_ads', { ad_account_id: accountId, fields: AD_FIELDS, limit: 500 })).data).map(rec);
    const scoped = externalAdSetId ? rows.filter((row) => text(row.adset_id) === externalAdSetId) : rows;
    return scoped.map((row) => {
      const creative = rec(row.creative);
      const linkData = rec(rec(creative.object_story_spec).link_data);
      return {
        externalId: text(row.id),
        externalAdSetId: text(row.adset_id) || null,
        name: text(row.name),
        status: toStatus(row.status),
        headline: text(creative.title) || text(linkData.name) || null,
        body: text(creative.body) || text(linkData.message) || null,
        callToAction: text(rec(linkData.call_to_action).type) || null,
        destinationUrl: text(linkData.link) || null,
      } satisfies AdCreativeRemote;
    });
  },

  async createAd(call, fields, draft) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');

    // An ad points at a CREATIVE. Either the caller already has one, or one is authored
    // here — and authoring needs the Page, because on Meta every ad is published BY a
    // Page rather than by an account.
    let creativeId = (draft.creativeRef ?? '').trim();
    if (!creativeId) {
      const pageId = (fields.pageId ?? '').trim();
      if (!pageId) {
        throw new AdsProviderError(
          'Meta needs the Facebook Page an ad is published from. Add a Page ID to this connection, or pass an existing creative id as creativeRef.',
          409,
          false,
        );
      }
      const link = (draft.destinationUrl ?? '').trim();
      if (!link) throw new AdsProviderError('A Meta ad needs a destination URL — that is what the click buys.', 400, false);
      const creative = rec((await ask(call, 'create_ad_creative', {
        ad_account_id: accountId,
        name: `${draft.name} creative`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            link,
            name: draft.headline ?? draft.name,
            ...(draft.body ? { message: draft.body } : {}),
            ...(draft.callToAction ? { call_to_action: { type: draft.callToAction, value: { link } } } : {}),
          },
        },
      })).data);
      creativeId = text(creative.id);
      if (!creativeId) throw new AdsProviderError('Meta accepted the creative but did not return its id.', 502, true);
    }

    const created = rec((await ask(call, 'create_ad', {
      ad_account_id: accountId,
      name: draft.name,
      adset_id: draft.externalAdSetId,
      creative: { creative_id: creativeId },
      status: fromStatus(draft.status) ?? 'PAUSED',
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('Meta accepted the ad but did not return its id.', 502, true);

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

  async updateAd(call, _fields, externalId, patch) {
    const status = fromStatus(patch.status);
    await ask(call, 'update_ad', {
      ad_id: externalId,
      ...(patch.name ? { name: patch.name } : {}),
      ...(status ? { status } : {}),
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
