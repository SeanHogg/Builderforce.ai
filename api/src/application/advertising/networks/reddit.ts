/**
 * Reddit Ads.
 *
 * A Reddit CAMPAIGN carries a lifetime spend cap and an objective; the daily budget and
 * the schedule live on the AD GROUP beneath it. So `dailyBudgetCents` is read from the
 * campaign's ad groups rather than reported as null — a campaign whose ad group spends
 * $50/day is not a campaign with no daily budget.
 *
 * Money is micros of the account currency.
 */

import {
  AdsProviderError, ask, count, fromCents, list, mapObjective, rec, requireField, text, toCents, toDay, toISO, unmapObjective,
} from '../adsNormalize';
import {
  mapTargetingValues, requireTargetingSupport,
  type AdDevice, type AdGender, type AdPlacement, type AdTargeting, type AdTargetingDimension,
} from '../adTargeting';
import {
  type AdCreativeRemote, type AdInsightRow, type AdObjective, type AdSetRemote,
  type AdStatus, type AdsProvider,
} from '../adsProviders';

const MICROS = 1_000_000;

const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'IMPRESSIONS',
  traffic: 'TRAFFIC',
  conversions: 'CONVERSIONS',
  app_installs: 'APP_INSTALLS',
  video_views: 'VIDEO_VIEWABLE_IMPRESSIONS',
};

function toStatus(raw: unknown): AdStatus {
  switch (text(raw).toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
    case 'DRAFT': return 'draft';
    case 'COMPLETED': return 'ended';
    case 'ARCHIVED': case 'DELETED': return 'archived';
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
 * Devices → Reddit's own enum.
 *
 * Reddit sells the mobile app, mobile web and desktop. It draws no line between phone
 * and tablet, so `tablet` is REFUSED rather than folded into `mobile` — see the note on
 * `mapTargetingValues`: a tablet request answered with a phone campaign is a different
 * audience bought at full price.
 */
const DEVICES: Readonly<Record<AdDevice, string | undefined>> = {
  mobile: 'MOBILE',
  desktop: 'DESKTOP',
  tablet: undefined,
};

/**
 * What Reddit can actually place.
 *
 * AGE and GENDER are absent because Reddit does not collect them — there is no field to
 * send, so a request for "women 25-34" is refused by name here rather than sent, ignored
 * and billed as an untargeted campaign. PLACEMENTS are absent for a narrower reason: the
 * ad group takes no placement enum this adapter can write with confidence, and declaring
 * a dimension it would then have to guess at is the failure this vocabulary prevents.
 */
const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = ['geo', 'interests', 'devices'];

/** Our spec → Reddit's `targeting` object. Refuses before the write, never after. */
function targetingSpec(targeting: AdTargeting): Record<string, unknown> {
  requireTargetingSupport(redditAdsProvider, targeting);
  const spec: Record<string, unknown> = {};
  // Reddit takes ISO country codes in `geolocations` directly — no id lookup, which is
  // why geography is the one dimension this adapter can place without a second call.
  if (targeting.countries?.length) spec.geolocations = [...targeting.countries];
  if (targeting.interests?.length) spec.interests = [...targeting.interests];
  if (targeting.devices?.length) {
    spec.devices = mapTargetingValues(redditAdsProvider, 'devices', DEVICES, targeting.devices);
  }
  return spec;
}

/** Reddit's spec → as much of our vocabulary as it holds. Never throws: a group built in
 *  Reddit's console targets communities this port has no name for, and reporting the
 *  half we understand beats reporting nothing. */
function readRedditTargeting(raw: unknown): AdTargeting {
  const spec = rec(raw);
  const targeting: {
    countries?: string[]; ageMin?: number; ageMax?: number;
    genders?: AdGender[]; interests?: string[]; placements?: AdPlacement[]; devices?: AdDevice[];
  } = {};

  const countries = list(spec.geolocations).map(text).filter((value) => /^[A-Za-z]{2}$/.test(value));
  if (countries.length) targeting.countries = countries.map((value) => value.toUpperCase());

  const interests = list(spec.interests).map(text).filter(Boolean);
  if (interests.length) targeting.interests = interests;

  const byNative = new Map(
    Object.entries(DEVICES)
      .filter((entry): entry is [AdDevice, string] => entry[1] != null)
      .map(([ours, theirs]) => [theirs, ours]),
  );
  const devices = list(spec.devices)
    .map((value) => byNative.get(text(value).toUpperCase()))
    .filter((value): value is AdDevice => value != null);
  if (devices.length) targeting.devices = devices;

  return targeting;
}

export const redditAdsProvider: AdsProvider = {
  network: 'reddit', label: 'Reddit Ads', connectorKey: 'reddit-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  targetingDimensions: TARGETING_DIMENSIONS,
  /**
   * A Reddit campaign holds the objective and the lifetime cap; the DAILY budget, the
   * schedule and the targeting all live on the ad group. A campaign with nothing under
   * it is therefore a funded object that can never spend and never reports a number —
   * so `adsService` composes a default ad set through `createAdSet` after every create.
   */
  requiresAdSet: true,
  // Reddit authors copy from `headline`/`body`, so an existing post id is optional.
  requiresCreativeRef: false,
  accountFields: [{
    key: 'adAccountId', label: 'Ad account ID',
    help: 'The Reddit ad account this connection spends on.',
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
    const campaigns = list((await ask(call, 'list_campaigns', { ad_account_id: accountId, page_size: 200 })).data).map(rec);
    if (campaigns.length === 0) return [];

    // ONE call for every ad group, grouped in memory — the daily budget lives there,
    // and a request per campaign would be an N+1 across the whole account.
    const adGroups = list((await ask(call, 'list_ad_groups', { ad_account_id: accountId, page_size: 500 })).data).map(rec);
    const dailyByCampaign = new Map<string, number>();
    const scheduleByCampaign = new Map<string, { start: string | null; end: string | null }>();
    for (const group of adGroups) {
      const campaignId = text(group.campaign_id);
      if (!campaignId) continue;
      if (text(group.goal_type).toUpperCase() === 'DAILY_SPEND') {
        const cents = toCents(group.goal_value, MICROS);
        // Several ad groups under one campaign each carry their own daily spend, and
        // the campaign's daily rate is their SUM, not the first one seen.
        if (cents != null) dailyByCampaign.set(campaignId, (dailyByCampaign.get(campaignId) ?? 0) + cents);
      }
      if (!scheduleByCampaign.has(campaignId)) {
        scheduleByCampaign.set(campaignId, { start: toISO(group.start_time), end: toISO(group.end_time) });
      }
    }

    return campaigns.map((c) => {
      const id = text(c.id);
      const native = text(c.objective) || null;
      const schedule = scheduleByCampaign.get(id);
      return {
        externalId: id,
        name: text(c.name),
        status: toStatus(c.configured_status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: dailyByCampaign.get(id) ?? null,
        totalBudgetCents: toCents(c.spend_cap, MICROS),
        currency: identity.currency,
        startsAtISO: schedule?.start ?? null,
        endsAtISO: schedule?.end ?? null,
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const objective = mapObjective(redditAdsProvider, OBJECTIVES, draft.objective);
    const created = rec((await ask(call, 'create_campaign', {
      ad_account_id: accountId,
      name: draft.name,
      objective,
      configured_status: fromStatus(draft.status) ?? 'PAUSED',
      ...(draft.totalBudgetCents ? { spend_cap: fromCents(draft.totalBudgetCents, MICROS) } : {}),
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('Reddit accepted the campaign but did not return its id.', 502, true);

    // A Reddit campaign carries no daily budget of its own. The ad group that holds it
    // is NOT created here: `requiresAdSet` declares the need and `adsService` composes
    // one through the same `createAdSet` every other caller uses. This used to be an
    // inline copy, which is how the default ad group came to be built differently from
    // every ad group made afterwards.

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
    const configured = fromStatus(patch.status);
    await ask(call, 'update_campaign', {
      ad_account_id: accountId,
      campaign_id: externalId,
      ...(patch.name ? { name: patch.name } : {}),
      ...(configured ? { configured_status: configured } : {}),
      ...(patch.totalBudgetCents != null ? { spend_cap: fromCents(patch.totalBudgetCents, MICROS) } : {}),
    });
  },

  // ── Ad groups (this port's ad set) ───────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_ad_groups', { ad_account_id: accountId, page_size: 500 })).data).map(rec);
    // Reddit's ad-group edge takes no campaign filter, so the scope is applied here —
    // one call for the account still beats one call per campaign.
    const scoped = externalCampaignId ? rows.filter((row) => text(row.campaign_id) === externalCampaignId) : rows;
    return scoped.map((row) => ({
      externalId: text(row.id),
      externalCampaignId: text(row.campaign_id) || null,
      name: text(row.name),
      status: toStatus(row.configured_status),
      targeting: readRedditTargeting(row.targeting),
      nativeTargeting: row.targeting ?? null,
      bidStrategy: text(row.bid_strategy) || null,
      bidCents: toCents(row.bid_value, MICROS),
      // One budget field whose meaning is set by `goal_type` — a lifetime goal is not a
      // daily rate, and reporting it as one would overstate the day by the whole flight.
      dailyBudgetCents: text(row.goal_type).toUpperCase() === 'DAILY_SPEND' ? toCents(row.goal_value, MICROS) : null,
      currency: identity.currency,
      startsAtISO: toISO(row.start_time),
      endsAtISO: toISO(row.end_time),
    } satisfies AdSetRemote));
  },

  async createAdSet(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const targeting = targetingSpec(draft.targeting);
    const bid = fromCents(draft.bidCents, MICROS);
    const daily = fromCents(draft.dailyBudgetCents, MICROS);

    const created = rec((await ask(call, 'create_ad_group', {
      ad_account_id: accountId,
      campaign_id: draft.externalCampaignId,
      name: draft.name,
      configured_status: fromStatus(draft.status) ?? 'PAUSED',
      // A bid VALUE and "let Reddit bid" are different strategies, not one with a
      // missing field — sending MANUAL_BIDDING with no value is rejected.
      ...(bid ? { bid_strategy: 'MANUAL_BIDDING', bid_value: bid } : { bid_strategy: 'MAXIMIZE_VOLUME' }),
      ...(daily ? { goal_type: 'DAILY_SPEND', goal_value: daily } : {}),
      ...(draft.startsAtISO ? { start_time: draft.startsAtISO } : {}),
      ...(draft.endsAtISO ? { end_time: draft.endsAtISO } : {}),
      ...(Object.keys(targeting).length ? { targeting } : {}),
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('Reddit accepted the ad group but did not return its id.', 502, true);

    return {
      externalId: id,
      externalCampaignId: draft.externalCampaignId,
      name: draft.name,
      status: draft.status ?? 'paused',
      targeting: draft.targeting,
      nativeTargeting: targeting,
      bidStrategy: bid ? 'MANUAL_BIDDING' : 'MAXIMIZE_VOLUME',
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
    const bid = fromCents(patch.bidCents, MICROS);
    const daily = fromCents(patch.dailyBudgetCents, MICROS);
    // A REPLACEMENT spec, not a merge — Reddit overwrites the whole targeting object,
    // and pretending otherwise would silently drop every dimension left out.
    const targeting = patch.targeting ? targetingSpec(patch.targeting) : undefined;

    await ask(call, 'update_ad_group', {
      ad_account_id: accountId,
      ad_group_id: externalId,
      ...(patch.name ? { name: patch.name } : {}),
      ...(status ? { configured_status: status } : {}),
      ...(bid ? { bid_value: bid } : {}),
      ...(daily ? { goal_type: 'DAILY_SPEND', goal_value: daily } : {}),
      ...(targeting ? { targeting } : {}),
    });
  },

  // ── Ads ──────────────────────────────────────────────────────────────────

  async listAds(call, fields, _identity, externalAdSetId) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const rows = list((await ask(call, 'list_ads', { ad_account_id: accountId, page_size: 500 })).data).map(rec);
    const scoped = externalAdSetId ? rows.filter((row) => text(row.ad_group_id) === externalAdSetId) : rows;
    return scoped.map((row) => ({
      externalId: text(row.id),
      externalAdSetId: text(row.ad_group_id) || null,
      name: text(row.name),
      status: toStatus(row.configured_status),
      headline: text(row.headline) || null,
      body: text(row.body) || null,
      callToAction: text(row.call_to_action) || null,
      destinationUrl: text(row.destination_url) || null,
    } satisfies AdCreativeRemote));
  },

  async createAd(call, fields, draft) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const postId = (draft.creativeRef ?? '').trim();
    const link = (draft.destinationUrl ?? '').trim();
    // Promoting an EXISTING post carries its own destination; new copy does not, and a
    // Reddit ad with neither is an ad whose click goes nowhere.
    if (!postId && !link) {
      throw new AdsProviderError(
        'A Reddit ad needs a destination URL — that is what the click buys. Or pass an existing post id as creativeRef to promote it.',
        400,
        false,
      );
    }

    const created = rec((await ask(call, 'create_ad', {
      ad_account_id: accountId,
      ad_group_id: draft.externalAdSetId,
      name: draft.name,
      configured_status: fromStatus(draft.status) ?? 'PAUSED',
      type: 'TEXT',
      ...(postId ? { post_id: postId } : {}),
      ...(draft.headline ? { headline: draft.headline } : {}),
      ...(draft.body ? { body: draft.body } : {}),
      ...(link ? { destination_url: link } : {}),
      ...(draft.callToAction ? { call_to_action: draft.callToAction } : {}),
    })).data);
    const id = text(created.id);
    if (!id) throw new AdsProviderError('Reddit accepted the ad but did not return its id.', 502, true);

    return {
      externalId: id,
      externalAdSetId: draft.externalAdSetId,
      name: draft.name,
      status: draft.status ?? 'paused',
      headline: draft.headline ?? null,
      body: draft.body ?? null,
      callToAction: draft.callToAction ?? null,
      destinationUrl: link || null,
    };
  },

  async updateAd(call, fields, externalId, patch) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const status = fromStatus(patch.status);
    if (!patch.name && !status) return;
    await ask(call, 'update_ad', {
      ad_account_id: accountId,
      ad_id: externalId,
      ...(patch.name ? { name: patch.name } : {}),
      ...(status ? { configured_status: status } : {}),
    });
  },

  async insights(call, fields, query, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the ad account ID');
    const result = await ask(call, 'get_report', {
      ad_account_id: accountId,
      data: 'CAMPAIGN',
      breakdowns: ['DATE'],
      fields: ['spend', 'impressions', 'clicks', 'conversion_signup_total_items', 'campaign_id', 'date'],
      starts_at: `${query.since}T00:00:00Z`,
      ends_at: `${query.until}T23:59:59Z`,
      time_zone_id: 'UTC',
    });
    return list(rec(result.data).metrics ?? result.data).map(rec).flatMap((row) => {
      const externalCampaignId = text(row.campaign_id);
      const date = toDay(row.date);
      if (!externalCampaignId || !date) return [];
      return [{
        date,
        externalCampaignId,
        spendCents: toCents(row.spend, MICROS) ?? 0,
        impressions: count(row.impressions),
        clicks: count(row.clicks),
        conversions: count(row.conversion_signup_total_items),
        currency: identity.currency,
      } satisfies AdInsightRow];
    });
  },
};
