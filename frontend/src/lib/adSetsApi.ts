/**
 * THE TWO LEVELS BENEATH A CAMPAIGN — ad sets, and the ads inside them.
 *
 * Server counterpart: `api/src/presentation/routes/adSetRoutes.ts` over
 * `application/advertising/adSetService.ts`. This is a SEPARATE client from `adsApi`
 * for the same reason that is a separate service: `adsApi` owns the account and the
 * campaign, this owns the audience and the creative. One reason to change each — a new
 * targeting dimension touches this file and nothing in that one.
 *
 * ── THE TARGETING VOCABULARY IS MIRRORED, NOT REIMPLEMENTED ──────────────────
 * The words below (`AD_PLACEMENTS`, `AD_DEVICES`, `AD_GENDERS`, the age bounds) are the
 * wire vocabulary `adTargeting.ts` defines and `parseTargeting` validates, restated here
 * as TYPES the way `AdObjective` and `AdStatus` already are — a browser bundle cannot
 * import server code, and a form that offers a word the parser rejects is a 400 nobody
 * can act on.
 *
 * What is deliberately NOT restated is the VALIDATION. A second copy of "GB is a country
 * code, gb is not" is precisely how one surface comes to mean something the other does
 * not; so this client builds a spec out of controls that can only produce valid values
 * (pickers for the enums, an uppercasing two-letter field for countries) and lets the
 * server's one parser be the judge, surfacing its refusal verbatim.
 *
 * ── MONEY IS A DECIMAL IN, CENTS OUT ─────────────────────────────────────────
 * `dailyBudget` and `bid` on the WRITE calls are the decimal a person typed — the server
 * multiplies, so rounding happens once. Everything READ back is an integer of cents,
 * exactly as `adsApi` documents.
 */

import { apiRequest } from './apiClient';
import type { AdNetwork, AdObjective, AdStatus } from './adsApi';

const ADS = '/api/ads';
const json = { 'Content-Type': 'application/json' };

// ---------------------------------------------------------------------------
// The targeting vocabulary
// ---------------------------------------------------------------------------

/** The dimensions of a targeting spec — a network refuses any it cannot place BY NAME,
 *  so a surface must only offer the ones the chosen account declares. */
export const AD_TARGETING_DIMENSIONS = ['geo', 'age', 'gender', 'interests', 'placements', 'devices'] as const;
export type AdTargetingDimension = typeof AD_TARGETING_DIMENSIONS[number];

/** Which surfaces an ad may appear on, normalized to the five every network names. */
export const AD_PLACEMENTS = ['feed', 'search', 'stories', 'video', 'audience_network'] as const;
export type AdPlacement = typeof AD_PLACEMENTS[number];

export const AD_DEVICES = ['mobile', 'desktop', 'tablet'] as const;
export type AdDevice = typeof AD_DEVICES[number];

/** Absent means every gender, which is what a network does with no filter. Selecting
 *  ALL of them is therefore the same as selecting none — see {@link normalizeGenders}. */
export const AD_GENDERS = ['male', 'female'] as const;
export type AdGender = typeof AD_GENDERS[number];

/** The youngest age any of these networks will accept. Below it the request is unlawful
 *  in most markets they operate in and every one of them rejects it. */
export const AD_MIN_AGE = 13;
/** The top of every network's age model. At it, "65" means "65 and over". */
export const AD_MAX_AGE = 65;

/** Who a campaign's money is spent on. Every field optional; absent means unrestricted. */
export interface AdTargeting {
  /** ISO 3166-1 alpha-2, upper case. */
  countries?: string[];
  ageMin?: number;
  ageMax?: number;
  /** Never an empty array and never every gender — both mean "unrestricted", and
   *  storing either as a constraint makes an open audience read as a narrowed one. */
  genders?: AdGender[];
  /** Interest or keyword PHRASES. */
  interests?: string[];
  placements?: AdPlacement[];
  devices?: AdDevice[];
}

/**
 * Which dimensions a spec actually CONSTRAINS.
 *
 * An absent key or an empty list is not a constraint, so it is not a dimension the
 * network has to support. The mirror of `targetingDimensionsUsed` on the server, and
 * the reason a form can tell "this audience is everyone" from "this audience is narrow"
 * without a round trip.
 */
export function targetingDimensionsUsed(targeting: AdTargeting): AdTargetingDimension[] {
  const used: AdTargetingDimension[] = [];
  if (targeting.countries?.length) used.push('geo');
  if (targeting.ageMin != null || targeting.ageMax != null) used.push('age');
  if (targeting.genders?.length) used.push('gender');
  if (targeting.interests?.length) used.push('interests');
  if (targeting.placements?.length) used.push('placements');
  if (targeting.devices?.length) used.push('devices');
  return used;
}

/** True when nothing at all is constrained — the caller asked for everyone. */
export const isUntargeted = (targeting: AdTargeting): boolean =>
  targetingDimensionsUsed(targeting).length === 0;

/**
 * Every gender ticked is not a constraint — it is the default.
 *
 * Sending it as one makes an unrestricted audience read as a targeted one on every
 * panel that reads it back, which is the server's own rule (`parseTargeting` drops a
 * full set). Applied at the control rather than after the round trip, so the form and
 * the stored spec never disagree about what the person selected.
 */
export function normalizeGenders(selected: readonly AdGender[]): AdGender[] | undefined {
  return selected.length > 0 && selected.length < AD_GENDERS.length ? [...selected] : undefined;
}

// ---------------------------------------------------------------------------
// What the two levels look like
// ---------------------------------------------------------------------------

export interface AdSet {
  externalId: string;
  /** The campaign it hangs from. Null only when a network's list call omits it. */
  externalCampaignId: string | null;
  name: string;
  status: AdStatus;
  /** As much of the network's spec as the shared vocabulary has a name for. */
  targeting: AdTargeting;
  /** The network's OWN spec, verbatim — a set built in its console uses audiences and
   *  match types this vocabulary cannot express, and reporting "no targeting" for a set
   *  that is in fact tightly targeted would be worse than reporting a blob. */
  nativeTargeting: unknown;
  bidStrategy: string | null;
  bidCents: number | null;
  dailyBudgetCents: number | null;
  currency: string;
  startsAtISO: string | null;
  endsAtISO: string | null;
  /** The mirrored `ad_sets` row id. Null when the mirror could not resolve a parent. */
  id: number | null;
}

/** One ad — the creative a person actually sees. */
export interface AdCreative {
  externalId: string;
  externalAdSetId: string | null;
  name: string;
  status: AdStatus;
  headline: string | null;
  body: string | null;
  callToAction: string | null;
  /** UTM-tagged by the SERVER before any adapter saw it — this is the real destination,
   *  not what was typed. */
  destinationUrl: string | null;
  id: number | null;
}

/** Which account a call is about. One of the two, exactly as the routes resolve it. */
export interface AdAccountRef {
  connectionId?: string;
  network?: AdNetwork;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const adSetsApi = {
  /** The ad sets on an account, optionally only those under one campaign. */
  adSets: (ref: AdAccountRef & { campaignId?: string } = {}): Promise<{ adSets: AdSet[] }> =>
    apiRequest(`${ADS}/adsets${query({
      connectionId: ref.connectionId, network: ref.network, campaignId: ref.campaignId,
    })}`),

  /** Creates PAUSED unless `launch` is true. An ad set carries the daily budget on most
   *  networks, so creating one is exactly as expensive a mistake as a campaign. */
  createAdSet: (input: AdAccountRef & {
    campaignId: string;
    name: string;
    objective: AdObjective;
    targeting?: AdTargeting;
    dailyBudget?: number;
    bid?: number;
    startsAt?: string;
    endsAt?: string;
    launch?: boolean;
  }): Promise<{ created: true; adSet: AdSet }> =>
    apiRequest(`${ADS}/adsets`, { method: 'POST', headers: json, body: JSON.stringify(input) }),

  /** Rename, re-budget, RE-TARGET, pause or resume. `targeting` REPLACES the spec —
   *  every network replaces rather than merges, so a partial one drops what it omits. */
  updateAdSet: (externalId: string, input: AdAccountRef & {
    name?: string;
    status?: AdStatus;
    dailyBudget?: number | null;
    bid?: number | null;
    targeting?: AdTargeting;
  }): Promise<{ updated: true }> =>
    apiRequest(`${ADS}/adsets/${encodeURIComponent(externalId)}`, {
      method: 'PATCH', headers: json, body: JSON.stringify(input),
    }),

  /** The creatives in one ad set. */
  ads: (ref: AdAccountRef & { adSetId?: string } = {}): Promise<{ ads: AdCreative[] }> =>
    apiRequest(`${ADS}/ads${query({
      connectionId: ref.connectionId, network: ref.network, adSetId: ref.adSetId,
    })}`),

  /**
   * Create one ad. The destination URL is UTM-tagged SERVER-SIDE from the campaign's
   * own stored tag, so `utmCampaign` comes back to be shown: a person can see the
   * attribution their clicks will carry now, rather than discover it in a report.
   */
  createAd: (input: AdAccountRef & {
    adSetId: string;
    name: string;
    headline?: string;
    body?: string;
    callToAction?: string;
    destinationUrl?: string;
    creativeRef?: string;
    launch?: boolean;
  }): Promise<{ created: true; ad: AdCreative; utmCampaign: string | null }> =>
    apiRequest(`${ADS}/ads`, { method: 'POST', headers: json, body: JSON.stringify(input) }),

  /** Rename, pause or resume. Deliberately small: on every one of these networks a live
   *  ad's copy and destination are immutable — a changed creative is re-reviewed, so it
   *  is a NEW ad rather than an edit. */
  updateAd: (externalId: string, input: AdAccountRef & {
    name?: string;
    status?: AdStatus;
  }): Promise<{ updated: true }> =>
    apiRequest(`${ADS}/ads/${encodeURIComponent(externalId)}`, {
      method: 'PATCH', headers: json, body: JSON.stringify(input),
    }),
};
