/**
 * Microsoft Advertising — paid search and audience across Bing, Yahoo, DuckDuckGo and
 * the Microsoft Audience Network.
 *
 * ── SOAP, NOT REST ───────────────────────────────────────────────────────────
 * Campaign Management v13 has no REST surface. That is a TRANSPORT fact, handled once in
 * `connectors/soapEnvelope` — this adapter reads and writes the same plain objects every
 * other network's does. Two consequences leak into the shapes below and nowhere else:
 *
 *   1. Collections are TYPED ARRAY WRAPPERS. A list of campaigns is not `[…]` but
 *      `{Campaign: […]}`, and the same on the way in. {@link wrap} and {@link unwrap}
 *      are the only two places that know it.
 *   2. A refusal arrives as a `<Fault>` on HTTP 200, already turned into an error by the
 *      envelope module — so this adapter can read a result the way the others do.
 *
 * ── REPORTING IS A DIFFERENT SERVICE, AND ASYNCHRONOUS ───────────────────────
 * Microsoft answers "what did this cost" with a job, not a number: SUBMIT a report, POLL
 * until it is generated, then DOWNLOAD a zipped CSV from a URL it names. It also lives on
 * a different host, which is why the manifest's reporting actions carry their own
 * `baseUrl`. {@link insights} composes all three steps and parses the CSV, so the port's
 * one-call contract holds for callers even though the vendor's does not.
 *
 * Money is the MAJOR currency unit throughout — `Amount: 50` is fifty dollars.
 */

import { unzipSync, strFromU8 } from 'fflate';

import {
  AdsProviderError, ask, count, fromCents, isRetryableAdStatus, list, mapObjective, rec, requireField,
  text, toCents, toDay, toISO, unmapObjective,
} from '../adsNormalize';
import {
  ageFromBuckets, bucketedAgeKeys, mapTargetingValues, readNativeValues, requireTargetingSupport,
  type AdDevice, type AdGender, type AdPlacement, type AdTargeting, type AdTargetingDimension,
  type AgeBucket,
} from '../adTargeting';
import {
  type AdCall, type AdCallResult, type AdCreativeRemote, type AdInsightRow, type AdObjective, type AdSetRemote,
  type AdStatus, type AdsProvider,
} from '../adsProviders';

const MAJOR = 1;

/**
 * Microsoft sells SEARCH INTENT, and its campaign types are the closest thing it has to
 * an objective — there is no `Objective` field on a Microsoft campaign at all.
 *
 * So the mapping is honest about what it is: a campaign TYPE, chosen to serve the
 * objective. `leads` and `conversions` both run Search, because on Microsoft the
 * difference between them is the conversion goal on the account, not the campaign — and
 * inventing two campaign types to look symmetrical would be a distinction with nothing
 * behind it. `engagement` and `video_views` are absent because Microsoft sells neither
 * as a buyable outcome, and `mapObjective` refuses them by name.
 */
const OBJECTIVES: Partial<Record<AdObjective, string>> = {
  awareness: 'Audience',
  traffic: 'Search',
  leads: 'Search',
  conversions: 'Search',
  app_installs: 'App',
};

/** Microsoft's age buckets, as [inclusive min, inclusive max] in this port's terms. */
const AGE_BUCKETS: readonly AgeBucket[] = [
  { key: 'EighteenToTwentyFour', min: 18, max: 24 },
  { key: 'TwentyFiveToThirtyFour', min: 25, max: 34 },
  { key: 'ThirtyFiveToFortyNine', min: 35, max: 49 },
  { key: 'FiftyToSixtyFour', min: 50, max: 64 },
  { key: 'SixtyFiveAndAbove', min: 65, max: 65 },
];

const GENDERS: Readonly<Record<AdGender, string>> = { male: 'Male', female: 'Female' };

/** Devices → Microsoft's `DeviceName` criterion. All three, unusually — it is one of the
 *  few networks that still sells desktop as a first-class device. */
const DEVICES: Readonly<Record<AdDevice, string | undefined>> = {
  mobile: 'Smartphones',
  desktop: 'Computers',
  tablet: 'Tablets',
};

/**
 * What Microsoft can place AT THIS LEVEL.
 *
 * `interests` is absent because its audience targeting is an account-scoped audience id
 * (in-market lists, custom audiences) and the manifest carries no lookup — a phrase would
 * have nothing behind it. `geo` is absent for the same reason and a sharper one:
 * `LocationCriterion` takes a numeric geographical-location id, not a country code, and
 * no code-to-id action is declared here.
 *
 * `placements` is absent for a different reason worth stating, because Microsoft LOOKS
 * like it should support it: search results versus the audience network is not an ad
 * group criterion on Microsoft at all — it is decided by the CAMPAIGN's type, one level
 * above the ad set, and it is already carried there by the objective mapping (`Search`
 * versus `Audience`). Declaring the dimension here would mean accepting a placement on an
 * ad set that has no field to put it in, which is precisely the accepted-then-dropped
 * failure `adTargeting` exists to prevent. Choosing the objective chooses the surface.
 */
const TARGETING_DIMENSIONS: readonly AdTargetingDimension[] = ['age', 'gender', 'devices'];

/** A SOAP typed array in: `[a, b]` → `{Campaign: [a, b]}`. */
const wrap = <T>(element: string, values: readonly T[]): Record<string, readonly T[]> => ({ [element]: values });

/** A SOAP typed array out: `{Campaign: […]}` → `[…]`, and a single element → `[it]`. */
const unwrap = (value: unknown, element: string): Record<string, unknown>[] =>
  list(rec(value)[element] ?? value).map(rec);

function toStatus(raw: unknown): AdStatus {
  switch (text(raw)) {
    case 'Active': return 'active';
    case 'Paused': return 'paused';
    case 'BudgetPaused': case 'BudgetAndManualPaused': return 'paused';
    case 'Draft': return 'draft';
    case 'Expired': return 'ended';
    case 'Deleted': return 'archived';
    default: return 'draft';
  }
}

function fromStatus(status: AdStatus | undefined): string | undefined {
  if (status === 'active') return 'Active';
  if (status === 'paused' || status === 'draft') return 'Paused';
  if (status === 'archived' || status === 'ended') return 'Deleted';
  return undefined;
}

/** Microsoft returns `{Amount: 50}` for money and a bare number in places. */
const amountCents = (value: unknown): number | null =>
  toCents(rec(value).Amount ?? value, MAJOR);

/**
 * The criterion rows a Microsoft ad group targets with.
 *
 * Age, gender and device are each their OWN criterion type rather than fields on the ad
 * group, which is why targeting is a second call after the group exists.
 */
function criterionsFor(targeting: AdTargeting, adGroupId: string): Record<string, unknown>[] {
  requireTargetingSupport(microsoftAdsProvider, targeting);
  const criterions: Record<string, unknown>[] = [];
  const push = (type: string, body: Record<string, unknown>): void => {
    criterions.push({
      AdGroupId: adGroupId,
      // The typed-object discriminator SOAP needs to know which criterion this is.
      Criterion: { 'i:type': type, ...body },
    });
  };

  if (targeting.ageMin != null || targeting.ageMax != null) {
    for (const bucket of bucketedAgeKeys(microsoftAdsProvider, AGE_BUCKETS, targeting)) {
      push('AgeCriterion', { AgeRange: bucket });
    }
  }
  if (targeting.genders?.length) {
    for (const value of mapTargetingValues(microsoftAdsProvider, 'gender', GENDERS, targeting.genders)) {
      push('GenderCriterion', { GenderType: value });
    }
  }
  if (targeting.devices?.length) {
    for (const value of mapTargetingValues(microsoftAdsProvider, 'devices', DEVICES, targeting.devices)) {
      push('DeviceCriterion', { DeviceName: value });
    }
  }
  return criterions;
}

/** Microsoft's criterion rows → as much of our vocabulary as they hold. Never throws. */
function readCriterions(rows: readonly Record<string, unknown>[]): AdTargeting {
  const targeting: {
    countries?: string[]; ageMin?: number; ageMax?: number;
    genders?: AdGender[]; interests?: string[]; placements?: AdPlacement[]; devices?: AdDevice[];
  } = {};
  const criteria = rows.map((row) => rec(row.Criterion));

  const window = ageFromBuckets(AGE_BUCKETS, criteria.map((c) => text(c.AgeRange)).filter(Boolean));
  if (window) {
    targeting.ageMin = window.min;
    targeting.ageMax = window.max;
  }

  const genders = criteria
    .map((c) => text(c.GenderType))
    .map((value) => (value === 'Male' ? 'male' : value === 'Female' ? 'female' : null))
    .filter((value): value is AdGender => value != null);
  if (genders.length) targeting.genders = genders;

  const devices = readNativeValues(DEVICES, criteria.map((c) => text(c.DeviceName)).filter(Boolean));
  if (devices.length) targeting.devices = devices;

  return targeting;
}

// ---------------------------------------------------------------------------
// Reporting — submit, poll, download, parse
// ---------------------------------------------------------------------------

/**
 * How long to wait between polls, in milliseconds, and how many times.
 *
 * A campaign-performance report over a short window is typically ready in seconds. The
 * ceiling exists because this runs inside a request: a report that is not ready by then
 * is reported as RETRYABLE rather than as zero spend, so the insights sweep asks again on
 * its next pass instead of writing a day of zeroes over real numbers.
 */
const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 15;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Parse the report CSV.
 *
 * Microsoft brackets the rows with metadata — a name, the account, the date range, then a
 * blank line, then the header, then rows, then a `©…` copyright footer. So the header is
 * FOUND rather than assumed to be line one, and anything that does not parse as a row is
 * skipped rather than allowed to become a zero.
 */
function parseReportCsv(csv: string, currency: string): AdInsightRow[] {
  const lines = csv.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /(^|,)"?(CampaignId)"?(,|$)/i.test(line));
  if (headerIndex === -1) return [];

  const cells = (line: string): string[] =>
    // Fields are quoted only when they need to be, and a quoted field may contain commas.
    (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
      .map((cell) => cell.replace(/,$/, '').trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
      .slice(0, -1);

  const header = cells(lines[headerIndex] ?? '').map((name) => name.toLowerCase());
  const at = (row: string[], name: string): string => {
    const index = header.indexOf(name);
    return index === -1 ? '' : (row[index] ?? '');
  };

  const rows: AdInsightRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim() || line.startsWith('©')) continue;
    const row = cells(line);
    const externalCampaignId = at(row, 'campaignid');
    const date = toDay(at(row, 'timeperiod'));
    if (!externalCampaignId || !date) continue;
    rows.push({
      date,
      externalCampaignId,
      spendCents: toCents(at(row, 'spend'), MAJOR) ?? 0,
      impressions: count(at(row, 'impressions')),
      clicks: count(at(row, 'clicks')),
      conversions: count(at(row, 'conversions')),
      currency,
    });
  }
  return rows;
}

/**
 * Fetch the report archive, following Microsoft's storage redirects BY HAND.
 *
 * The connector runtime sets `redirect: 'manual'` on purpose: following a redirect
 * automatically would take the request to a host that was never SSRF-checked, which is
 * the whole hole the guard exists to close. Report URLs redirect to blob storage, so the
 * hops are walked here instead — and because each hop goes back through `call`, every one
 * of them is guarded, hostname-resolved and audit-logged exactly like the first.
 *
 * Bounded, because a redirect loop is otherwise an infinite one.
 */
const DOWNLOAD_HOPS = 3;

async function downloadReport(call: AdCall, url: string): Promise<AdCallResult> {
  let target = url;
  for (let hop = 0; hop <= DOWNLOAD_HOPS; hop += 1) {
    const result = await call('download_report', { report_url: target }, { captureHeaders: ['location'] });
    if (result.ok) return result;
    const location = result.headers?.location;
    if (result.status >= 300 && result.status < 400 && location) {
      // A relative Location is legal; resolved against the hop it came from.
      target = new URL(location, target).toString();
      continue;
    }
    throw new AdsProviderError(
      result.error?.slice(0, 400) || `Microsoft Advertising returned ${result.status} for the report download.`,
      result.status || 502,
      isRetryableAdStatus(result.status),
    );
  }
  throw new AdsProviderError('The Microsoft Advertising report download redirected too many times.', 502, true);
}

export const microsoftAdsProvider: AdsProvider = {
  network: 'microsoft', label: 'Microsoft Advertising', connectorKey: 'microsoft-ads',
  objectives: Object.keys(OBJECTIVES) as AdObjective[],
  targetingDimensions: TARGETING_DIMENSIONS,
  /**
   * A Microsoft campaign with no ad group is a valid paused shell the console shows; it
   * simply never serves. Nothing is auto-created on its behalf.
   */
  requiresAdSet: false,
  /** Microsoft authors its own copy — a responsive search ad is headlines and
   *  descriptions, not a reference to something that already exists. */
  requiresCreativeRef: false,
  accountFields: [{
    key: 'adAccountId', label: 'Account ID',
    help: 'The numeric Microsoft Advertising account the spend is billed to.',
  }, {
    key: 'customerId', label: 'Customer ID', optional: true,
    help: 'The manager account this account belongs to. Required by the API on most tenants.',
  }],

  async identity(call, fields) {
    const accountId = requireField(fields, 'adAccountId', 'the account ID');
    /*
     * The Campaign Management service has no "describe this account" operation — account
     * metadata belongs to the Customer Management service, which this connector does not
     * declare. So identity is taken from the connection rather than pretending to verify
     * it with a call that cannot be made here, exactly as the TikTok adapter does.
     *
     * The campaign read doubles as a REACHABILITY check: a bad token or a missing
     * developer token raises a SOAP fault here rather than at the first write.
     */
    const result = await ask(call, 'get_campaigns', { AccountId: accountId, CampaignType: 'Search Audience' });
    const first = unwrap(rec(result.data).Campaigns, 'Campaign')[0];
    return {
      externalId: accountId,
      name: `Account ${accountId}`,
      // Every campaign on an account bills in the account's currency, so the first one
      // that names it answers for all of them.
      currency: first ? text(rec(first.DailyBudget).CurrencyCode) || 'USD' : 'USD',
    };
  },

  async listCampaigns(call, fields, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the account ID');
    const result = await ask(call, 'get_campaigns', { AccountId: accountId, CampaignType: 'Search Audience DynamicSearchAds' });
    return unwrap(rec(result.data).Campaigns, 'Campaign').map((c) => {
      const native = text(c.CampaignType) || null;
      return {
        externalId: text(c.Id),
        name: text(c.Name),
        status: toStatus(c.Status),
        nativeObjective: native,
        objective: unmapObjective(OBJECTIVES, native),
        dailyBudgetCents: amountCents(c.DailyBudget),
        // Microsoft budgets daily. A lifetime cap is a property of the BUDGET object on
        // shared budgets only, so a campaign-level total is reported absent rather than
        // guessed from a daily rate times a flight length.
        totalBudgetCents: null,
        currency: identity.currency,
        startsAtISO: toISO(c.StartDate),
        endsAtISO: toISO(c.EndDate),
      };
    });
  },

  async createCampaign(call, fields, draft, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the account ID');
    const campaignType = mapObjective(microsoftAdsProvider, OBJECTIVES, draft.objective);
    const daily = fromCents(draft.dailyBudgetCents, MAJOR);

    const result = await ask(call, 'add_campaigns', {
      AccountId: accountId,
      Campaigns: wrap('Campaign', [{
        Name: draft.name,
        CampaignType: campaignType,
        Status: fromStatus(draft.status) ?? 'Paused',
        DailyBudget: daily ?? undefined,
        BudgetType: 'DailyBudgetStandard',
        TimeZone: 'PacificTimeUSCanadaTijuana',
        ...(draft.endsAtISO ? { EndDate: draft.endsAtISO } : {}),
      }]),
    });
    // `AddCampaigns` answers with a parallel array of ids and one of per-item errors.
    const id = list(rec(rec(result.data).CampaignIds).long ?? rec(result.data).CampaignIds).map(text).find(Boolean) ?? '';
    if (!id) {
      const reason = text(rec(unwrap(rec(result.data).PartialErrors, 'BatchError')[0]).Message);
      throw new AdsProviderError(
        reason || 'Microsoft Advertising accepted the campaign but did not return its id.',
        reason ? 400 : 502,
        !reason,
      );
    }

    return {
      externalId: id,
      name: draft.name,
      status: draft.status ?? 'paused',
      nativeObjective: campaignType,
      objective: draft.objective,
      dailyBudgetCents: draft.dailyBudgetCents ?? null,
      totalBudgetCents: null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateCampaign(call, fields, externalId, patch) {
    const accountId = requireField(fields, 'adAccountId', 'the account ID');
    const status = fromStatus(patch.status);
    const daily = fromCents(patch.dailyBudgetCents, MAJOR);
    if (!patch.name && !status && daily == null) return;
    await ask(call, 'update_campaigns', {
      AccountId: accountId,
      Campaigns: wrap('Campaign', [{
        Id: externalId,
        ...(patch.name ? { Name: patch.name } : {}),
        ...(status ? { Status: status } : {}),
        ...(daily != null ? { DailyBudget: daily, BudgetType: 'DailyBudgetStandard' } : {}),
      }]),
    });
  },

  // ── Ad groups (this port's ad set) ───────────────────────────────────────

  async listAdSets(call, fields, identity, externalCampaignId) {
    /*
     * `GetAdGroupsByCampaignId` is the only ad-group read Microsoft offers — there is no
     * account-wide edge. So an unscoped call reads the account's campaigns first and then
     * their groups: a request per campaign by construction, not an N+1 this adapter
     * chose. The same shape as the Snapchat squad read, for the same reason.
     */
    const campaignIds = externalCampaignId
      ? [externalCampaignId]
      : (await microsoftAdsProvider.listCampaigns(call, fields, identity)).map((c) => c.externalId);

    const sets: AdSetRemote[] = [];
    for (const campaignId of campaignIds) {
      const result = await ask(call, 'get_ad_groups', { CampaignId: campaignId });
      const groups = unwrap(rec(result.data).AdGroups, 'AdGroup');
      for (const group of groups) {
        const id = text(group.Id);
        // Targeting is a SEPARATE collection per group — see `criterionsFor`.
        const criterionResult = await ask(call, 'get_ad_group_criterions', { AdGroupId: id, CriterionType: 'Targets' });
        const criterions = unwrap(rec(criterionResult.data).AdGroupCriterions, 'AdGroupCriterion');
        sets.push({
          externalId: id,
          externalCampaignId: campaignId,
          name: text(group.Name),
          status: toStatus(group.Status),
          targeting: readCriterions(criterions),
          nativeTargeting: criterions.length ? criterions : null,
          bidStrategy: text(rec(group.BiddingScheme).Type) || null,
          bidCents: amountCents(rec(group.CpcBid).Amount ?? group.CpcBid),
          // The budget is on the CAMPAIGN on Microsoft; an ad group carries a bid.
          dailyBudgetCents: null,
          currency: identity.currency,
          startsAtISO: toISO(group.StartDate),
          endsAtISO: toISO(group.EndDate),
        });
      }
    }
    return sets;
  },

  async createAdSet(call, fields, draft, identity) {
    // Refused before anything is written, never after.
    requireTargetingSupport(microsoftAdsProvider, draft.targeting);
    const bid = fromCents(draft.bidCents, MAJOR);

    const result = await ask(call, 'add_ad_groups', {
      CampaignId: draft.externalCampaignId,
      AdGroups: wrap('AdGroup', [{
        Name: draft.name,
        Status: fromStatus(draft.status) ?? 'Paused',
        ...(bid ? { CpcBid: { Amount: bid } } : {}),
        ...(draft.startsAtISO ? { StartDate: draft.startsAtISO } : {}),
        ...(draft.endsAtISO ? { EndDate: draft.endsAtISO } : {}),
      }]),
    });
    const id = list(rec(rec(result.data).AdGroupIds).long ?? rec(result.data).AdGroupIds).map(text).find(Boolean) ?? '';
    if (!id) {
      const reason = text(rec(unwrap(rec(result.data).PartialErrors, 'BatchError')[0]).Message);
      throw new AdsProviderError(
        reason || 'Microsoft Advertising accepted the ad group but did not return its id.',
        reason ? 400 : 502,
        !reason,
      );
    }

    const criterions = criterionsFor(draft.targeting, id);
    if (criterions.length) {
      await ask(call, 'add_ad_group_criterions', {
        AdGroupCriterions: wrap('AdGroupCriterion', criterions),
        CriterionType: 'Targets',
      });
    }

    return {
      externalId: id,
      externalCampaignId: draft.externalCampaignId,
      name: draft.name,
      status: draft.status ?? 'paused',
      targeting: draft.targeting,
      nativeTargeting: criterions.length ? criterions : null,
      bidStrategy: bid ? 'ManualCpc' : null,
      bidCents: draft.bidCents ?? null,
      dailyBudgetCents: null,
      currency: identity.currency,
      startsAtISO: draft.startsAtISO ?? null,
      endsAtISO: draft.endsAtISO ?? null,
    };
  },

  async updateAdSet(call, _fields, externalId, patch) {
    const status = fromStatus(patch.status);
    const bid = fromCents(patch.bidCents, MAJOR);

    if (patch.name || status || bid) {
      await ask(call, 'update_ad_groups', {
        // The parent campaign is a required parameter on this operation but is not needed
        // to identify the group; Microsoft accepts 0 when the ids are unambiguous.
        CampaignId: 0,
        AdGroups: wrap('AdGroup', [{
          Id: externalId,
          ...(patch.name ? { Name: patch.name } : {}),
          ...(status ? { Status: status } : {}),
          ...(bid ? { CpcBid: { Amount: bid } } : {}),
        }]),
      });
    }
    if (!patch.targeting) return;

    /*
     * A REPLACEMENT spec, not a merge — and like X, that has to be spelled out here,
     * because targeting is a COLLECTION of criterion rows. Adding the new rows without
     * removing the old ones would UNION the two audiences: an ad group re-targeted from
     * 25-34 to 50-64 would run against both, at the full bid, and look healthy doing it.
     *
     * Microsoft has no "replace" — the existing rows are read and deleted first.
     */
    const existing = unwrap(
      rec((await ask(call, 'get_ad_group_criterions', { AdGroupId: externalId, CriterionType: 'Targets' })).data).AdGroupCriterions,
      'AdGroupCriterion',
    );
    const ids = existing.map((row) => text(row.Id)).filter(Boolean);
    if (ids.length) {
      await ask(call, 'add_ad_group_criterions', {
        AdGroupCriterions: wrap('AdGroupCriterion', existing.map((row) => ({ ...row, Status: 'Deleted' }))),
        CriterionType: 'Targets',
      });
    }
    const criterions = criterionsFor(patch.targeting, externalId);
    if (criterions.length) {
      await ask(call, 'add_ad_group_criterions', {
        AdGroupCriterions: wrap('AdGroupCriterion', criterions),
        CriterionType: 'Targets',
      });
    }
  },

  // ── Ads ──────────────────────────────────────────────────────────────────

  async listAds(call, fields, identity, externalAdSetId) {
    const adGroupIds = externalAdSetId
      ? [externalAdSetId]
      : (await microsoftAdsProvider.listAdSets(call, fields, identity, null)).map((set) => set.externalId);

    const ads: AdCreativeRemote[] = [];
    for (const adGroupId of adGroupIds) {
      const result = await ask(call, 'get_ads', {
        AdGroupId: adGroupId,
        AdTypes: wrap('AdType', ['ResponsiveSearch', 'ExpandedText']),
      });
      for (const ad of unwrap(rec(result.data).Ads, 'Ad')) {
        const headlines = unwrap(ad.Headlines, 'AssetLink').map((link) => text(rec(link.Asset).Text)).filter(Boolean);
        const descriptions = unwrap(ad.Descriptions, 'AssetLink').map((link) => text(rec(link.Asset).Text)).filter(Boolean);
        ads.push({
          externalId: text(ad.Id),
          externalAdSetId: adGroupId,
          // A Microsoft ad has no name of its own — its first headline is what a person
          // reading a list would recognise it by.
          name: headlines[0] || text(ad.Title) || text(ad.Id),
          status: toStatus(ad.Status),
          headline: headlines.join('\n') || text(ad.Title) || null,
          body: descriptions.join('\n') || text(ad.Text) || null,
          callToAction: null,
          destinationUrl: unwrap(ad.FinalUrls, 'string').map(text).find(Boolean)
            ?? list(rec(ad.FinalUrls).string).map(text).find(Boolean)
            ?? null,
        });
      }
    }
    return ads;
  },

  async createAd(call, _fields, draft) {
    const link = (draft.destinationUrl ?? '').trim();
    if (!link) throw new AdsProviderError('A Microsoft Advertising search ad needs a final URL — that is what the click buys.', 400, false);

    const headlines = (draft.headline ?? '').split(/[\n|]/).map((part) => part.trim()).filter(Boolean);
    const descriptions = (draft.body ?? '').split(/[\n|]/).map((part) => part.trim()).filter(Boolean);
    if (headlines.length < 3 || descriptions.length < 2) {
      // Microsoft's own minimum for a responsive search ad, refused here by name rather
      // than as a vendor error code — and never padded with generated copy, which would
      // put words nobody wrote in front of a paying audience.
      throw new AdsProviderError(
        'A Microsoft responsive search ad needs at least 3 headlines (30 characters each) and 2 descriptions (90 characters each). '
        + 'Separate them with newlines or | in the headline and body fields.',
        400,
        false,
      );
    }

    const result = await ask(call, 'add_ads', {
      AdGroupId: draft.externalAdSetId,
      Ads: wrap('Ad', [{
        'i:type': 'ResponsiveSearchAd',
        Status: fromStatus(draft.status) ?? 'Paused',
        FinalUrls: wrap('string', [link]),
        Headlines: wrap('AssetLink', headlines.slice(0, 15).map((value) => ({ Asset: { 'i:type': 'TextAsset', Text: value.slice(0, 30) } }))),
        Descriptions: wrap('AssetLink', descriptions.slice(0, 4).map((value) => ({ Asset: { 'i:type': 'TextAsset', Text: value.slice(0, 90) } }))),
      }]),
    });
    const id = list(rec(rec(result.data).AdIds).long ?? rec(result.data).AdIds).map(text).find(Boolean) ?? '';
    if (!id) {
      const reason = text(rec(unwrap(rec(result.data).PartialErrors, 'BatchError')[0]).Message);
      throw new AdsProviderError(
        reason || 'Microsoft Advertising accepted the ad but did not return its id.',
        reason ? 400 : 502,
        !reason,
      );
    }

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

  async updateAd(call, _fields, externalId, patch) {
    const status = fromStatus(patch.status);
    // Only STATUS is patchable. Microsoft re-reviews changed creative text, so a copy
    // edit is a new ad — which `AdPatch` already declines to offer.
    if (!status) return;
    await ask(call, 'update_ads', {
      // As with ad groups, the parent is required by the operation but not needed to
      // identify the ad.
      AdGroupId: 0,
      Ads: wrap('Ad', [{ Id: externalId, Status: status }]),
    });
  },

  async insights(call, fields, query, identity) {
    const accountId = requireField(fields, 'adAccountId', 'the account ID');

    // ── 1. SUBMIT ──────────────────────────────────────────────────────────
    const [sinceY, sinceM, sinceD] = query.since.split('-').map(Number);
    const [untilY, untilM, untilD] = query.until.split('-').map(Number);
    const submitted = await ask(call, 'submit_report', {
      ReportRequest: {
        'i:type': 'CampaignPerformanceReportRequest',
        Format: 'Csv',
        ReportName: 'Builderforce campaign performance',
        // Daily rows — the grain `ad_insights` stores and every network bills on.
        Aggregation: 'Daily',
        // The columns this port reads and nothing else: a wider report is a bigger
        // download and a longer wait for numbers nobody asked for.
        Columns: wrap('CampaignPerformanceReportColumn', [
          'TimePeriod', 'CampaignId', 'Spend', 'Impressions', 'Clicks', 'Conversions',
        ]),
        Scope: {
          AccountIds: wrap('long', [accountId]),
          ...(query.externalCampaignIds?.length
            ? { Campaigns: wrap('CampaignReportScope', query.externalCampaignIds.map((id) => ({ AccountId: accountId, CampaignId: id }))) }
            : {}),
        },
        Time: {
          CustomDateRangeStart: { Day: sinceD ?? 1, Month: sinceM ?? 1, Year: sinceY ?? 1970 },
          CustomDateRangeEnd: { Day: untilD ?? 1, Month: untilM ?? 1, Year: untilY ?? 1970 },
          // The account's own timezone, which is the grain the spend is billed in.
          ReportTimeZone: 'PacificTimeUSCanadaTijuana',
        },
      },
    });
    const requestId = text(rec(submitted.data).ReportRequestId);
    if (!requestId) {
      throw new AdsProviderError('Microsoft Advertising accepted the report request but did not return its id.', 502, true);
    }

    // ── 2. POLL ────────────────────────────────────────────────────────────
    let downloadUrl = '';
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const polled = rec(rec((await ask(call, 'poll_report', { ReportRequestId: requestId })).data).ReportRequestStatus);
      const status = text(polled.Status);
      if (status === 'Success') {
        downloadUrl = text(polled.ReportDownloadUrl);
        break;
      }
      if (status === 'Error') {
        throw new AdsProviderError('Microsoft Advertising could not generate the report.', 502, true);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!downloadUrl) {
      /*
       * Not ready inside the request's budget. RETRYABLE and empty — never zero rows
       * presented as a real answer: the insights sweep upserts what it is given, so
       * reporting "no spend" here would overwrite real numbers with zeroes and the
       * dashboard would show a campaign that stopped working.
       */
      throw new AdsProviderError(
        'Microsoft Advertising is still generating this report. It will be read on the next sync.',
        202,
        true,
      );
    }

    // ── 3. DOWNLOAD ────────────────────────────────────────────────────────
    // Through the connector runtime (`in: 'url'`), so the vendor-supplied URL still gets
    // the SSRF guard and the audit row every other call gets.
    const archive = await downloadReport(call, downloadUrl);
    const body = archive.data;
    const bytes = body instanceof ArrayBuffer
      ? new Uint8Array(body)
      : ArrayBuffer.isView(body)
        ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
        : null;
    if (!bytes) {
      throw new AdsProviderError('Microsoft Advertising returned a report this build could not read.', 502, true);
    }

    // A single-entry zip containing the CSV.
    const entries = unzipSync(bytes);
    const csv = Object.entries(entries)
      .filter(([name]) => name.toLowerCase().endsWith('.csv'))
      .map(([, content]) => strFromU8(content))
      .join('\n');
    return parseReportCsv(csv, identity.currency);
  },
};
