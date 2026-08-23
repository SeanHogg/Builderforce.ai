/**
 * Connected ad accounts — the read/spend surface every advertising caller uses.
 *
 * The routes, the canvas tile, the insights sweep and the MCP tools all come through
 * here; none of them touch a provider adapter, a connector connection or a token
 * directly. Three things are therefore true in exactly one place:
 *
 *   1. A TOKEN IS NEVER RETURNED. {@link AdAccountView} is what every caller sees. The
 *      sealed blob is opened by the connector runtime; the non-secret scope fields
 *      (ad account id, customer id, advertiser id) are the only credential-adjacent
 *      values that leave this module.
 *   2. AN ACCOUNT THAT CANNOT SPEND SAYS SO BEFORE IT IS ASKED TO. `missingFields`
 *      comes from the provider's `accountFields`, so "Connect Google Ads" cannot look
 *      connected while every launch 400s on a missing customer id.
 *   3. ONE REVOKED GRANT DOES NOT BLANK THE BOARD. A merged read collects per-account
 *      errors alongside the campaigns, exactly as the social feed does.
 *
 * ── CACHING ──────────────────────────────────────────────────────────────────
 * Reading campaigns is N upstream calls and the board re-reads on every tile refresh
 * and every agent turn, so reads go through the shared read-through cache keyed by
 * (tenant, connection, connection version). WRITES INVALIDATE: pausing a campaign and
 * then looking at a stale "active" is the failure that makes someone pause it twice.
 *
 * This is deliberately the same shape as `social/socialService.ts`. Two ports over the
 * same `connector_connections` store should not have two different answers to "which
 * account did you mean", and a reader who knows one knows the other.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  cacheVersionOf, createConnectedAccountsPort, type ResolvedAccount,
} from '../integrations/connectedAccounts';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  ADS_CONNECTOR_KEYS, adsProviderForConnector, allAdsProviders, isAdNetwork, AdsProviderError,
  EMPTY_TARGETING,
  type AdAccountField, type AdAccountIdentity, type AdCampaignDraft, type AdCampaignPatch,
  type AdCampaignRemote, type AdInsightQuery, type AdInsightRow, type AdNetwork,
  type AdObjective, type AdsProvider,
} from './adsProviders';

/** What every caller outside this module sees about a connected ad account. */
export interface AdAccountView {
  /** The connector connection id — the handle every other call takes. */
  id: string;
  network: AdNetwork;
  networkLabel: string;
  name: string;
  enabled: boolean;
  /** False when a required account-scope field is still missing. */
  ready: boolean;
  missingFields: AdAccountField[];
  objectives: readonly AdObjective[];
  lastTestOk: boolean | null;
  lastUsedAt: string | null;
}

/** What a deployment could connect, whether or not it has. Drives the empty state. */
export interface AdNetworkOption {
  network: AdNetwork;
  label: string;
  connectorKey: string;
  accountFields: readonly AdAccountField[];
  objectives: readonly AdObjective[];
  connectedCount: number;
}

export interface AdCampaignRead {
  campaigns: Array<AdCampaignRemote & { connectionId: string; network: AdNetwork; accountName: string }>;
  accounts: AdAccountView[];
  /** Per-account failures. Reported, never swallowed. */
  errors: Array<{ connectionId: string; network: AdNetwork; message: string }>;
  fetchedAtISO: string;
}

const IDENTITY_TTL_SECONDS = 60 * 60;
const CAMPAIGNS_TTL_SECONDS = 5 * 60;
const CAMPAIGNS_L1_TTL_MS = 30 * 1000;

const identityKey = (tenantId: number, connectionId: string, version: string) =>
  `ads:identity:v1:${tenantId}:${connectionId}:${version}`;
const campaignsKey = (tenantId: number, connectionId: string, version: string) =>
  `ads:campaigns:v1:${tenantId}:${connectionId}:${version}`;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** Connection storage, decryption, readiness and resolution — shared with the social
 *  and analytics ports so "does this account have what it needs" has one answer. */
const accounts = createConnectedAccountsPort<AdsProvider>({
  connectorKeys: ADS_CONNECTOR_KEYS,
  providerForConnector: adsProviderForConnector,
  providerId: (provider) => provider.network,
  noun: 'ad account',
});

export type ResolvedAdAccount = ResolvedAccount<AdsProvider>;

/** The base view plus what an ADS caller additionally needs to know. */
function toAccountView(account: ResolvedAdAccount): AdAccountView {
  return {
    ...account.base,
    network: account.provider.network,
    networkLabel: account.provider.label,
    objectives: account.provider.objectives,
  };
}

/** Every connected ad account for the workspace. */
export async function listAdAccounts(db: Db, env: Env, tenantId: number): Promise<AdAccountView[]> {
  return (await accounts.resolveAll(db, env, tenantId)).map(toAccountView);
}

/** The catalog + how many of each is connected. One query, not one per network. */
export async function listAdNetworks(db: Db, env: Env, tenantId: number): Promise<AdNetworkOption[]> {
  const connected = await listAdAccounts(db, env, tenantId);
  return allAdsProviders().map((provider) => ({
    network: provider.network,
    label: provider.label,
    connectorKey: provider.connectorKey,
    accountFields: provider.accountFields,
    objectives: provider.objectives,
    connectedCount: connected.filter((a) => a.network === provider.network).length,
  }));
}

export type ResolveAdAccountResult =
  | { ok: true; account: ResolvedAdAccount }
  | { ok: false; error: string };

/**
 * Pick the account a call means.
 *
 * A person says "run it on LinkedIn"; an agent has no connection id to hand. The
 * shared primitive resolves a lone account on a named network and ASKS otherwise —
 * the stakes here are higher than the social equivalent, because guessing wrong spends
 * the wrong budget, which deleting a post cannot undo.
 */
export async function resolveAdAccount(
  db: Db,
  env: Env,
  tenantId: number,
  ref: { connectionId?: string | null; network?: string | null },
): Promise<ResolveAdAccountResult> {
  return accounts.resolveOne(db, env, tenantId, {
    connectionId: ref.connectionId ?? null,
    providerId: ref.network ?? null,
  });
}

// ---------------------------------------------------------------------------
// Calling a network
// ---------------------------------------------------------------------------

/** Bind one account to the connector runtime — the only way this module talks out. */
export const callerFor = (db: Db, env: Env, tenantId: number, account: ResolvedAdAccount, actorKind: 'agent' | 'user') =>
  accounts.callerFor(db, env, tenantId, account, actorKind);

/** Who this account is and what currency it bills in — cached; every read needs it. */
export async function adIdentity(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount, actorKind: 'agent' | 'user' = 'user',
): Promise<AdAccountIdentity> {
  return getOrSetCached(
    env,
    identityKey(tenantId, account.row.id, cacheVersionOf(account.row)),
    () => account.provider.identity(callerFor(db, env, tenantId, account, actorKind), account.fields),
    { kvTtlSeconds: IDENTITY_TTL_SECONDS },
  );
}

// ---------------------------------------------------------------------------
// Reading campaigns
// ---------------------------------------------------------------------------

/** Read one account's campaigns, cached. Errors are RETURNED so one revoked grant
 *  cannot blank a board showing four other networks. */
async function readAccountCampaigns(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount, actorKind: 'agent' | 'user',
): Promise<{ campaigns: AdCampaignRemote[]; error?: string }> {
  try {
    const identity = await adIdentity(db, env, tenantId, account, actorKind);
    const campaigns = await getOrSetCached(
      env,
      campaignsKey(tenantId, account.row.id, cacheVersionOf(account.row)),
      () => account.provider.listCampaigns(callerFor(db, env, tenantId, account, actorKind), account.fields, identity),
      { kvTtlSeconds: CAMPAIGNS_TTL_SECONDS, l1TtlMs: CAMPAIGNS_L1_TTL_MS },
    );
    return { campaigns };
  } catch (error) {
    const message = error instanceof AdsProviderError
      ? error.message
      : error instanceof Error ? error.message : 'That ad account could not be read.';
    reportCaughtError(error, {
      source: 'application/advertising/adsService.ts',
      operation: `readAccountCampaigns:${account.provider.network}`,
    });
    return { campaigns: [], error: message };
  }
}

export interface AdCampaignQuery {
  connectionIds?: readonly string[];
  networks?: readonly AdNetwork[];
}

/** Build a query from loose input — ONE parser, so the REST route's `?networks=meta,x`
 *  and the MCP tool's `networks: "meta,x"` cannot come to mean different things. */
export function adCampaignQueryFrom(input: {
  networks?: string | null;
  accounts?: string | null;
}): AdCampaignQuery {
  const csv = (value: string | null | undefined) =>
    (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const networks = csv(input.networks).filter(isAdNetwork);
  const connectionIds = csv(input.accounts);
  return {
    ...(connectionIds.length ? { connectionIds } : {}),
    ...(networks.length ? { networks } : {}),
  };
}

/** Every campaign across every account the query selects. */
export async function readAdCampaigns(
  db: Db, env: Env, tenantId: number, query: AdCampaignQuery = {}, actorKind: 'agent' | 'user' = 'user',
): Promise<AdCampaignRead> {
  const all = await accounts.resolveAll(db, env, tenantId, query.connectionIds);
  const selected = all.filter((a) =>
    a.row.enabled
    && a.base.missingFields.length === 0
    && (!query.networks?.length || query.networks.includes(a.provider.network)));

  // Fanned out, not serialized: independent upstream calls, and a board over five
  // networks must not cost five round trips end to end.
  const reads = await Promise.all(selected.map((account) => readAccountCampaigns(db, env, tenantId, account, actorKind)));

  return {
    campaigns: reads.flatMap((read, index) => {
      const account = selected[index];
      if (!account) return [];
      return read.campaigns.map((campaign) => ({
        ...campaign,
        connectionId: account.row.id,
        network: account.provider.network,
        accountName: account.row.name,
      }));
    }),
    accounts: all.map(toAccountView),
    errors: reads.flatMap((read, index) => {
      const account = selected[index];
      return read.error && account
        ? [{ connectionId: account.row.id, network: account.provider.network, message: read.error }]
        : [];
    }),
    fetchedAtISO: new Date().toISOString(),
  };
}

/**
 * Drop this account's cached campaign list.
 *
 * Only a WRITE needs this. A connection change needs nothing, because the cache key
 * carries the connection's version — see {@link cacheVersion}.
 */
export async function invalidateAdCampaigns(env: Env, tenantId: number, account: ResolvedAdAccount): Promise<void> {
  await invalidateCached(env, campaignsKey(tenantId, account.row.id, cacheVersionOf(account.row)));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type AdWriteOutcome<T> =
  | { ok: true; account: AdAccountView; result: T }
  | { ok: false; account: AdAccountView; error: string; retryable: boolean };

/**
 * Authenticate, run, invalidate, classify — the ONE write envelope for every level
 * of this API. Exported because `adSetService` writes at the ad-set and ad levels
 * and must not re-answer "what does a failed ad write look like": a second copy is
 * how one level starts reporting `retryable` differently from the level above it.
 */
export async function write<T>(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  operation: string,
  run: (identity: AdAccountIdentity) => Promise<T>,
): Promise<AdWriteOutcome<T>> {
  try {
    const identity = await adIdentity(db, env, tenantId, account, 'user');
    const result = await run(identity);
    await invalidateAdCampaigns(env, tenantId, account);
    return { ok: true, account: toAccountView(account), result };
  } catch (error) {
    const retryable = error instanceof AdsProviderError ? error.retryable : false;
    const message = error instanceof Error ? error.message : 'That change could not be applied.';
    reportCaughtError(error, {
      source: 'application/advertising/adsService.ts',
      operation: `${operation}:${account.provider.network}`,
    });
    return { ok: false, account: toAccountView(account), error: message, retryable };
  }
}

/**
 * Create one campaign on one account. Returns an outcome rather than throwing, because
 * a multi-network launch must record what happened per network.
 *
 * ── THE DEFAULT AD SET ───────────────────────────────────────────────────────
 * On a network that declares {@link AdsProvider.requiresAdSet}, a campaign alone CANNOT
 * DELIVER: Reddit keeps the daily budget on the ad group and X declares the objective on
 * the line item, so what was created is a funded object that can never spend and never
 * reports a number. One ad set is composed here, immediately, through the same
 * `createAdSet` every other caller uses.
 *
 * It is here rather than inside those two adapters because that is where it used to be —
 * two hand-rolled inline creates, which is how the default ad group came to be built
 * differently from every ad group made afterwards.
 *
 * The campaign is still returned on a failure to compose it, and the reason travels in
 * `adSetError`: the campaign genuinely EXISTS by then, and reporting the whole create as
 * failed would leave a real object on the network that nothing here admits to owning.
 */
export async function createAdCampaign(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  draft: AdCampaignDraft, actorKind: 'agent' | 'user' = 'user',
): Promise<AdWriteOutcome<AdCampaignRemote & { adSetError?: string }>> {
  return write(db, env, tenantId, account, 'createCampaign', async (identity) => {
    const call = callerFor(db, env, tenantId, account, actorKind);
    const campaign = await account.provider.createCampaign(call, account.fields, draft, identity);
    if (!account.provider.requiresAdSet) return campaign;

    try {
      await account.provider.createAdSet(call, account.fields, {
        externalCampaignId: campaign.externalId,
        name: `${draft.name} ad set`,
        // Carried DOWN rather than looked up: on X the line item is where the objective
        // lives, so re-reading the campaign would not answer it.
        objective: draft.objective,
        // An `AdCampaignDraft` carries no targeting — the campaign level has nowhere to
        // put it. Everyone is an honest default here and a real choice on every network;
        // narrowing it is `updateAdSet`'s job, with the audience the caller actually named.
        targeting: EMPTY_TARGETING,
        dailyBudgetCents: draft.dailyBudgetCents ?? null,
        startsAtISO: draft.startsAtISO ?? null,
        endsAtISO: draft.endsAtISO ?? null,
        ...(draft.status ? { status: draft.status } : {}),
      }, identity);
      return campaign;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The default ad set could not be created.';
      reportCaughtError(error, {
        source: 'application/advertising/adsService.ts',
        operation: `createCampaign:defaultAdSet:${account.provider.network}`,
      });
      return { ...campaign, adSetError: reason };
    }
  });
}

/** Change one campaign — rename, re-budget, pause or resume. */
export async function updateAdCampaign(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  externalId: string, patch: AdCampaignPatch, actorKind: 'agent' | 'user' = 'user',
): Promise<AdWriteOutcome<null>> {
  return write(db, env, tenantId, account, 'updateCampaign', async (identity) => {
    await account.provider.updateCampaign(callerFor(db, env, tenantId, account, actorKind), account.fields, externalId, patch, identity);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

/**
 * Read delivery for one account.
 *
 * Deliberately NOT cached: the sweep that calls it writes the rows to `ad_insights`,
 * and every panel reads THOSE. Caching here would put a second, shorter-lived copy of
 * the same numbers in front of the durable one, and the two would disagree about a
 * restated day.
 */
export async function readAdInsights(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount,
  query: AdInsightQuery, actorKind: 'agent' | 'user' = 'user',
): Promise<AdInsightRow[]> {
  const identity = await adIdentity(db, env, tenantId, account, actorKind);
  return account.provider.insights(callerFor(db, env, tenantId, account, actorKind), account.fields, query, identity);
}

/**
 * Read one account's campaigns UNCACHED.
 *
 * For the sync, which is what MAKES the cache stale rather than a consumer of it —
 * serving it a five-minute-old list would mean a campaign created a minute ago is
 * missing its first day of delivery, and the next sweep would have to notice.
 */
export async function readAccountCampaignsLive(
  db: Db, env: Env, tenantId: number, account: ResolvedAdAccount, actorKind: 'agent' | 'user' = 'user',
): Promise<AdCampaignRemote[]> {
  const identity = await adIdentity(db, env, tenantId, account, actorKind);
  return account.provider.listCampaigns(callerFor(db, env, tenantId, account, actorKind), account.fields, identity);
}

/** Resolve many accounts at once for a launch or a sweep, in tenant order. */
export async function resolveSpendableAccounts(
  db: Db, env: Env, tenantId: number, connectionIds?: readonly string[],
): Promise<ResolvedAdAccount[]> {
  return accounts.resolveUsable(db, env, tenantId, connectionIds);
}
