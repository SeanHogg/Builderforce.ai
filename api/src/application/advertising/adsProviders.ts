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

/** A network said no. `retryable` decides whether a sweep or a launch requeues — the
 *  same distinction {@link ../social/socialProviders} draws, for the same reason. */
export class AdsProviderError extends Error {
  constructor(message: string, readonly status = 502, readonly retryable = false) {
    super(message);
    this.name = 'AdsProviderError';
  }
}

/** 429 and 5xx are worth another attempt; a rejected token or a malformed budget is not. */
export function isRetryableAdStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

// ---------------------------------------------------------------------------
// Shared normalization — the helpers every adapter uses
// ---------------------------------------------------------------------------

export const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const text = (value: unknown): string => (value == null ? '' : String(value));

/** A count. Negative and non-finite both mean "the network did not say", which is 0 —
 *  a negative impression count has no meaning and would poison every rollup above it. */
export const count = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Money → integer cents, from whatever unit the network used.
 *
 * `scale` is how many of the network's units make one MAJOR currency unit: 1_000_000
 * for micros, 100 for a currency minor unit, 1 for a major unit. Rounding is applied
 * once, at the end, so a chain of conversions cannot drift — and the result is always
 * an integer, because the column is an integer and a float that reaches it truncates
 * silently in the wrong direction.
 */
export function toCents(value: unknown, scale: number): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / scale) * 100);
}

/** Cents → the network's own unit, for a budget going the other way. */
export function fromCents(cents: number | null | undefined, scale: number): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return Math.round((cents / 100) * scale);
}

/** Provider timestamps arrive as ISO strings, epoch seconds, or epoch milliseconds. */
export function toISO(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    // Epoch SECONDS and epoch MILLISECONDS are both common and differ by 1000x, so
    // guessing wrong dates a campaign to 1970 or to the year 55000. The threshold is
    // "would this be a sane date read as seconds" — anything larger is milliseconds.
    const ms = value > 100_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** A YYYY-MM-DD day, from whatever the network put in its date column. */
export function toDay(value: unknown): string {
  const iso = toISO(value);
  if (iso) return iso.slice(0, 10);
  // Several networks report the day already formatted; keep it rather than lose it.
  const raw = text(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

/** Unwrap a call, turning a non-ok result into a typed, retry-classified error. */
export async function ask(
  call: AdCall,
  actionKey: string,
  input: Record<string, unknown> = {},
  opts?: { captureHeaders?: readonly string[] },
): Promise<AdCallResult> {
  const result = await call(actionKey, input, opts);
  if (!result.ok) {
    throw new AdsProviderError(
      result.error?.slice(0, 400) || `The network returned ${result.status}`,
      result.status || 502,
      isRetryableAdStatus(result.status),
    );
  }
  return result;
}

/** A missing account-scope field is a CONFIGURATION error, fixed by editing the
 *  connection — so it must never be retried, and must never reach a spend call. */
export function requireField(fields: Record<string, string>, key: string, label: string): string {
  const value = (fields[key] ?? '').trim();
  if (!value) throw new AdsProviderError(`This connection is missing ${label}. Add it to the connection and try again.`, 409, false);
  return value;
}

/** Refuse an objective this network cannot serve, by name, before anything is spent. */
export function mapObjective<T extends string>(
  provider: { label: string; objectives: readonly AdObjective[] },
  table: Partial<Record<AdObjective, T>>,
  objective: AdObjective,
): T {
  const native = table[objective];
  if (!native) {
    throw new AdsProviderError(
      `${provider.label} cannot run a “${objective}” campaign. It supports: ${provider.objectives.join(', ')}.`,
      400,
      false,
    );
  }
  return native;
}

/** Read a native objective back into our vocabulary, for a campaign made elsewhere. */
export function unmapObjective<T extends string>(
  table: Partial<Record<AdObjective, T>>,
  native: string | null,
): AdObjective | null {
  if (!native) return null;
  const upper = native.toUpperCase();
  for (const [objective, value] of Object.entries(table)) {
    if (String(value).toUpperCase() === upper) return objective as AdObjective;
  }
  return null;
}

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

/** Sum many days of one campaign into one row — used by every rollup above this port. */
export function totalInsights(rows: readonly AdInsightRow[]): Omit<AdInsightRow, 'date' | 'externalCampaignId'> {
  return rows.reduce(
    (acc, row) => ({
      spendCents: acc.spendCents + row.spendCents,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      conversions: acc.conversions + row.conversions,
      currency: row.currency || acc.currency,
    }),
    { spendCents: 0, impressions: 0, clicks: 0, conversions: 0, currency: 'USD' },
  );
}

// ---------------------------------------------------------------------------
// Adapter wiring
// ---------------------------------------------------------------------------

import { googleAdsProvider } from './networks/google';
import { metaAdsProvider } from './networks/meta';
import { linkedinAdsProvider } from './networks/linkedin';
import { tiktokAdsProvider } from './networks/tiktok';
import { xAdsProvider } from './networks/x';
import { redditAdsProvider } from './networks/reddit';
import { pinterestAdsProvider } from './networks/pinterest';
import { snapchatAdsProvider } from './networks/snapchat';

const PROVIDERS: Readonly<Record<AdNetwork, AdsProvider>> = {
  google: googleAdsProvider,
  meta: metaAdsProvider,
  linkedin: linkedinAdsProvider,
  tiktok: tiktokAdsProvider,
  x: xAdsProvider,
  reddit: redditAdsProvider,
  pinterest: pinterestAdsProvider,
  snapchat: snapchatAdsProvider,
};
