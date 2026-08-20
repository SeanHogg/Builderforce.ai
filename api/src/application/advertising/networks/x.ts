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
  ageWindow, mapTargetingValues, requireTargetingSupport,
  type AdDevice, type AdGender, type AdPlacement, type AdTargeting, type AdTargetingDimension,
} from '../adTargeting';
import {
  type AdCall, type AdCreativeRemote, type AdInsightRow, type AdObjective, type AdSetRemote,
  type AdStatus, type AdsProvider,
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

/**
 * Placements → X's own surfaces, declared on the LINE ITEM (not as criterion rows).
 *
 * X has no stories or video-feed placement to buy, so both are REFUSED by name rather
 * than folded into the timeline.
 */
const PLACEMENTS: Readonly<Record<AdPlacement, string | undefined>> = {
  feed: 'TWITTER_TIMELINE',
  search: 'TWITTER_SEARCH',
  audience_network: 'PUBLISHER_NETWORK',
  stories: undefined,
  video: undefined,
};

/** X's gender criterion is a numeric code, not a word. */
const GENDERS: Readonly<Record<AdGender, string>> = { male: '1', female: '2' };

/**
 * What X can place THROUGH THIS ADAPTER.
 *
 * `interests` and `devices` are absent for the same reason: both are id-valued criteria
 * on X, and the ads manifest carries a lookup for locations only. Declaring a dimension
 * whose values this adapter would have to guess at is exactly the silent-mistarget this
 * vocabulary exists to prevent, so they are refused by name instead.
 */
const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = ['geo', 'age', 'gender', 'placements'];

/**
 * X's contiguous age BUCKETS, as [inclusive min, inclusive max] in this port's terms.
 *
 * X sells no audience under 18, so a window starting at `AD_MIN_AGE` does not align and
 * is refused with the boundaries that do work — rather than quietly buying 18+.
 */
const AGE_BUCKETS: ReadonlyArray<{ readonly key: string; readonly min: number; readonly max: number }> = [
  { key: 'AGE_18_24', min: 18, max: 24 },
  { key: 'AGE_25_34', min: 25, max: 34 },
  { key: 'AGE_35_44', min: 35, max: 44 },
  { key: 'AGE_45_54', min: 45, max: 54 },
  { key: 'AGE_55_64', min: 55, max: 64 },
  { key: 'AGE_OVER_65', min: 65, max: 65 },
];

/** An age window → the X buckets that are exactly it, or a refusal. Same contract as
 *  every other bucketed network: never rounded outwards. */
function ageBuckets(targeting: AdTargeting): string[] {
  const { min, max } = ageWindow(targeting);
  const first = AGE_BUCKETS.findIndex((bucket) => bucket.min === min);
  const last = AGE_BUCKETS.findIndex((bucket) => bucket.max === max);
  if (first === -1 || last === -1 || first > last) {
    throw new AdsProviderError(
      `X sells age in fixed buckets, so it cannot target exactly ${min}-${max}. `
      + `Use a window starting on one of ${AGE_BUCKETS.map((b) => b.min).join(', ')} and `
      + `ending on one of ${AGE_BUCKETS.map((b) => b.max).join(', ')} — it will not be rounded outwards.`,
      400,
      false,
    );
  }
  return AGE_BUCKETS.slice(first, last + 1).map((bucket) => bucket.key);
}

/**
 * Country codes → the location targeting VALUES X requires.
 *
 * X takes an opaque location value, never a country code, and a criterion row carrying
 * an unknown one is rejected for the whole batch — so every code is resolved up front
 * and an unresolvable one is refused by name.
 */
async function resolveLocationValues(call: AdCall, countries: readonly string[]): Promise<string[]> {
  const values: string[] = [];
  for (const country of countries) {
    const hits = list((await ask(call, 'list_targeting_locations', {
      country_code: country.toUpperCase(), location_type: 'COUNTRY', count: 10,
    })).data).map(rec);
    const hit = hits.find((row) => text(row.country_code).toUpperCase() === country.toUpperCase()) ?? hits[0];
    const value = hit ? text(hit.targeting_value) : '';
    if (!value) {
      throw new AdsProviderError(
        `X does not sell ads in "${country}". Drop that country or choose another network — it will not be skipped silently.`,
        400,
        false,
      );
    }
    values.push(value);
  }
  return values;
}

/** One criterion row in X's batch shape. */
interface TargetingCriterion { targeting_type: string; targeting_value: string }

/** Our spec → the criterion rows X attaches to a line item. Refuses before it writes. */
async function criteriaFor(call: AdCall, targeting: AdTargeting): Promise<TargetingCriterion[]> {
  requireTargetingSupport(xAdsProvider, targeting);
  const criteria: TargetingCriterion[] = [];

  if (targeting.countries?.length) {
    for (const value of await resolveLocationValues(call, targeting.countries)) {
      criteria.push({ targeting_type: 'LOCATION', targeting_value: value });
    }
  }
  if (targeting.ageMin != null || targeting.ageMax != null) {
    for (const bucket of ageBuckets(targeting)) {
      criteria.push({ targeting_type: 'AGE', targeting_value: bucket });
    }
  }
  if (targeting.genders?.length) {
    for (const value of mapTargetingValues(xAdsProvider, 'gender', GENDERS, targeting.genders)) {
      criteria.push({ targeting_type: 'GENDER', targeting_value: value });
    }
  }
  return criteria;
}

/** X's criterion rows for ONE line item → as much of our vocabulary as they hold. */
function readXTargeting(rows: readonly Record<string, unknown>[], placements: readonly string[]): AdTargeting {
  const targeting: {
    countries?: string[]; ageMin?: number; ageMax?: number;
    genders?: AdGender[]; interests?: string[]; placements?: AdPlacement[]; devices?: AdDevice[];
  } = {};

  const ages = rows.filter((row) => text(row.targeting_type).toUpperCase() === 'AGE').map((row) => text(row.targeting_value));
  const known = AGE_BUCKETS.filter((bucket) => ages.includes(bucket.key));
  if (known.length) {
    targeting.ageMin = Math.min(...known.map((b) => b.min));
    targeting.ageMax = Math.max(...known.map((b) => b.max));
  }

  const genders = rows
    .filter((row) => text(row.targeting_type).toUpperCase() === 'GENDER')
    .map((row) => (text(row.targeting_value) === '1' ? 'male' : text(row.targeting_value) === '2' ? 'female' : null))
    .filter((value): value is AdGender => value != null);
  if (genders.length) targeting.genders = genders;

  // A LOCATION criterion carries X's opaque value, not a country code, and this read
  // path performs no reverse lookup — so geography travels in `nativeTargeting` instead
  // of being reported as a country this adapter did not actually confirm.

  const byNative = new Map(
    Object.entries(PLACEMENTS)
      .filter((entry): entry is [AdPlacement, string] => entry[1] != null)
      .map(([ours, theirs]) => [theirs, ours]),
  );
  const mapped = placements
    .map((value) => byNative.get(value.toUpperCase()))
    .filter((value): value is AdPlacement => value != null);
  if (mapped.length) targeting.placements = mapped;

  return targeting;
}

/** The line item's `placements`, or X's own everywhere-on-X default. */
function placementsFor(targeting: AdTargeting): string[] {
  if (!targeting.placements?.length) return ['ALL_ON_TWITTER'];
  return mapTargetingValues(xAdsProvider, 'placements', PLACEMENTS, targeting.placements);
}

export const xAdsProvider: AdsProvider = {
  network: 'x', label: 'X Ads', connectorKey: 'x-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  targetingDimensions: TARGETING_DIMENSIONS,
  /**
   * An X campaign is a budget and a schedule and nothing else — the OBJECTIVE lives on
   * the line item. A campaign with nothing beneath it is funded, inert, and reports no
   * number, so `adsService` composes a default line item through `createAdSet`.
   */
  requiresAdSet: true,
  /**
   * X promotes EXISTING posts. `create_promoted_tweet` takes post ids; there is no
   * endpoint that authors ad copy, so a `creativeRef` is required and asked for up
   * front rather than discovered as a vendor error at spend time.
   */
  requiresCreativeRef: true,
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
    // Mapped here even though the line item is what carries it, so an objective X cannot
    // serve is refused BEFORE a campaign exists rather than after one has been created.
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

    // The line item that carries the objective is NOT created here: `requiresAdSet`
    // declares the need and `adsService` composes one through the same `createAdSet`
    // every other caller uses. It was an inline copy, which is how the default line item
    // came to be built differently from every line item made afterwards.

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

  // ── Line items (this port's ad set) ──────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const rows = list((await ask(call, 'list_line_items', {
      account_id: accountId,
      count: 1000,
      ...(externalCampaignId ? { campaign_ids: externalCampaignId } : {}),
    })).data).map(rec);
    if (rows.length === 0) return [];

    // ONE call for every criterion on these line items, grouped in memory. A request per
    // line item is the N+1 this codebase forbids, and X caps `line_item_ids` at a list.
    const criteria = list((await ask(call, 'list_targeting_criteria', {
      account_id: accountId,
      line_item_ids: rows.map((row) => text(row.id)).filter(Boolean).join(','),
      count: 1000,
    })).data).map(rec);
    const byLineItem = new Map<string, Record<string, unknown>[]>();
    for (const criterion of criteria) {
      const lineItemId = text(criterion.line_item_id);
      if (!lineItemId) continue;
      const bucket = byLineItem.get(lineItemId) ?? [];
      bucket.push(criterion);
      byLineItem.set(lineItemId, bucket);
    }

    return rows.map((row) => {
      const id = text(row.id);
      const placements = list(row.placements).map(text);
      return {
        externalId: id,
        externalCampaignId: text(row.campaign_id) || null,
        name: text(row.name),
        status: toStatus(row.entity_status),
        targeting: readXTargeting(byLineItem.get(id) ?? [], placements),
        nativeTargeting: { placements, criteria: byLineItem.get(id) ?? [] },
        bidStrategy: text(row.objective) || null,
        bidCents: toCents(row.bid_amount_local_micro, MICROS),
        // The budget lives on the CAMPAIGN on X. Reporting the campaign's rate here
        // would double-count it on an account with several line items.
        dailyBudgetCents: null,
        currency: identity.currency,
        startsAtISO: toISO(row.start_time),
        endsAtISO: toISO(row.end_time),
      } satisfies AdSetRemote;
    });
  },

  async createAdSet(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const objective = mapObjective(xAdsProvider, OBJECTIVES, draft.objective);
    // Resolved BEFORE the line item exists, so an unplaceable dimension refuses without
    // leaving an untargeted line item behind it.
    const criteria = await criteriaFor(call, draft.targeting);
    const bid = fromCents(draft.bidCents, MICROS);

    const created = rec((await ask(call, 'create_line_item', {
      account_id: accountId,
      campaign_id: draft.externalCampaignId,
      name: draft.name,
      objective,
      product_type: 'PROMOTED_TWEETS',
      placements: placementsFor(draft.targeting),
      entity_status: fromStatus(draft.status) ?? 'PAUSED',
      ...(bid ? { bid_amount_local_micro: bid } : {}),
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('X accepted the line item but did not return its id.', 502, true);

    if (criteria.length) {
      await ask(call, 'create_targeting_criteria', {
        account_id: accountId,
        operations: criteria.map((criterion) => ({
          operation_type: 'Create',
          params: { line_item_id: id, ...criterion },
        })),
      });
    }

    return {
      externalId: id,
      externalCampaignId: draft.externalCampaignId,
      name: draft.name,
      status: draft.status ?? 'paused',
      targeting: draft.targeting,
      nativeTargeting: { placements: placementsFor(draft.targeting), criteria },
      bidStrategy: objective,
      bidCents: draft.bidCents ?? null,
      dailyBudgetCents: null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateAdSet(call, fields, externalId, patch) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const entityStatus = fromStatus(patch.status);
    const bid = fromCents(patch.bidCents, MICROS);

    if (patch.name || entityStatus || bid || patch.targeting) {
      await ask(call, 'update_line_item', {
        account_id: accountId,
        line_item_id: externalId,
        ...(patch.name ? { name: patch.name } : {}),
        ...(entityStatus ? { entity_status: entityStatus } : {}),
        ...(bid ? { bid_amount_local_micro: bid } : {}),
        // Placements live on the line item itself, so a targeting replacement rewrites
        // them here and the criterion rows below.
        ...(patch.targeting ? { placements: placementsFor(patch.targeting) } : {}),
      });
    }
    if (!patch.targeting) return;

    /*
     * A REPLACEMENT spec, not a merge — and on X that has to be spelled out, because
     * targeting is a COLLECTION of criterion rows rather than one object. Creating the
     * new rows without deleting the old ones would UNION the two audiences: a campaign
     * re-targeted from Germany to France would run in both, at the full budget, and
     * every report would look healthy.
     */
    const existing = list((await ask(call, 'list_targeting_criteria', {
      account_id: accountId, line_item_ids: externalId, count: 1000,
    })).data).map(rec);
    const criteria = await criteriaFor(call, patch.targeting);

    const operations = [
      ...existing
        .map((row) => text(row.id))
        .filter(Boolean)
        .map((id) => ({ operation_type: 'Delete', params: { targeting_criterion_id: id } })),
      ...criteria.map((criterion) => ({
        operation_type: 'Create',
        params: { line_item_id: externalId, ...criterion },
      })),
    ];
    // One batch, so the delete and the create either both land or neither does — a
    // half-applied replacement is the untargeted line item this guards against.
    if (operations.length) await ask(call, 'create_targeting_criteria', { account_id: accountId, operations });
  },

  // ── Promoted posts (this port's ad) ──────────────────────────────────────

  async listAds(call, fields, _identity, externalAdSetId) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const rows = list((await ask(call, 'list_promoted_tweets', {
      account_id: accountId,
      count: 1000,
      ...(externalAdSetId ? { line_item_ids: externalAdSetId } : {}),
    })).data).map(rec);
    return rows.map((row) => ({
      externalId: text(row.id),
      externalAdSetId: text(row.line_item_id) || null,
      // A promoted post has no name of its own on X — it IS the post. Naming it by the
      // post id is the honest label; inventing one would put a title on a surface that
      // does not have it.
      name: `Post ${text(row.tweet_id)}`,
      status: toStatus(row.entity_status),
      // The copy belongs to the post, which this ads-scoped token may not read, so it is
      // reported absent rather than guessed at.
      headline: null,
      body: null,
      callToAction: null,
      destinationUrl: null,
    } satisfies AdCreativeRemote));
  },

  async createAd(call, fields, draft) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    const tweetId = (draft.creativeRef ?? '').trim();
    if (!tweetId) {
      throw new AdsProviderError(
        'X promotes an existing post — pass its id as creativeRef. There is no X endpoint that authors new ad copy, so one cannot be written for you.',
        400,
        false,
      );
    }

    const created = rec(list((await ask(call, 'create_promoted_tweet', {
      account_id: accountId,
      line_item_id: draft.externalAdSetId,
      tweet_ids: tweetId,
    })).data)[0]);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('X accepted the promoted post but did not return its id.', 502, true);

    return {
      externalId: id,
      externalAdSetId: draft.externalAdSetId,
      name: `Post ${tweetId}`,
      status: draft.status ?? 'paused',
      headline: draft.headline ?? null,
      body: draft.body ?? null,
      callToAction: draft.callToAction ?? null,
      destinationUrl: draft.destinationUrl ?? null,
    };
  },

  async updateAd(call, fields, externalId, patch) {
    const accountId = requireField(fields, 'adAccountId', 'the ads account ID');
    if (!patch.status) return;
    /*
     * X HAS NO PAUSE FOR A PROMOTED POST. Stopping one IS deleting the entry — the post
     * itself is untouched, and promoting it again is a new entry with a new id. So a
     * request to pause is honoured as the only stop X offers, and a request to RESUME is
     * refused by name: silently doing nothing would leave a caller believing spend had
     * restarted when it had not.
     */
    if (patch.status === 'active') {
      throw new AdsProviderError(
        'X cannot resume a stopped promoted post — stopping one deletes the entry. Promote the post again to restart it.',
        409,
        false,
      );
    }
    await ask(call, 'delete_promoted_tweet', { account_id: accountId, promoted_tweet_id: externalId });
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
