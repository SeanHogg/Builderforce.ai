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

/** The networks this deployment can spend on. */
export const AD_NETWORKS = ['google', 'meta', 'linkedin', 'tiktok', 'x', 'reddit', 'pinterest', 'snapchat'] as const;
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
  identity(call: AdCall, fields: Record<string, string>): Promise<AdAccountIdentity>;
  listCampaigns(call: AdCall, fields: Record<string, string>, identity: AdAccountIdentity): Promise<AdCampaignRemote[]>;
  createCampaign(call: AdCall, fields: Record<string, string>, draft: AdCampaignDraft, identity: AdAccountIdentity): Promise<AdCampaignRemote>;
  updateCampaign(call: AdCall, fields: Record<string, string>, externalId: string, patch: AdCampaignPatch, identity: AdAccountIdentity): Promise<void>;
  insights(call: AdCall, fields: Record<string, string>, query: AdInsightQuery, identity: AdAccountIdentity): Promise<AdInsightRow[]>;
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

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Adapters are imported at the BOTTOM, after the shared helpers they consume.
 *
 * Every adapter imports `ask`, `toCents` and friends from this module, so the registry
 * has to sit below their definitions — a top-of-file import would evaluate the adapter
 * modules while this one's `const` helpers are still in the temporal dead zone.
 */
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
