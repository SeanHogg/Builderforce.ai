/**
 * Google, Meta, LinkedIn, TikTok, X, Reddit, Pinterest and Snapchat behind ONE ads port.
 *
 * The board asks four questions of a connected ad account — "which account is this",
 * "what is running", "run this", and "what did it cost and return" — and eight networks
 * answer them in eight different shapes. Normalizing here is what lets the campaign
 * ledger, the insights sweep, the canvas tile, the MCP tools and the CMO agent be
 * written once, exactly as {@link ../social/socialProviders} does for organic posts.
 *
 * ── CREDENTIALS ARE NOT STORED HERE ──────────────────────────────────────────
 * An ad account is a CONNECTOR CONNECTION (`connector_connections`). The eight built-in
 * manifests in `connectors/defaults/advertising.ts` declare the auth fields, endpoints
 * and SSRF-guarded runtime; this port only decides which action to call and what the
 * answer means. A ninth network is a manifest plus an adapter, never a subsystem.
 *
 * ── MONEY HAS ONE UNIT ───────────────────────────────────────────────────────
 * Every network bills in a different unit: Google, X, Reddit and Pinterest in MICROS,
 * Meta in the currency's MINOR unit for budgets but a decimal-string MAJOR unit for
 * reported spend, TikTok in the MAJOR unit throughout. Adapters convert to INTEGER
 * CENTS on both directions, because that is what `ad_campaigns.daily_budget_cents` and
 * `ad_insights.spend_cents` store. A float here becomes a wrong number on a finance
 * page later, so the conversion happens once, in {@link toCents}, and never inline.
 *
 * ── OBJECTIVES ARE NORMALIZED, NOT PASSED THROUGH ────────────────────────────
 * "Get me leads" must mean the same thing on all eight. Each adapter maps the shared
 * {@link AdObjective} vocabulary onto its own name and REFUSES an objective it cannot
 * serve, so one campaign can fan out across networks without the caller learning eight
 * enums — and without a silent fallback quietly buying awareness with a leads budget.
 */

import type { AdTargeting, AdTargetingDimension } from './adTargeting';
import { googleAdsProvider } from './networks/google';
import { metaAdsProvider } from './networks/meta';
import { linkedinAdsProvider } from './networks/linkedin';
import { tiktokAdsProvider } from './networks/tiktok';
import { xAdsProvider } from './networks/x';
import { redditAdsProvider } from './networks/reddit';
import { pinterestAdsProvider } from './networks/pinterest';
import { snapchatAdsProvider } from './networks/snapchat';
import { microsoftAdsProvider } from './networks/microsoft';

/** The networks this deployment can spend on. */
export const AD_NETWORKS = ['google', 'meta', 'linkedin', 'tiktok', 'x', 'reddit', 'pinterest', 'snapchat', 'microsoft'] as const;
export type AdNetwork = typeof AD_NETWORKS[number];

export function isAdNetwork(value: unknown): value is AdNetwork {
  return typeof value === 'string' && (AD_NETWORKS as readonly string[]).includes(value);
}

/** What a campaign is trying to buy, in one vocabulary across every network. */
export const AD_OBJECTIVES = ['awareness', 'traffic', 'engagement', 'leads', 'conversions', 'app_installs', 'video_views'] as const;
export type AdObjective = typeof AD_OBJECTIVES[number];

export function isAdObjective(value: unknown): value is AdObjective {
  return typeof value === 'string' && (AD_OBJECTIVES as readonly string[]).includes(value);
}

/**
 * Delivery state, normalized.
 *
 * Deliberately NOT the union of eight vendor enums: `draft` and `paused` differ in
 * whether the object has ever been eligible to spend, and that is the only distinction
 * a person or an agent needs before deciding whether to touch it.
 */
export const AD_STATUSES = ['draft', 'paused', 'active', 'ended', 'archived'] as const;
export type AdStatus = typeof AD_STATUSES[number];

/** A non-secret field the connection must carry before this network can be spent on. */
export interface AdAccountField {
  key: string;
  label: string;
  help: string;
  /** Declared, asked for and named in errors — but it does not gate `ready`. See
   *  {@link ../integrations/connectedAccounts}.AccountFieldSpec. */
  optional?: boolean;
}

export interface AdAccountIdentity {
  externalId: string;
  name: string;
  /** ISO 4217. Every budget and every reported spend on this account is in it. */
  currency: string;
}

/** One campaign as the network currently reports it. */
export interface AdCampaignRemote {
  externalId: string;
  name: string;
  status: AdStatus;
  /** The network's OWN objective string — kept verbatim because a campaign created
   *  outside Builderforce may use an objective our vocabulary has no name for. */
  nativeObjective: string | null;
  objective: AdObjective | null;
  dailyBudgetCents: number | null;
  totalBudgetCents: number | null;
  currency: string;
  startsAtISO: string | null;
  endsAtISO: string | null;
}

/** What creating a campaign carries. Network-neutral by construction. */
export interface AdCampaignDraft {
  name: string;
  objective: AdObjective;
  dailyBudgetCents?: number | null;
  totalBudgetCents?: number | null;
  startsAtISO?: string | null;
  endsAtISO?: string | null;
  /** Campaigns are created PAUSED unless the caller is explicit. Nothing in this port
   *  starts spending as a side effect of being written down. */
  status?: Extract<AdStatus, 'paused' | 'active'>;
}

/** The subset of a campaign that can be changed after it exists. */
export interface AdCampaignPatch {
  name?: string;
  dailyBudgetCents?: number | null;
  totalBudgetCents?: number | null;
  status?: AdStatus;
}

// ---------------------------------------------------------------------------
// The two levels BENEATH a campaign
// ---------------------------------------------------------------------------

/**
 * A campaign says what is being bought and how much may be spent. It does not say WHO
 * it is shown to or WHAT they see — those are the ad set and the ad, and without them
 * a funded campaign is inert on every one of these networks. A campaign this platform
 * created but could not target or fill is a campaign that has to be finished in the
 * network's own console, which is the same as not having created it.
 *
 * The vendors' names for these two levels are all different — ad set, ad group, line
 * item, ad squad — and all mean the same two things, so they are named once here.
 */

/** One ad set as the network currently reports it. */
export interface AdSetRemote {
  externalId: string;
  /** The campaign it hangs from. Null only when a network's list call omits it. */
  externalCampaignId: string | null;
  name: string;
  status: AdStatus;
  /** As much of the network's spec as this vocabulary has a name for. */
  targeting: AdTargeting;
  /** The network's OWN spec, verbatim — kept because a set built in its console uses
   *  audiences and match types this port has no name for, and reporting "no targeting"
   *  for a set that is in fact tightly targeted is worse than reporting a blob. */
  nativeTargeting: unknown;
  bidStrategy: string | null;
  bidCents: number | null;
  dailyBudgetCents: number | null;
  currency: string;
  startsAtISO: string | null;
  endsAtISO: string | null;
}

/** What creating an ad set carries. Network-neutral by construction. */
export interface AdSetDraft {
  /** The network's own campaign id — an ad set never exists on its own. */
  externalCampaignId: string;
  name: string;
  /**
   * What the PARENT campaign is buying.
   *
   * Carried down rather than looked up because several networks declare the objective
   * at this level and not above it — an X line item IS where the objective lives, and a
   * TikTok ad group's optimization goal must agree with it. Passing it explicitly is
   * what lets those adapters be correct without a second read of the campaign.
   */
  objective: AdObjective;
  targeting: AdTargeting;
  dailyBudgetCents?: number | null;
  /** A bid CAP, in cents. Absent means the network's automatic bidding. */
  bidCents?: number | null;
  startsAtISO?: string | null;
  endsAtISO?: string | null;
  /** Paused unless the caller is explicit — same rule as a campaign, same reason. */
  status?: Extract<AdStatus, 'paused' | 'active'>;
}

/** The subset of an ad set that can be changed after it exists. */
export interface AdSetPatch {
  name?: string;
  status?: AdStatus;
  dailyBudgetCents?: number | null;
  bidCents?: number | null;
  /** A REPLACEMENT spec, not a merge — every network replaces rather than merges here,
   *  and pretending otherwise would drop the dimensions the caller left out. */
  targeting?: AdTargeting;
}

/** One ad — the creative a person actually sees — as the network reports it. */
export interface AdCreativeRemote {
  externalId: string;
  externalAdSetId: string | null;
  name: string;
  status: AdStatus;
  headline: string | null;
  body: string | null;
  callToAction: string | null;
  destinationUrl: string | null;
}

/** What creating an ad carries. */
export interface AdDraft {
  externalAdSetId: string;
  name: string;
  headline?: string | null;
  body?: string | null;
  callToAction?: string | null;
  /**
   * Where the click lands. UTM-tagged by `adSetService` BEFORE it reaches an adapter,
   * so no adapter has to know about attribution and none of them can forget to.
   */
  destinationUrl?: string | null;
  /**
   * A network-native creative, post or pin id, when the ad promotes something that
   * already exists rather than new copy. Networks that can only promote existing
   * content (Pinterest, X) REQUIRE it and say so rather than inventing a creative.
   */
  creativeRef?: string | null;
  status?: Extract<AdStatus, 'paused' | 'active'>;
}

/** The subset of an ad that can be changed after it exists. Deliberately small: on
 *  every one of these networks a live ad's copy and destination are immutable — the
 *  network re-reviews a changed creative, so it is a new ad, not an edit. */
export interface AdPatch {
  name?: string;
  status?: AdStatus;
}

/** One day of delivery for one campaign, normalized. A network that does not report a
 *  number reports 0 — never a guess, and never a key the caller must defend against. */
export interface AdInsightRow {
  /** YYYY-MM-DD in the AD ACCOUNT's timezone, which is the grain every network bills on. */
  date: string;
  externalCampaignId: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
}

export interface AdInsightQuery {
  /** Inclusive YYYY-MM-DD bounds. */
  since: string;
  until: string;
  /** Restrict to these campaigns. Empty means every campaign on the account — which
   *  several networks refuse, so adapters that require ids say so rather than guess. */
  externalCampaignIds?: readonly string[];
}

export interface AdCallResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
  headers?: Record<string, string>;
}

/** How an adapter reaches its network: one connector action, already credentialed,
 *  SSRF-guarded and audit-logged by the connector runtime. */
export type AdCall = (
  actionKey: string,
  input?: Record<string, unknown>,
  opts?: { captureHeaders?: readonly string[] },
) => Promise<AdCallResult>;

export interface AdsProvider {
  network: AdNetwork;
  label: string;
  /** The built-in connector manifest this network runs on. */
  connectorKey: string;
  accountFields: readonly AdAccountField[];
  /** The objectives this network can actually serve. */
  objectives: readonly AdObjective[];
  /** The targeting dimensions this adapter can actually PLACE. Anything else is
   *  refused by {@link requireTargetingSupport} rather than dropped. */
  targetingDimensions: readonly AdTargetingDimension[];
  /**
   * True when a campaign on this network CANNOT DELIVER without an ad set beneath it.
   *
   * Reddit keeps the daily budget on the ad group and X declares the objective on the
   * line item, so on both a campaign with nothing under it is a funded object that can
   * never spend and never reports a number. Both adapters used to paper over this with
   * their own inline create inside `createCampaign`; declaring it here instead is what
   * lets `adsService` compose ONE default ad set through the same `createAdSet` every
   * other caller uses, rather than two hand-rolled copies drifting apart.
   */
  requiresAdSet: boolean;
  /** Ads that promote EXISTING content need a `creativeRef`; adapters that cannot
   *  author new copy say so here so a form can ask for it up front. */
  requiresCreativeRef: boolean;
  identity(call: AdCall, fields: Record<string, string>): Promise<AdAccountIdentity>;
  listCampaigns(call: AdCall, fields: Record<string, string>, identity: AdAccountIdentity): Promise<AdCampaignRemote[]>;
  createCampaign(call: AdCall, fields: Record<string, string>, draft: AdCampaignDraft, identity: AdAccountIdentity): Promise<AdCampaignRemote>;
  updateCampaign(call: AdCall, fields: Record<string, string>, externalId: string, patch: AdCampaignPatch, identity: AdAccountIdentity): Promise<void>;
  insights(call: AdCall, fields: Record<string, string>, query: AdInsightQuery, identity: AdAccountIdentity): Promise<AdInsightRow[]>;

  /** Every ad set on the account, or only those under one campaign. */
  listAdSets(call: AdCall, fields: Record<string, string>, identity: AdAccountIdentity, externalCampaignId?: string | null): Promise<AdSetRemote[]>;
  createAdSet(call: AdCall, fields: Record<string, string>, draft: AdSetDraft, identity: AdAccountIdentity): Promise<AdSetRemote>;
  updateAdSet(call: AdCall, fields: Record<string, string>, externalId: string, patch: AdSetPatch, identity: AdAccountIdentity): Promise<void>;
  listAds(call: AdCall, fields: Record<string, string>, identity: AdAccountIdentity, externalAdSetId?: string | null): Promise<AdCreativeRemote[]>;
  createAd(call: AdCall, fields: Record<string, string>, draft: AdDraft, identity: AdAccountIdentity): Promise<AdCreativeRemote>;
  updateAd(call: AdCall, fields: Record<string, string>, externalId: string, patch: AdPatch, identity: AdAccountIdentity): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared normalization — re-exported from ./adsNormalize
// ---------------------------------------------------------------------------

/**
 * The helpers live in `./adsNormalize` and are re-exported here so every existing
 * import site is unchanged. They are a separate MODULE because the registry below
 * imports the adapters, the adapters import these, and a value cycle put
 * `ADS_CONNECTOR_KEYS` in the temporal dead zone. See that file's header.
 */
export {
  AdsProviderError, isRetryableAdStatus,
  rec, list, text, count, toCents, fromCents, toISO, toDay, ask, requireField,
  mapObjective, unmapObjective, totalInsights,
} from './adsNormalize';

/**
 * The targeting vocabulary lives in `./adTargeting` for the same reason the money and
 * objective helpers live in `./adsNormalize`: adapters import VALUES from it, and this
 * module imports the adapters. Re-exported so a caller reaching for the ads port finds
 * the whole vocabulary in one place.
 */
export {
  AD_TARGETING_DIMENSIONS, AD_PLACEMENTS, AD_DEVICES, AD_GENDERS, AD_MIN_AGE, AD_MAX_AGE,
  EMPTY_TARGETING, isAdTargetingDimension, targetingDimensionsUsed, isUntargeted,
  requireTargetingSupport, mapTargetingValues, ageWindow, parseTargeting, readTargeting,
  bucketedAgeKeys, ageFromBuckets, invertNativeTable, readNativeValues,
  type AdTargeting, type AdTargetingDimension, type AdPlacement, type AdDevice, type AdGender,
  type AgeBucket, type ParseTargetingResult,
} from './adTargeting';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The adapters are imported at the TOP of this section and the map is a plain const,
 * which only works because the shared helpers moved to `./adsNormalize`. Adapters now
 * import VALUES from there and only TYPES from here, so the cycle is erased at compile
 * time and `ADS_CONNECTOR_KEYS` can be evaluated at module scope.
 */
const PROVIDERS: Readonly<Record<AdNetwork, AdsProvider>> = {
  google: googleAdsProvider,
  meta: metaAdsProvider,
  linkedin: linkedinAdsProvider,
  tiktok: tiktokAdsProvider,
  x: xAdsProvider,
  reddit: redditAdsProvider,
  pinterest: pinterestAdsProvider,
  snapchat: snapchatAdsProvider,
  microsoft: microsoftAdsProvider,
};

export function getAdsProvider(network: string): AdsProvider | null {
  return isAdNetwork(network) ? PROVIDERS[network] : null;
}

export function allAdsProviders(): readonly AdsProvider[] {
  return AD_NETWORKS.map((n) => PROVIDERS[n]);
}

/** Reverse lookup — an ad-account connection knows its connector key, not its network. */
export function adsProviderForConnector(connectorKey: string): AdsProvider | null {
  return allAdsProviders().find((p) => p.connectorKey === connectorKey) ?? null;
}

/** Every connector key that IS an ad account, for one-query connection filters. */
export const ADS_CONNECTOR_KEYS: readonly string[] = AD_NETWORKS.map((n) => PROVIDERS[n].connectorKey);
