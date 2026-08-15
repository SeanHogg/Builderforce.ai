import { apiRequest } from './apiClient';

/**
 * Paid advertising — Google Ads, Meta, LinkedIn, TikTok, X, Reddit, Pinterest, Snapchat.
 *
 * Server counterpart: `api/src/presentation/routes/adsRoutes.ts`.
 *
 * CONNECTING an ad account is deliberately NOT here. An ad account is a connector
 * connection, so it is created and edited through `connectorsApi` like every other one
 * — a second connect flow would mean a second credential store. This client is the
 * READ and SPEND surface that sits on top of those connections.
 *
 * ── MONEY IS CENTS ON THE WIRE ───────────────────────────────────────────────
 * Every amount crossing this boundary is an INTEGER of cents in the ad account's own
 * currency, because that is what the database column holds. The one exception is
 * `createCampaign` / `updateCampaign`, whose `dailyBudget` is the decimal a person
 * typed — the server multiplies it, so the rounding happens once, on the server,
 * rather than differently in every caller.
 *
 * Rides the ONE transport (`apiRequest`) for the reasons documented in `apiClient.ts`.
 */

const ADS = '/api/ads';
const json = { 'Content-Type': 'application/json' };

export type AdNetwork =
  | 'google' | 'meta' | 'linkedin' | 'tiktok' | 'x' | 'reddit' | 'pinterest' | 'snapchat';

/** The canonical order the UI lists networks in. */
export const AD_NETWORKS: readonly AdNetwork[] = [
  'google', 'meta', 'linkedin', 'tiktok', 'x', 'reddit', 'pinterest', 'snapchat',
];

/** What a campaign is trying to buy, in one vocabulary across every network. */
export type AdObjective =
  | 'awareness' | 'traffic' | 'engagement' | 'leads' | 'conversions' | 'app_installs' | 'video_views';

export const AD_OBJECTIVES: readonly AdObjective[] = [
  'awareness', 'traffic', 'engagement', 'leads', 'conversions', 'app_installs', 'video_views',
];

/** Delivery state, normalized. `draft` and `paused` differ in whether the campaign has
 *  ever been eligible to spend. */
export type AdStatus = 'draft' | 'paused' | 'active' | 'ended' | 'archived';

export interface AdAccountField {
  key: string;
  label: string;
  help: string;
}

export interface AdAccount {
  /** The connector connection id — the handle every other call takes. */
  id: string;
  network: AdNetwork;
  networkLabel: string;
  name: string;
  enabled: boolean;
  /** False when a required scope field (ad account id, customer id…) is missing. */
  ready: boolean;
  missingFields: AdAccountField[];
  /** What this network can actually buy — the form must not offer anything else. */
  objectives: AdObjective[];
  lastTestOk: boolean | null;
  lastUsedAt: string | null;
}

export interface AdNetworkOption {
  network: AdNetwork;
  label: string;
  /** The built-in connector this network runs on — what /connectors is filtered by. */
  connectorKey: string;
  accountFields: AdAccountField[];
  objectives: AdObjective[];
  connectedCount: number;
}

export interface AdCampaign {
  externalId: string;
  name: string;
  status: AdStatus;
  /** What the NETWORK calls the objective — kept for campaigns made in its console. */
  nativeObjective: string | null;
  objective: AdObjective | null;
  dailyBudgetCents: number | null;
  totalBudgetCents: number | null;
  currency: string;
  startsAtISO: string | null;
  endsAtISO: string | null;
  connectionId: string;
  network: AdNetwork;
  accountName: string;
}

export interface AdCampaignRead {
  campaigns: AdCampaign[];
  accounts: AdAccount[];
  /** Per-account failures. An account listed here needs reconnecting. */
  errors: Array<{ connectionId: string; network: AdNetwork; message: string }>;
  fetchedAtISO: string;
}

export interface AdInsightRow {
  date: string;
  platform: AdNetwork;
  campaignId: number;
  campaignName: string;
  objective: AdObjective | null;
  status: AdStatus;
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
}

export interface AdInsightsRead {
  window: { since: string; until: string };
  rows: AdInsightRow[];
  totals: {
    spendCents: number;
    impressions: number;
    clicks: number;
    conversions: number;
    /** Null rather than 0 when the denominator is zero — "no clicks yet" and
     *  "costs nothing per click" are different facts. */
    costPerClickCents: number | null;
    costPerConversionCents: number | null;
    clickThroughRate: number | null;
  };
}

export interface AdSyncResult {
  network: AdNetwork;
  connectionId: string;
  campaignsSeen: number;
  daysWritten: number;
  error?: string;
}

export interface AdCampaignFilter {
  networks?: AdNetwork[];
  accounts?: string[];
}

export interface AdInsightsFilter {
  since?: string;
  until?: string;
  networks?: AdNetwork[];
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const adsApi = {
  networks: (): Promise<{ networks: AdNetworkOption[] }> => apiRequest(`${ADS}/networks`),

  accounts: (): Promise<{ accounts: AdAccount[] }> => apiRequest(`${ADS}/accounts`),

  /** What is ACTUALLY running, live from the networks. */
  campaigns: (filter: AdCampaignFilter = {}): Promise<AdCampaignRead> =>
    apiRequest(`${ADS}/campaigns${query({
      networks: filter.networks?.join(','),
      accounts: filter.accounts?.join(','),
    })}`),

  /** Creates PAUSED unless `launch` is true — writing a campaign down is never the
   *  same act as starting to spend. Budgets are decimals in the account currency. */
  createCampaign: (input: {
    name: string;
    objective: AdObjective;
    connectionId?: string;
    network?: AdNetwork;
    dailyBudget?: number;
    totalBudget?: number;
    startsAt?: string;
    endsAt?: string;
    launch?: boolean;
  }): Promise<{ created: true; account: AdAccount; campaign: AdCampaign }> =>
    apiRequest(`${ADS}/campaigns`, { method: 'POST', headers: json, body: JSON.stringify(input) }),

  /** Rename, re-budget, pause or resume. Pausing is the safe direction. */
  updateCampaign: (externalId: string, input: {
    connectionId?: string;
    network?: AdNetwork;
    name?: string;
    status?: AdStatus;
    dailyBudget?: number;
    totalBudget?: number;
  }): Promise<{ updated: true; account: AdAccount }> =>
    apiRequest(`${ADS}/campaigns/${encodeURIComponent(externalId)}`, {
      method: 'PATCH', headers: json, body: JSON.stringify(input),
    }),

  /** Reads the stored ledger, not the networks — fast, and still answers when a
   *  grant has expired. `sync` is what refreshes it. */
  insights: (filter: AdInsightsFilter = {}): Promise<AdInsightsRead> =>
    apiRequest(`${ADS}/insights${query({
      since: filter.since,
      until: filter.until,
      networks: filter.networks?.join(','),
    })}`),

  sync: (): Promise<{ synced: number; results: AdSyncResult[] }> =>
    apiRequest(`${ADS}/sync`, { method: 'POST' }),
};

/** Cents → a display string in the account currency. One implementation, because a
 *  second one is how the same spend comes to read differently on two tiles. */
export function formatMoney(cents: number | null | undefined, currency = 'USD', locale?: string): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
