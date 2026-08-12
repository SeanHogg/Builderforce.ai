/**
 * Connected social accounts — the read/publish surface every social caller uses.
 *
 * The routes, the canvas feed tile, the campaign publisher and the MCP tools all come
 * through here; none of them touch a provider adapter, a connector connection or a
 * token directly. Three things are therefore true in exactly one place:
 *
 *   1. A TOKEN IS NEVER RETURNED. {@link SocialAccountView} is what every caller sees.
 *      The sealed blob is opened by the connector runtime and the non-secret scope
 *      fields (Page id, author URN, IG account id) are the only credential-adjacent
 *      values that leave this module.
 *   2. AN ACCOUNT THAT CANNOT POST SAYS SO BEFORE IT IS ASKED TO. `missingFields` is
 *      computed from the provider's `accountFields`, so "Connect Instagram" cannot
 *      look connected while every publish 400s on a missing account id.
 *   3. ONE SLOW OR REVOKED ACCOUNT DOES NOT BLANK THE FEED. A merged read fans out
 *      across accounts and collects per-account errors alongside the posts — the
 *      alternative is a board that goes empty because one grant expired.
 *
 * ── CACHING ──────────────────────────────────────────────────────────────────
 * A feed read is N upstream HTTP calls, and the canvas re-reads it on every tile
 * refresh, every campaign screen and every agent turn. Reads go through the shared
 * read-through cache (L1 + KV) keyed by (tenant, connection, filter); publishing
 * invalidates that account's entries so a post the user just made is not missing from
 * the feed they look at next. Identity (`get_me`) is cached separately and for longer:
 * it is a stable fact that every feed read and every publish would otherwise re-fetch.
 */

import { and, inArray } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connectorConnections } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { credentialSecret, decryptCredentials } from '../integrations/credentialCrypto';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  allSocialProviders,
  clampFeedLimit,
  isSocialNetwork,
  MAX_FEED_LIMIT,
  socialProviderForConnector,
  SOCIAL_CONNECTOR_KEYS,
  SocialProviderError,
  type SocialAccountField,
  type SocialFeedItem,
  type SocialIdentity,
  type SocialNetwork,
  type SocialPostDraft,
  type SocialProvider,
  type SocialPublishResult,
} from './socialProviders';

/** What every caller outside this module sees about a connected account. */
export interface SocialAccountView {
  /** The connector connection id — the handle every other call takes. */
  id: string;
  network: SocialNetwork;
  networkLabel: string;
  /** The connection's own name, as the person titled it. */
  name: string;
  enabled: boolean;
  /** False when a required account-scope field is still missing. */
  ready: boolean;
  missingFields: SocialAccountField[];
  /** True when this network refuses text-only posts. */
  requiresMedia: boolean;
  lastTestOk: boolean | null;
  lastUsedAt: string | null;
}

/** What a deployment could connect, whether or not it has. Drives the empty state. */
export interface SocialNetworkOption {
  network: SocialNetwork;
  label: string;
  connectorKey: string;
  accountFields: readonly SocialAccountField[];
  requiresMedia: boolean;
  connectedCount: number;
}

export interface SocialFeedRead {
  items: SocialFeedItem[];
  accounts: SocialAccountView[];
  /** Per-account failures. Reported, never swallowed — a feed missing an account
   *  silently is indistinguishable from an account with nothing to say. */
  errors: Array<{ connectionId: string; network: SocialNetwork; message: string }>;
  fetchedAtISO: string;
}

const IDENTITY_TTL_SECONDS = 60 * 60;
const FEED_TTL_SECONDS = 5 * 60;
const FEED_L1_TTL_MS = 30 * 1000;

/**
 * The connection's own `updated_at`, as a cache version.
 *
 * Editing a connection — a corrected Page id, a re-pasted token, a renamed account —
 * changes the version, so every cached read for it is unreachable from the next
 * request onward. Without this, fixing a wrong account id would leave the OLD
 * identity cached for an hour and the old feed for five minutes, and the fix would
 * look like it had not worked.
 */
const cacheVersion = (row: { updatedAt: Date }) => String(row.updatedAt.getTime());

const identityKey = (tenantId: number, connectionId: string, version: string) =>
  `social:identity:v1:${tenantId}:${connectionId}:${version}`;
/**
 * ONE cache entry per account version, not one per requested page size.
 *
 * A provider read is a single upstream call whatever the limit, so the cached page is
 * always the maximum and callers slice it. Keying by `limit` instead would mean a tile
 * asking for 10 and a campaign asking for 25 never share a hit, and publishing would
 * have to delete fifty keys to be sure the new post shows up.
 */
const feedKey = (tenantId: number, connectionId: string, version: string) =>
  `social:feed:v1:${tenantId}:${connectionId}:${version}`;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

interface ConnectionRow {
  id: string;
  connectorKey: string;
  name: string;
  enabled: boolean;
  lastTestOk: boolean | null;
  lastUsedAt: Date | null;
  /** The cache version — see {@link cacheVersion}. */
  updatedAt: Date;
  credentialsEnc: string;
  iv: string;
}

async function loadSocialRows(db: Db, tenantId: number, connectionIds?: readonly string[]): Promise<ConnectionRow[]> {
  return db
    .select({
      id: connectorConnections.id,
      connectorKey: connectorConnections.connectorKey,
      name: connectorConnections.name,
      enabled: connectorConnections.enabled,
      lastTestOk: connectorConnections.lastTestOk,
      lastUsedAt: connectorConnections.lastUsedAt,
      updatedAt: connectorConnections.updatedAt,
      credentialsEnc: connectorConnections.credentialsEnc,
      iv: connectorConnections.iv,
    })
    .from(connectorConnections)
    .where(scopedToTenant(
      connectorConnections,
      tenantId,
      connectionIds?.length
        ? and(inArray(connectorConnections.connectorKey, [...SOCIAL_CONNECTOR_KEYS]), inArray(connectorConnections.id, [...connectionIds]))
        : inArray(connectorConnections.connectorKey, [...SOCIAL_CONNECTOR_KEYS]),
    ))
    .orderBy(connectorConnections.createdAt);
}

/** Non-secret scope fields for one connection (Page id, author URN, IG account id). */
async function scopeFields(env: Env, tenantId: number, row: ConnectionRow, provider: SocialProvider): Promise<Record<string, string>> {
  if (provider.accountFields.length === 0) return {};
  const blob = await decryptCredentials(row.credentialsEnc, row.iv, credentialSecret(env), tenantId);
  const out: Record<string, string> = {};
  for (const field of provider.accountFields) {
    const value = blob?.[field.key];
    if (value != null && value !== '') out[field.key] = String(value);
  }
  return out;
}

function toAccountView(row: ConnectionRow, provider: SocialProvider, fields: Record<string, string>): SocialAccountView {
  const missing = provider.accountFields.filter((f) => !fields[f.key]);
  return {
    id: row.id,
    network: provider.network,
    networkLabel: provider.label,
    name: row.name,
    enabled: row.enabled,
    ready: row.enabled && missing.length === 0,
    missingFields: missing,
    requiresMedia: provider.requiresMedia,
    lastTestOk: row.lastTestOk,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

interface ResolvedAccount {
  row: ConnectionRow;
  provider: SocialProvider;
  fields: Record<string, string>;
  view: SocialAccountView;
}

async function resolveAccounts(db: Db, env: Env, tenantId: number, connectionIds?: readonly string[]): Promise<ResolvedAccount[]> {
  const rows = await loadSocialRows(db, tenantId, connectionIds);
  const resolved: ResolvedAccount[] = [];
  for (const row of rows) {
    const provider = socialProviderForConnector(row.connectorKey);
    if (!provider) continue; // a social connector key with no adapter is not an account
    const fields = await scopeFields(env, tenantId, row, provider);
    resolved.push({ row, provider, fields, view: toAccountView(row, provider, fields) });
  }
  return resolved;
}

/** Every connected social account for the workspace. */
export async function listSocialAccounts(db: Db, env: Env, tenantId: number): Promise<SocialAccountView[]> {
  return (await resolveAccounts(db, env, tenantId)).map((a) => a.view);
}

/** The catalog + how many of each is connected. One query, not one per network. */
export async function listSocialNetworks(db: Db, env: Env, tenantId: number): Promise<SocialNetworkOption[]> {
  const accounts = await listSocialAccounts(db, env, tenantId);
  return allSocialProviders().map((provider) => ({
    network: provider.network,
    label: provider.label,
    connectorKey: provider.connectorKey,
    accountFields: provider.accountFields,
    requiresMedia: provider.requiresMedia,
    connectedCount: accounts.filter((a) => a.network === provider.network).length,
  }));
}

export type ResolveAccountResult =
  | { ok: true; account: ResolvedAccount }
  | { ok: false; error: string };

/**
 * Pick the account a call means.
 *
 * A person says "post it to LinkedIn"; an agent has no connection id to hand. So a
 * NETWORK resolves on its own when the workspace has exactly one account on it, and
 * anything ambiguous asks rather than guessing which page gets published to.
 */
export async function resolveSocialAccount(
  db: Db,
  env: Env,
  tenantId: number,
  ref: { connectionId?: string | null; network?: string | null },
): Promise<ResolveAccountResult> {
  const accounts = await resolveAccounts(db, env, tenantId, ref.connectionId ? [ref.connectionId] : undefined);
  const usable = accounts.filter((a) => a.row.enabled);

  if (ref.connectionId) {
    const found = usable.find((a) => a.row.id === ref.connectionId);
    if (!found) return { ok: false, error: 'That social account is not connected to this workspace, or has been disabled.' };
    return checkReady(found);
  }

  const scoped = ref.network ? usable.filter((a) => a.provider.network === ref.network) : usable;
  if (scoped.length === 0) {
    return {
      ok: false,
      error: ref.network
        ? `No ${ref.network} account is connected to this workspace yet.`
        : 'No social accounts are connected to this workspace yet.',
    };
  }
  if (scoped.length > 1) {
    const names = scoped.map((a) => `${a.provider.label} · ${a.row.name}`).join(', ');
    return { ok: false, error: `Say which account to use: ${names}.` };
  }
  return checkReady(scoped[0]!);
}

/** A connection missing its scope field is not usable for anything — reading a Page
 *  and posting to it need the same id — so this is checked once, not per operation. */
function checkReady(account: ResolvedAccount): ResolveAccountResult {
  const missing = account.view.missingFields;
  if (missing.length > 0) {
    return {
      ok: false,
      error: `The ${account.provider.label} connection “${account.row.name}” is missing ${missing.map((f) => f.label).join(', ')}. Add it to the connection first.`,
    };
  }
  return { ok: true, account };
}

// ---------------------------------------------------------------------------
// Calling a network
// ---------------------------------------------------------------------------

/** Bind one account to the connector runtime — the only way this module talks out. */
function callerFor(db: Db, env: Env, tenantId: number, account: ResolvedAccount, actorKind: 'agent' | 'user') {
  return async (actionKey: string, input: Record<string, unknown> = {}, opts?: { captureHeaders?: readonly string[] }) => {
    const result = await executeConnectorAction({
      db, env, tenantId,
      connectorKey: account.provider.connectorKey,
      actionKey,
      input,
      connectionId: account.row.id,
      actorKind,
      ...(opts?.captureHeaders ? { captureHeaders: opts.captureHeaders } : {}),
    });
    return {
      ok: result.ok,
      status: result.status,
      data: result.data,
      ...(result.error ? { error: result.error } : {}),
      ...(result.headers ? { headers: result.headers } : {}),
    };
  };
}

/** Who this account is, cached — every feed read and publish needs it and it is stable. */
export async function socialIdentity(
  db: Db, env: Env, tenantId: number, account: ResolvedAccount, actorKind: 'agent' | 'user' = 'user',
): Promise<SocialIdentity> {
  return getOrSetCached(
    env,
    identityKey(tenantId, account.row.id, cacheVersion(account.row)),
    () => account.provider.identity(callerFor(db, env, tenantId, account, actorKind), account.fields),
    { kvTtlSeconds: IDENTITY_TTL_SECONDS },
  );
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export interface SocialFeedQuery {
  /** Restrict to these connections. Empty means every connected account. */
  connectionIds?: readonly string[];
  networks?: readonly SocialNetwork[];
  /** Free-text filter, applied AFTER the read: no network offers the same
   *  server-side search, so filtering here is what makes one query mean one thing. */
  search?: string;
  limit?: number;
}

/**
 * Build a feed query from loose input — ONE parser, so the REST route's
 * `?networks=x,linkedin` and the MCP tool's `networks: "x,linkedin"` cannot come to
 * mean different things. An unknown network name is dropped rather than returning an
 * empty feed nobody asked for.
 */
export function socialFeedQueryFrom(input: {
  networks?: string | null;
  accounts?: string | null;
  q?: string | null;
  limit?: number | string | null;
}): SocialFeedQuery {
  const csv = (value: string | null | undefined) =>
    (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const networks = csv(input.networks).filter(isSocialNetwork);
  const connectionIds = csv(input.accounts);
  const limit = Number(input.limit);
  const search = (input.q ?? '').trim();
  return {
    ...(connectionIds.length ? { connectionIds } : {}),
    ...(networks.length ? { networks } : {}),
    ...(search ? { search } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
  };
}

/**
 * Read one account's recent posts, cached.
 *
 * Errors are RETURNED, not thrown: a merged feed must survive one revoked grant.
 */
async function readAccountFeed(
  db: Db, env: Env, tenantId: number, account: ResolvedAccount, limit: number, actorKind: 'agent' | 'user',
): Promise<{ items: SocialFeedItem[]; error?: string }> {
  try {
    const identity = await socialIdentity(db, env, tenantId, account, actorKind);
    const raw = await getOrSetCached(
      env,
      feedKey(tenantId, account.row.id, cacheVersion(account.row)),
      () => account.provider.listPosts(
        callerFor(db, env, tenantId, account, actorKind), account.fields,
        { limit: MAX_FEED_LIMIT, identity },
      ),
      { kvTtlSeconds: FEED_TTL_SECONDS, l1TtlMs: FEED_L1_TTL_MS },
    );
    return {
      items: raw.slice(0, limit).map((post) => ({
        ...post,
        network: account.provider.network,
        connectionId: account.row.id,
        accountName: account.row.name,
      })),
    };
  } catch (error) {
    const message = error instanceof SocialProviderError
      ? error.message
      : error instanceof Error ? error.message : 'That account could not be read.';
    reportCaughtError(error, {
      source: 'application/social/socialService.ts',
      operation: `readAccountFeed:${account.provider.network}`,
    });
    return { items: [], error: message };
  }
}

/** The merged, newest-first feed across every account the query selects. */
export async function readSocialFeed(
  db: Db, env: Env, tenantId: number, query: SocialFeedQuery = {}, actorKind: 'agent' | 'user' = 'user',
): Promise<SocialFeedRead> {
  const limit = clampFeedLimit(query.limit);
  const all = await resolveAccounts(db, env, tenantId, query.connectionIds);
  const selected = all.filter((a) =>
    a.row.enabled
    && a.view.missingFields.length === 0
    && (!query.networks?.length || query.networks.includes(a.provider.network)));

  // Fanned out, not serialized: these are independent upstream calls and a merged
  // feed over five accounts must not cost five round trips end to end.
  const reads = await Promise.all(selected.map((account) => readAccountFeed(db, env, tenantId, account, limit, actorKind)));

  const search = query.search?.trim().toLowerCase();
  const items = reads
    .flatMap((r) => r.items)
    .filter((item) => !search || item.text.toLowerCase().includes(search) || item.authorName.toLowerCase().includes(search))
    .sort((a, b) => (b.publishedAtISO ?? '').localeCompare(a.publishedAtISO ?? ''))
    .slice(0, limit);

  return {
    items,
    accounts: all.map((a) => a.view),
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
 * Drop this account's cached feed.
 *
 * Only PUBLISHING needs this: a post the user just made must not be missing from the
 * feed they look at next. A CONNECTION change needs nothing, because the cache key
 * carries the connection's version — see {@link cacheVersion}.
 */
export async function invalidateSocialFeed(env: Env, tenantId: number, account: ResolvedAccount): Promise<void> {
  await invalidateCached(env, feedKey(tenantId, account.row.id, cacheVersion(account.row)));
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export type PublishOutcome =
  | { ok: true; account: SocialAccountView; result: SocialPublishResult }
  | { ok: false; account: SocialAccountView; error: string; retryable: boolean };

/**
 * Publish ONE post to ONE account.
 *
 * Returns an outcome rather than throwing, because the only caller that publishes to
 * a single account is a person clicking a button and the other one is a campaign
 * publishing to many — and a campaign must record what happened per account rather
 * than abort at the first refusal.
 */
export async function publishSocialPost(
  db: Db, env: Env, tenantId: number,
  account: ResolvedAccount,
  draft: SocialPostDraft,
  actorKind: 'agent' | 'user' = 'user',
): Promise<PublishOutcome> {
  try {
    const identity = await socialIdentity(db, env, tenantId, account, actorKind);
    const result = await account.provider.publish(
      callerFor(db, env, tenantId, account, actorKind), account.fields, draft, identity,
    );
    await invalidateSocialFeed(env, tenantId, account);
    return { ok: true, account: account.view, result };
  } catch (error) {
    const retryable = error instanceof SocialProviderError ? error.retryable : false;
    const message = error instanceof Error ? error.message : 'That post could not be published.';
    reportCaughtError(error, {
      source: 'application/social/socialService.ts',
      operation: `publish:${account.provider.network}`,
    });
    return { ok: false, account: account.view, error: message, retryable };
  }
}

/** Resolve many accounts at once for a campaign run, in tenant order. */
export async function resolvePublishableAccounts(
  db: Db, env: Env, tenantId: number, connectionIds: readonly string[],
): Promise<ResolvedAccount[]> {
  const accounts = await resolveAccounts(db, env, tenantId, connectionIds);
  return accounts.filter((a) => a.row.enabled && a.view.missingFields.length === 0);
}

export type { ResolvedAccount };
