/**
 * Snapchat Ads.
 *
 * Snap wraps every list element in a per-item envelope carrying its own
 * `sub_request_status` — `{"campaigns":[{"sub_request_status":"SUCCESS","campaign":{…}}]}`.
 * A batch write can therefore report HTTP 200 while the one item in it FAILED, which is
 * why `createCampaign` reads the item status rather than the response code.
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
  type AdCreativeRemote, type AdInsightRow, type AdObjective, type AdSetRemote,
  type AdStatus, type AdsProvider,
} from '../adsProviders';

const MICROS = 1_000_000;

const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'AWARENESS',
  traffic: 'TRAFFIC',
  engagement: 'ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  conversions: 'WEBSITE_CONVERSIONS',
  app_installs: 'APP_INSTALL',
  video_views: 'VIDEO_VIEW',
};

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
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

/**
 * Unwrap Snap's per-item envelope: `{sub_request_status, <kind>: {…}}` → the object.
 *
 * The KEY is the resource name and differs per level (`campaign`, `adsquad`, `ad`), so
 * it is a parameter rather than three near-identical unwrappers — the envelope shape is
 * one fact about this API, and one fact belongs in one place.
 */
const unwrapItem = (raw: unknown, kind: 'campaign' | 'adsquad' | 'ad'): Record<string, unknown> => {
  const entry = rec(raw);
  return rec(entry[kind] ?? entry);
};

/**
 * The id from a batch write, or the reason Snap refused it.
 *
 * A batch write reports HTTP 200 with a FAILED item inside, so the item status is what
 * decides — see this file's header. Shared by all three levels because all three answer
 * in the same envelope.
 */
function createdId(result: { data: unknown }, kind: 'campaign' | 'adsquad' | 'ad', label: string): string {
  const entry = rec(list(result.data)[0]);
  const id = text(unwrapItem(entry, kind).id);
  if (id) return id;
  const reason = text(entry.sub_request_status) === 'ERROR'
    ? text(rec(entry.errors ?? {}).message) || `Snapchat rejected the ${label}.`
    : `Snapchat accepted the request but did not return ${label === 'ad' ? 'an' : 'a'} ${label} id.`;
  throw new AdsProviderError(reason.slice(0, 300), 502, false);
}

const GENDERS: Readonly<Record<AdGender, string>> = { male: 'MALE', female: 'FEMALE' };

/**
 * What Snapchat can place through this adapter.
 *
 * `placements`, `interests` and `devices` are absent. Snap's ad squad does carry all
 * three, but each is expressed as an id or a nested `targeting` sub-object whose values
 * the ads manifest has no lookup for — and a dimension whose values this adapter would
 * have to guess at is the silent-mistarget this vocabulary exists to prevent. Refused by
 * name is honest; sent-and-ignored is not.
 */
const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = ['geo', 'age', 'gender'];

/**
 * Snap's age targeting is a MIN and a MAX, not a bucket list — so unlike TikTok, X and
 * Pinterest, any window is expressible and none has to be refused. `35+` is the string
 * Snap uses for an open top, which is `AD_MAX_AGE` in this port's terms.
 */
function demographics(targeting: AdTargeting): Record<string, unknown>[] {
  const demographic: Record<string, unknown> = {};
  if (targeting.ageMin != null || targeting.ageMax != null) {
    const window = ageWindow(targeting);
    demographic.min_age = String(window.min);
    // An open top is Snap's own `35+` style string; a numeric max would exclude the
    // oldest bracket entirely rather than including it.
    demographic.max_age = window.max >= 65 ? '65+' : String(window.max);
  }
  if (targeting.genders?.length) {
    const mapped = mapTargetingValues(snapchatAdsProvider, 'gender', GENDERS, targeting.genders);
    // Snap takes ONE gender. Both is its unrestricted default, not a constraint — and
    // `parseTargeting` has already dropped that case before it reaches here.
    if (mapped.length === 1) demographic.gender = mapped[0];
  }
  return Object.keys(demographic).length ? [demographic] : [];
}

/** Our spec → Snap's `targeting` object. Refuses before the write, never after. */
function targetingSpec(targeting: AdTargeting): Record<string, unknown> {
  requireTargetingSupport(snapchatAdsProvider, targeting);
  const spec: Record<string, unknown> = {};
  // Snap takes ISO country codes directly in `geos`, with no id lookup — which is why
  // geography is the one placeable dimension here that needs no second call.
  if (targeting.countries?.length) {
    spec.geos = targeting.countries.map((country) => ({ country_code: country.toLowerCase() }));
  }
  const demos = demographics(targeting);
  if (demos.length) spec.demographics = demos;
  return spec;
}

/** Snap's spec → as much of our vocabulary as it holds. Never throws. */
function readSnapTargeting(raw: unknown): AdTargeting {
  const spec = rec(raw);
  const targeting: {
    countries?: string[]; ageMin?: number; ageMax?: number;
    genders?: AdGender[]; interests?: string[]; placements?: AdPlacement[]; devices?: AdDevice[];
  } = {};

  const countries = list(spec.geos)
    .map((entry) => text(rec(entry).country_code).toUpperCase())
    .filter((value) => /^[A-Z]{2}$/.test(value));
  if (countries.length) targeting.countries = countries;

  const demographic = rec(list(spec.demographics)[0]);
  const min = Number(text(demographic.min_age).replace(/\D/g, ''));
  const max = Number(text(demographic.max_age).replace(/\D/g, ''));
  if (Number.isFinite(min) && min > 0) targeting.ageMin = min;
  if (Number.isFinite(max) && max > 0) targeting.ageMax = max;

  const gender = text(demographic.gender).toUpperCase();
  if (gender === 'MALE') targeting.genders = ['male'];
  if (gender === 'FEMALE') targeting.genders = ['female'];

  return targeting;
}

export const snapchatAdsProvider: AdsProvider = {
  network: 'snapchat', label: 'Snapchat Ads', connectorKey: 'snapchat-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  targetingDimensions: TARGETING_DIMENSIONS,
  // A Snapchat campaign with no ad squad is a valid paused shell Ads Manager shows; it
  // simply never delivers. Nothing is auto-created on its behalf.
  requiresAdSet: false,
  /**
   * A Snapchat ad places an EXISTING creative — `create_ad` takes a `creative_id`, and
   * building a creative needs an uploaded media asset this port has no way to supply.
   * So a `creativeRef` is required, and asked for up front.
   */
  requiresCreativeRef: true,
  accountFields: [{
    key: 'adAccountId', label: 'Ad account ID',
    help: 'The Snapchat ad account this connection spends on.',
  }],

  async identity(_call, fields) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    // Listing Snap ad accounts requires the ORGANIZATION id, which is not part of this
    // connection — so identity is taken from the connection rather than claimed from a
    // call that cannot be made with what the tenant supplied.
    return { externalId: accountId, name: `Ad account ${accountId}`, currency: 'USD' };
  },

  async listCampaigns(call, fields, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_campaigns', { ad_account_id: accountId, limit: 500 })).data).map((raw) => unwrapItem(raw, 'campaign'));
    return rows.map((c) => {
      const native = text(c.objective) || null;
      return {
        externalId: text(c.id),
        name: text(c.name),
        status: toStatus(c.status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: toCents(c.daily_budget_micro, MICROS),
        totalBudgetCents: toCents(c.lifetime_spend_cap_micro, MICROS),
        currency: identity.currency,
        startsAtISO: toISO(c.start_time),
        endsAtISO: toISO(c.end_time),
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const objective = mapObjective(snapchatAdsProvider, OBJECTIVES, draft.objective);
    const result = await ask(call, 'create_campaign', {
      ad_account_id: accountId,
      campaigns: [{
        ad_account_id: accountId,
        name: draft.name,
        objective,
        status: fromStatus(draft.status) ?? 'PAUSED',
        // Snap rejects a campaign with no start time.
        start_time: draft.startsAtISO ?? new Date().toISOString(),
        ...(draft.endsAtISO ? { end_time: draft.endsAtISO } : {}),
        ...(draft.dailyBudgetCents ? { daily_budget_micro: fromCents(draft.dailyBudgetCents, MICROS) } : {}),
        ...(draft.totalBudgetCents ? { lifetime_spend_cap_micro: fromCents(draft.totalBudgetCents, MICROS) } : {}),
      }],
    });

    const id = createdId(result, 'campaign', 'campaign');
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
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const status = fromStatus(patch.status);
    await ask(call, 'update_campaign', {
      ad_account_id: accountId,
      campaigns: [{
        id: externalId,
        ad_account_id: accountId,
        ...(patch.name ? { name: patch.name } : {}),
        ...(status ? { status } : {}),
        ...(patch.dailyBudgetCents != null ? { daily_budget_micro: fromCents(patch.dailyBudgetCents, MICROS) } : {}),
        ...(patch.totalBudgetCents != null ? { lifetime_spend_cap_micro: fromCents(patch.totalBudgetCents, MICROS) } : {}),
      }],
    });
  },

  // ── Ad squads (this port's ad set) ───────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    /*
     * Snap's ad-squad edge hangs off a CAMPAIGN (`/campaigns/{id}/adsquads`) — there is
     * no account-wide list. So an unscoped call reads the account's campaigns first and
     * then their squads. That is a request per campaign by construction, not an N+1 this
     * adapter chose: the account-level edge does not exist to be used instead.
     */
    const campaignIds = externalCampaignId
      ? [externalCampaignId]
      : (await snapchatAdsProvider.listCampaigns(call, fields, identity)).map((campaign) => campaign.externalId);

    const squads: AdSetRemote[] = [];
    for (const campaignId of campaignIds) {
      const rows = list((await ask(call, 'list_ad_squads', { campaign_id: campaignId, limit: 500 })).data)
        .map((raw) => unwrapItem(raw, 'adsquad'));
      for (const row of rows) {
        squads.push({
          externalId: text(row.id),
          externalCampaignId: text(row.campaign_id) || campaignId,
          name: text(row.name),
          status: toStatus(row.status),
          targeting: readSnapTargeting(row.targeting),
          nativeTargeting: row.targeting ?? null,
          bidStrategy: text(row.bid_strategy) || text(row.optimization_goal) || null,
          bidCents: toCents(row.bid_micro, MICROS),
          dailyBudgetCents: toCents(row.daily_budget_micro, MICROS),
          currency: identity.currency,
          startsAtISO: toISO(row.start_time),
          endsAtISO: toISO(row.end_time),
        });
      }
    }
    return squads;
  },

  async createAdSet(call, fields, draft, identity) {
    const spec = targetingSpec(draft.targeting);
    const daily = fromCents(draft.dailyBudgetCents, MICROS);
    const bid = fromCents(draft.bidCents, MICROS);

    const result = await ask(call, 'create_ad_squad', {
      campaign_id: draft.externalCampaignId,
      adsquads: [{
        campaign_id: draft.externalCampaignId,
        name: draft.name,
        type: 'SNAP_ADS',
        status: fromStatus(draft.status) ?? 'PAUSED',
        optimization_goal: draft.objective === 'awareness' ? 'IMPRESSIONS' : 'SWIPES',
        // Snap rejects an ad squad with no start time, exactly as it does a campaign.
        start_time: draft.startsAtISO ?? new Date().toISOString(),
        // Snap REQUIRES a targeting object. An empty one means "everyone", which is a
        // real choice; omitting the key is a 400 with an unhelpful message.
        targeting: spec,
        ...(daily ? { daily_budget_micro: daily } : {}),
        ...(bid ? { bid_micro: bid } : {}),
        ...(draft.endsAtISO ? { end_time: draft.endsAtISO } : {}),
      }],
    });
    const id = createdId(result, 'adsquad', 'ad squad');

    return {
      externalId: id,
      externalCampaignId: draft.externalCampaignId,
      name: draft.name,
      status: draft.status ?? 'paused',
      targeting: draft.targeting,
      nativeTargeting: spec,
      bidStrategy: draft.objective === 'awareness' ? 'IMPRESSIONS' : 'SWIPES',
      bidCents: draft.bidCents ?? null,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateAdSet(call, _fields, externalId, patch) {
    const status = fromStatus(patch.status);
    const daily = fromCents(patch.dailyBudgetCents, MICROS);
    const bid = fromCents(patch.bidCents, MICROS);
    // A REPLACEMENT spec, not a merge — Snap overwrites the whole targeting object, and
    // pretending otherwise would drop every dimension the caller left out.
    const spec = patch.targeting ? targetingSpec(patch.targeting) : undefined;

    await ask(call, 'update_ad_squad', {
      adsquad_id: externalId,
      adsquads: [{
        id: externalId,
        ...(patch.name ? { name: patch.name } : {}),
        ...(status ? { status } : {}),
        ...(daily ? { daily_budget_micro: daily } : {}),
        ...(bid ? { bid_micro: bid } : {}),
        ...(spec ? { targeting: spec } : {}),
      }],
    });
  },

  // ── Ads ──────────────────────────────────────────────────────────────────

  async listAds(call, fields, identity, externalAdSetId) {
    // Same shape as the squad edge: `/adsquads/{id}/ads` is the only list Snap offers,
    // so an unscoped read walks the account's squads rather than inventing a wider call.
    const squadIds = externalAdSetId
      ? [externalAdSetId]
      : (await snapchatAdsProvider.listAdSets(call, fields, identity, null)).map((squad) => squad.externalId);

    const ads: AdCreativeRemote[] = [];
    for (const squadId of squadIds) {
      const rows = list((await ask(call, 'list_ads', { adsquad_id: squadId, limit: 500 })).data)
        .map((raw) => unwrapItem(raw, 'ad'));
      for (const row of rows) {
        ads.push({
          externalId: text(row.id),
          externalAdSetId: text(row.ad_squad_id) || squadId,
          name: text(row.name),
          status: toStatus(row.status),
          // The copy and the destination belong to the CREATIVE, a separate resource;
          // reporting them absent beats reporting a guess.
          headline: null,
          body: null,
          callToAction: null,
          destinationUrl: null,
        });
      }
    }
    return ads;
  },

  async createAd(call, _fields, draft) {
    const creativeId = (draft.creativeRef ?? '').trim();
    if (!creativeId) {
      throw new AdsProviderError(
        'Snapchat places an existing creative — pass its id as creativeRef. Building one needs an uploaded media asset, which this port has no way to supply.',
        400,
        false,
      );
    }

    const result = await ask(call, 'create_ad', {
      adsquad_id: draft.externalAdSetId,
      ads: [{
        ad_squad_id: draft.externalAdSetId,
        creative_id: creativeId,
        name: draft.name,
        type: 'SNAP_AD',
        status: fromStatus(draft.status) ?? 'PAUSED',
      }],
    });
    const id = createdId(result, 'ad', 'ad');

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
    if (!patch.name && !status) return;
    await ask(call, 'update_ad', {
      ad_id: externalId,
      ads: [{
        id: externalId,
        ...(patch.name ? { name: patch.name } : {}),
        ...(status ? { status } : {}),
      }],
    });
  },

  async insights(call, fields, query, identity) {
    // Snap's stats endpoint is PER CAMPAIGN — there is no account-wide daily report —
    // so an unscoped query resolves the campaigns and reads each one.
    const ids = query.externalCampaignIds?.length
      ? [...query.externalCampaignIds]
      : (await snapchatAdsProvider.listCampaigns(call, fields, identity)).map((c) => c.externalId);
    if (ids.length === 0) return [];

    const reads = await Promise.all(ids.map(async (externalCampaignId) => {
      const result = await ask(call, 'get_stats', {
        campaign_id: externalCampaignId,
        granularity: 'DAY',
        start_time: `${query.since}T00:00:00.000-00:00`,
        end_time: `${query.until}T00:00:00.000-00:00`,
        fields: 'spend,impressions,swipes,conversion_purchases',
      });
      // `resultPath: 'timeseries_stats'` leaves the per-item envelope array; the days
      // are one level further in, under `timeseries_stat.timeseries`.
      const stat = rec(rec(list(result.data)[0]).timeseries_stat);
      return list(stat.timeseries).map(rec).flatMap((point) => {
        const date = toDay(point.start_time);
        const stats = rec(point.stats);
        if (!date) return [];
        return [{
          date,
          externalCampaignId,
          spendCents: toCents(stats.spend, MICROS) ?? 0,
          impressions: count(stats.impressions),
          // Snap counts a "swipe up" where every other network counts a click.
          clicks: count(stats.swipes),
          conversions: count(stats.conversion_purchases),
          currency: identity.currency,
        } satisfies AdInsightRow];
      });
    }));
    return reads.flat();
  },
};
