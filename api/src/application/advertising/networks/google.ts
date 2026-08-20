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
  AD_MAX_AGE, ageFromBuckets, bucketedAgeKeys, mapTargetingValues, requireTargetingSupport,
  type AdGender, type AdTargeting, type AdTargetingDimension, type AgeBucket,
} from '../adTargeting';
import {
  type AdCall, type AdCreativeRemote, type AdInsightRow, type AdObjective, type AdSetRemote,
  type AdStatus, type AdsProvider,
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

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

/**
 * Google's targeting is spread across THREE resources, and this adapter is where that
 * stops being the caller's problem:
 *
 *   • LOCATION is a `campaign_criterion`. There is no ad-group location criterion, so
 *     asking an ad set for "GB" genuinely changes the parent CAMPAIGN — which is what
 *     the Google Ads UI does too, under campaign settings. Said out loud here rather
 *     than quietly applied, because it affects the campaign's other ad groups.
 *   • AGE and GENDER are `ad_group_criterion` rows, and Google targets them by
 *     EXCLUSION: you cannot say "18-24", you say "not 25-34, not 35-44, …". Getting
 *     that inverted spends the entire budget on precisely the people you excluded.
 *   • INTERESTS on a Search campaign are KEYWORDS, which is the honest mapping — a
 *     search campaign reaches an interest by bidding on what that interest types.
 *
 * Devices and placements are refused: device is a campaign-level bid modifier rather
 * than a filter, and Google's placement equivalent is the network settings already
 * written at campaign creation.
 */
const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = ['geo', 'age', 'gender', 'interests'];

/** Google's age buckets, with the real ages they cover. The top bucket is open-ended;
 *  it is declared as `AD_MAX_AGE` so it lines up with the shared bucket arithmetic. */
const AGE_BUCKETS: readonly AgeBucket[] = [
  { key: 'AGE_RANGE_18_24', min: 18, max: 24 },
  { key: 'AGE_RANGE_25_34', min: 25, max: 34 },
  { key: 'AGE_RANGE_35_44', min: 35, max: 44 },
  { key: 'AGE_RANGE_45_54', min: 45, max: 54 },
  { key: 'AGE_RANGE_55_64', min: 55, max: 64 },
  { key: 'AGE_RANGE_65_UP', min: 65, max: AD_MAX_AGE },
];

const GENDER_TYPES: Readonly<Record<AdGender, string>> = {
  male: 'MALE',
  female: 'FEMALE',
};

/**
 * The buckets Google must EXCLUDE to leave exactly the requested window.
 *
 * Google targets age by exclusion, so the included set is computed first — through the
 * same {@link bucketedAgeKeys} every other bucketed network uses — and everything else
 * is excluded. It previously excluded only the buckets that did not OVERLAP the window,
 * which meant a request for 20-30 excluded nothing and bought 18-34: the silent widening
 * this module exists to prevent, in the one adapter that had its own copy of the
 * arithmetic. An unalignable window is now refused by name here too.
 */
function excludedAgeTypes(targeting: AdTargeting): string[] {
  const included = new Set(bucketedAgeKeys(googleAdsProvider, AGE_BUCKETS, targeting));
  return AGE_BUCKETS.filter((bucket) => !included.has(bucket.key)).map((bucket) => bucket.key);
}

/**
 * Country codes → geo target constant resource names.
 *
 * Google refuses a country CODE outright; the constant id is the only thing it reads.
 * A code that resolves to nothing is REFUSED by name rather than skipped, because a
 * campaign silently missing one of three countries looks like weak demand there.
 */
async function resolveGeoTargets(call: AdCall, countries: readonly string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const country of countries) {
    const suggestions = list((await ask(call, 'suggest_geo_targets', {
      locale: 'en',
      countryCode: country,
      locationNames: { names: [country] },
    })).data).map(rec);
    // The suggest endpoint answers with places INSIDE the country as well, so the
    // country itself is picked by target type rather than by taking the first row.
    const match = suggestions
      .map((entry) => rec(entry.geoTargetConstant))
      .find((constant) => text(constant.targetType).toUpperCase() === 'COUNTRY'
        && text(constant.countryCode).toUpperCase() === country);
    const resourceName = match ? text(match.resourceName) : '';
    if (!resourceName) {
      throw new AdsProviderError(
        `Google Ads did not recognise "${country}" as a location. Locations are ids on Google, not codes — check the country code, or drop the geo dimension.`,
        400,
        false,
      );
    }
    resolved.push(resourceName);
  }
  return resolved;
}

/** Google returns `customers/123/adGroups/456`; every caller here wants the id. */
const idOf = (resourceName: string): string => resourceName.split('/').pop() ?? '';

/** Responsive search ads need at least three headlines and two descriptions, and
 *  Google rejects the whole ad otherwise. Newlines and pipes both separate them, so a
 *  caller can supply the set in the one field the port carries. */
const splitParts = (value: string | null | undefined): string[] =>
  (value ?? '').split(/[\n|]/).map((part) => part.trim()).filter(Boolean);

export const googleAdsProvider: AdsProvider = {
  network: 'google', label: 'Google Ads', connectorKey: 'google-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  targetingDimensions: TARGETING_DIMENSIONS,
  // A Google campaign with no ad group is a legitimate paused shell that Google Ads
  // itself will show; it simply never serves. Nothing is auto-created on its behalf.
  requiresAdSet: false,
  requiresCreativeRef: false,
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

  // ── Ad groups ────────────────────────────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const scope = externalCampaignId ? ` AND campaign.id = ${gaqlString(externalCampaignId)}` : '';
    const rows = await search(call, customer, [
      'SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros,',
      `campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'${scope}`,
    ].join(' '));
    if (rows.length === 0) return [];

    // ONE query for every criterion on the account, grouped in memory. A query per ad
    // group would be the N+1 this codebase forbids, and Google bills query cost.
    const criteria = await search(call, customer, [
      'SELECT ad_group_criterion.ad_group, ad_group_criterion.type, ad_group_criterion.negative,',
      'ad_group_criterion.keyword.text, ad_group_criterion.age_range.type,',
      "ad_group_criterion.gender.type FROM ad_group_criterion WHERE ad_group_criterion.status != 'REMOVED'",
    ].join(' '));

    const keywordsByGroup = new Map<string, string[]>();
    const excludedAgesByGroup = new Map<string, Set<string>>();
    const excludedGendersByGroup = new Map<string, Set<string>>();
    for (const row of criteria) {
      const criterion = rec(row.adGroupCriterion);
      const group = idOf(text(criterion.adGroup));
      if (!group) continue;
      const keyword = text(rec(criterion.keyword).text);
      if (keyword && criterion.negative !== true) {
        keywordsByGroup.set(group, [...(keywordsByGroup.get(group) ?? []), keyword]);
      }
      if (criterion.negative === true) {
        const age = text(rec(criterion.ageRange).type);
        if (age) excludedAgesByGroup.set(group, (excludedAgesByGroup.get(group) ?? new Set()).add(age));
        const gender = text(rec(criterion.gender).type);
        if (gender) excludedGendersByGroup.set(group, (excludedGendersByGroup.get(group) ?? new Set()).add(gender));
      }
    }

    return rows.map((row) => {
      const group = rec(row.adGroup);
      const id = text(group.id);
      const targeting: {
        ageMin?: number; ageMax?: number; genders?: AdGender[]; interests?: string[];
      } = {};

      // Exclusions back into a window: whatever was NOT excluded is what is targeted.
      const excludedAges = excludedAgesByGroup.get(id);
      if (excludedAges?.size) {
        const window = ageFromBuckets(
          AGE_BUCKETS,
          AGE_BUCKETS.filter((bucket) => !excludedAges.has(bucket.key)).map((bucket) => bucket.key),
        );
        if (window) {
          targeting.ageMin = window.min;
          targeting.ageMax = window.max;
        }
      }
      const excludedGenders = excludedGendersByGroup.get(id);
      if (excludedGenders?.size) {
        const included = (Object.entries(GENDER_TYPES) as Array<[AdGender, string]>)
          .filter(([, native]) => !excludedGenders.has(native))
          .map(([ours]) => ours);
        if (included.length && included.length < 2) targeting.genders = included;
      }
      const keywords = keywordsByGroup.get(id);
      if (keywords?.length) targeting.interests = keywords;

      return {
        externalId: id,
        externalCampaignId: text(rec(row.campaign).id) || null,
        name: text(group.name),
        status: toStatus(group.status),
        targeting,
        nativeTargeting: { keywords: keywords ?? [], excludedAgeRanges: [...(excludedAges ?? [])], excludedGenders: [...(excludedGenders ?? [])] },
        bidStrategy: 'cpc',
        bidCents: toCents(group.cpcBidMicros, MICROS),
        dailyBudgetCents: null,
        currency: identity.currency,
        // Google schedules at the campaign level; an ad group has no dates of its own,
        // and inventing the campaign's would report a fact the ad group does not hold.
        startsAtISO: null,
        endsAtISO: null,
      } satisfies AdSetRemote;
    });
  },

  async createAdSet(call, fields, draft, identity) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    requireTargetingSupport(googleAdsProvider, draft.targeting);
    const bidMicros = fromCents(draft.bidCents, MICROS);

    const results = list((await ask(call, 'mutate_ad_groups', {
      customer_id: customer,
      operations: [{
        create: {
          name: draft.name,
          campaign: `customers/${customer}/campaigns/${draft.externalCampaignId}`,
          status: fromStatus(draft.status) ?? 'PAUSED',
          type: 'SEARCH_STANDARD',
          ...(bidMicros ? { cpcBidMicros: String(bidMicros) } : {}),
        },
      }],
    })).data);
    const adGroupResource = text(rec(results[0]).resourceName);
    const id = idOf(adGroupResource);
    if (!id) throw new AdsProviderError('Google Ads accepted the ad group but did not return its id.', 502, true);

    // Criteria are a SECOND mutate against a different resource. The ad group is
    // created first because a criterion needs its resource name, which means a failure
    // here leaves an untargeted ad group — PAUSED by default, so it cannot spend on
    // the wrong audience while somebody works out what went wrong.
    const criteria: Array<Record<string, unknown>> = [];
    for (const ageType of excludedAgeTypes(draft.targeting)) {
      criteria.push({ create: { adGroup: adGroupResource, negative: true, ageRange: { type: ageType } } });
    }
    if (draft.targeting.genders?.length) {
      const wanted = new Set(mapTargetingValues(googleAdsProvider, 'gender', GENDER_TYPES, draft.targeting.genders));
      for (const native of Object.values(GENDER_TYPES)) {
        if (!wanted.has(native)) criteria.push({ create: { adGroup: adGroupResource, negative: true, gender: { type: native } } });
      }
      // Google counts "we could not tell" as its own gender, and leaving it targeted
      // is how a female-only campaign reaches half its impressions on unknown users.
      criteria.push({ create: { adGroup: adGroupResource, negative: true, gender: { type: 'UNDETERMINED' } } });
    }
    for (const phrase of draft.targeting.interests ?? []) {
      criteria.push({ create: { adGroup: adGroupResource, keyword: { text: phrase, matchType: 'PHRASE' } } });
    }
    if (criteria.length) await ask(call, 'mutate_ad_group_criteria', { customer_id: customer, operations: criteria });

    // Location is CAMPAIGN-scoped on Google — this is applied to the parent, which the
    // port documents rather than hides, because it also moves the campaign's other
    // ad groups.
    if (draft.targeting.countries?.length) {
      const geoTargets = await resolveGeoTargets(call, draft.targeting.countries);
      await ask(call, 'mutate_campaign_criteria', {
        customer_id: customer,
        operations: geoTargets.map((geoTargetConstant) => ({
          create: { campaign: `customers/${customer}/campaigns/${draft.externalCampaignId}`, location: { geoTargetConstant } },
        })),
      });
    }

    return {
      externalId: id,
      externalCampaignId: draft.externalCampaignId,
      name: draft.name,
      status: draft.status ?? 'paused',
      targeting: draft.targeting,
      nativeTargeting: { operations: criteria.length },
      bidStrategy: 'cpc',
      bidCents: draft.bidCents ?? null,
      dailyBudgetCents: null,
      currency: identity.currency,
      startsAtISO: null,
      endsAtISO: null,
    };
  },

  async updateAdSet(call, fields, externalId, patch) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const status = fromStatus(patch.status);
    const bidMicros = fromCents(patch.bidCents, MICROS);
    const update: Record<string, unknown> = { resourceName: `customers/${customer}/adGroups/${externalId}` };
    const paths: string[] = [];
    if (patch.name) { update.name = patch.name; paths.push('name'); }
    if (status) { update.status = status; paths.push('status'); }
    if (bidMicros) { update.cpcBidMicros = String(bidMicros); paths.push('cpc_bid_micros'); }
    if (paths.length) {
      await ask(call, 'mutate_ad_groups', { customer_id: customer, operations: [{ update, updateMask: paths.join(',') }] });
    }
    if (patch.targeting) {
      // Google has no "replace all criteria" call, and adding a second, contradictory
      // set would leave the ad group targeting the UNION of both. Refusing names what
      // to do instead rather than half-applying a retarget.
      throw new AdsProviderError(
        'Google Ads cannot replace an ad group’s targeting in one call — criteria are separate rows, and adding new ones widens the audience instead of narrowing it. Create a new ad group with the targeting you want and pause this one.',
        400,
        false,
      );
    }
  },

  // ── Ads ──────────────────────────────────────────────────────────────────

  async listAds(call, fields, _identity, externalAdSetId) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const scope = externalAdSetId ? ` AND ad_group.id = ${gaqlString(externalAdSetId)}` : '';
    const rows = await search(call, customer, [
      'SELECT ad_group_ad.resource_name, ad_group_ad.ad.id, ad_group_ad.ad.name,',
      'ad_group_ad.status, ad_group_ad.ad.final_urls,',
      'ad_group_ad.ad.responsive_search_ad.headlines,',
      'ad_group_ad.ad.responsive_search_ad.descriptions, ad_group.id FROM ad_group_ad',
      `WHERE ad_group_ad.status != 'REMOVED'${scope}`,
    ].join(' '));
    return rows.map((row) => {
      const adGroupAd = rec(row.adGroupAd);
      const ad = rec(adGroupAd.ad);
      const rsa = rec(ad.responsiveSearchAd);
      const headlines = list(rsa.headlines).map((entry) => text(rec(entry).text)).filter(Boolean);
      const descriptions = list(rsa.descriptions).map((entry) => text(rec(entry).text)).filter(Boolean);
      return {
        // The COMPOSITE `adGroupId~adId`, which is what `adGroupAds` is addressed by and
        // what `createAd` below already returns. The bare `ad.id` cannot be updated:
        // Google has no `adGroupAds/{adId}` resource, so storing it would produce ids
        // that read back fine and 404 on the first pause.
        externalId: idOf(text(adGroupAd.resourceName)) || text(ad.id),
        externalAdSetId: text(rec(row.adGroup).id) || null,
        name: text(ad.name) || headlines[0] || text(ad.id),
        status: toStatus(adGroupAd.status),
        headline: headlines.join('\n') || null,
        body: descriptions.join('\n') || null,
        callToAction: null,
        destinationUrl: list(ad.finalUrls).map(text).find(Boolean) ?? null,
      } satisfies AdCreativeRemote;
    });
  },

  async createAd(call, fields, draft) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const link = (draft.destinationUrl ?? '').trim();
    if (!link) throw new AdsProviderError('A Google Ads search ad needs a final URL — that is what the click buys.', 400, false);

    const headlines = splitParts(draft.headline);
    const descriptions = splitParts(draft.body);
    if (headlines.length < 3 || descriptions.length < 2) {
      // Google's own minimum, refused here by name rather than as a vendor error code —
      // and never padded with generated copy, which would put words nobody wrote in
      // front of a paying audience.
      throw new AdsProviderError(
        'A Google responsive search ad needs at least 3 headlines (30 characters each) and 2 descriptions (90 characters each). '
        + 'Separate them with newlines or | in the headline and body fields.',
        400,
        false,
      );
    }

    const results = list((await ask(call, 'mutate_ad_group_ads', {
      customer_id: customer,
      operations: [{
        create: {
          adGroup: `customers/${customer}/adGroups/${draft.externalAdSetId}`,
          status: fromStatus(draft.status) ?? 'PAUSED',
          ad: {
            ...(draft.name ? { name: draft.name } : {}),
            finalUrls: [link],
            responsiveSearchAd: {
              headlines: headlines.slice(0, 15).map((headline) => ({ text: headline.slice(0, 30) })),
              descriptions: descriptions.slice(0, 4).map((description) => ({ text: description.slice(0, 90) })),
            },
          },
        },
      }],
    })).data);
    const id = idOf(text(rec(results[0]).resourceName));
    if (!id) throw new AdsProviderError('Google Ads accepted the ad but did not return its id.', 502, true);

    return {
      externalId: id,
      externalAdSetId: draft.externalAdSetId,
      name: draft.name,
      status: draft.status ?? 'paused',
      headline: headlines.join('\n'),
      body: descriptions.join('\n'),
      callToAction: draft.callToAction ?? null,
      destinationUrl: link,
    };
  },

  async updateAd(call, fields, externalId, patch) {
    const customer = customerId(requireField(fields, 'adAccountId', 'the customer ID'));
    const status = fromStatus(patch.status);
    // Only STATUS is patchable. Google re-reviews changed creative text, so a copy
    // edit is a new ad — which `AdPatch` already declines to offer.
    if (!status) return;
    await ask(call, 'mutate_ad_group_ads', {
      customer_id: customer,
      operations: [{
        update: { resourceName: `customers/${customer}/adGroupAds/${externalId}`, status },
        updateMask: 'status',
      }],
    });
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
