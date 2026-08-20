/**
 * A connected set of BOOKS — persistence, token lifecycle, and nothing else.
 *
 * ── WHY THERE IS NO `ledger_connections` TABLE ──────────────────────────────────
 * Because there is no `payout_connections` table either, and for the reason
 * `PayoutAccountService` wrote down when it declined to add one: a payout
 * destination, a mailbox, a drive and a company's accounting system are all "a
 * connected third party with a sealed credential, a status and a reconnect story",
 * which is the kernel `connections` primitive exactly (PRD 20 §6.2). So a connected
 * book is a `connections` row with `capability = 'ledger'`, its credential sealed
 * into the sibling `credentials` row, and its cursor in `sync_states` — three tables
 * that already existed, none of them new.
 *
 * ── WHAT THIS FILE GUARANTEES ───────────────────────────────────────────────────
 *   1. A CREDENTIAL IS NEVER RETURNED. {@link LedgerConnectionView} is what every
 *      caller outside this module sees and it carries no secret; the sealed blob is
 *      opened only inside {@link openLedgerCredential}.
 *   2. ONE STORAGE PATH FOR ALL FIVE. Four providers arrive as an OAuth grant and
 *      NetSuite arrives as four typed fields, and both go into the same
 *      `oauthTokenVault` blob. A second path for the typed one would mean a fix to
 *      sealing landing on only half the port.
 *   3. A DEAD GRANT SAYS SO. A refresh that fails 400/401 marks the connection
 *      `revoked`, so the surface can offer "reconnect" instead of failing every
 *      sync with an opaque error and a burn figure that quietly stops moving.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connections, credentials, syncStates } from '../../infrastructure/database/schema';
import { refreshAccessToken } from '../../infrastructure/auth/oauthState';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  isTerminalRefreshFailure,
  mergeRefreshedTokens,
  oauthTokensStale,
  sealOAuthTokens,
  unsealOAuthTokens,
} from '../integrations/oauthTokenVault';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  accountingProvider,
  isAccountingProviderName,
  type AccountingCredential,
  type AccountingProviderName,
  type LedgerCapability,
} from './accountingProviders';

/** The kernel capability that makes a `connections` row a set of books. */
export const LEDGER_CAPABILITY = 'ledger';

/** The purpose of the sealed secret. `oauth` for all five including NetSuite: the
 *  kernel's purposes describe the SHAPE of the store, and a token pair sealed in
 *  the same blob as an access token is the same shape. */
const LEDGER_SECRET_PURPOSE = 'oauth';

/** `sync_states.resource` — one cursor per connection, for the transaction feed. */
export const LEDGER_SYNC_RESOURCE = 'ledger.transactions';

/**
 * A set of books belongs to the WORKSPACE, not to the person who happened to click
 * connect — unlike a drive, which is somebody's private file store. `user_id` is
 * therefore the empty string rather than NULL: `uq_connections_account` is a unique
 * index, and NULLs in one never collide, so a NULL here would silently permit two
 * QuickBooks connections to the same company.
 */
const WORKSPACE_OWNED = '';

/** What every caller outside this module sees. Deliberately carries no credential. */
export interface LedgerConnectionView {
  id: number;
  provider: AccountingProviderName;
  label: string;
  /** The book as the vendor named it — a company name, an organisation, a bank. */
  displayName: string;
  /** The vendor's own id for the book: a realm id, a Xero tenant, a Plaid item. */
  externalAccount: string;
  status: string;
  lastError: string | null;
  lastSyncedAtISO: string | null;
  connectedAtISO: string;
  capabilities: LedgerCapability[];
  /** See `AccountingProvider.coversAllSpend` — surfaced so a person can be told
   *  why connecting Stripe alone will not make their burn figure live. */
  coversAllSpend: boolean;
}

type ConnectionRow = typeof connections.$inferSelect;

function view(row: ConnectionRow): LedgerConnectionView {
  const name = row.vendor as AccountingProviderName;
  const provider = isAccountingProviderName(name) ? accountingProvider(name) : null;
  return {
    id: row.id,
    provider: name,
    label: provider?.label ?? row.vendor,
    displayName: row.displayName,
    externalAccount: row.externalAccount,
    status: row.status,
    lastError: row.lastError,
    lastSyncedAtISO: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    connectedAtISO: row.createdAt.toISOString(),
    capabilities: [...(provider?.capabilities ?? [])],
    coversAllSpend: provider?.coversAllSpend ?? false,
  };
}

/* ── lifecycle ───────────────────────────────────────────────────────────────── */

export interface SaveLedgerConnectionInput {
  tenantId: number;
  provider: AccountingProviderName;
  /** The vendor's id for the book. Part of the natural key, so one workspace can
   *  connect two QuickBooks companies without one overwriting the other. */
  externalAccount: string;
  displayName?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  scope?: string;
  /** NetSuite's TBA key pair, and Plaid's client credentials + environment. */
  fields?: Record<string, string>;
}

/**
 * Persist a completed connection, replacing any previous grant on the same book.
 *
 * Reconnecting bumps `cache_version` and clears `last_error`, because a person
 * reconnects precisely BECAUSE something is wrong — serving them the state that was
 * cached while it was broken would be the worst possible moment for a cache hit.
 *
 * The two writes are not in a transaction: the Neon HTTP driver has none. They are
 * ordered so a partial failure leaves a connection with no credential (which
 * presents honestly as "reconnect") rather than a credential with no connection
 * (which would be an orphaned secret nothing can reach or revoke).
 */
export async function saveLedgerConnection(
  db: Db,
  env: Env,
  input: SaveLedgerConnectionInput,
): Promise<LedgerConnectionView> {
  const expiresAtMs = input.expiresInSeconds ? Date.now() + input.expiresInSeconds * 1000 : undefined;
  const sealed = await sealOAuthTokens(env, input.tenantId, {
    // A fields-only credential seals an EMPTY access token rather than none — see
    // the note on `unsealOAuthTokens`, which treats an unreadable blob as "must
    // reconnect" and would otherwise reject NetSuite on every read.
    accessToken: input.accessToken ?? '',
    refreshToken: input.refreshToken,
    expiresAtMs,
    scope: input.scope,
    ...(input.fields ? { fields: input.fields } : {}),
  });

  const [row] = await db
    .insert(connections)
    .values({
      tenantId: input.tenantId,
      userId: WORKSPACE_OWNED,
      vendor: input.provider,
      capability: LEDGER_CAPABILITY,
      externalAccount: input.externalAccount.slice(0, 320),
      displayName: (input.displayName ?? '').slice(0, 255),
      status: 'connected',
      scope: input.scope ?? '',
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [
        connections.tenantId, connections.userId, connections.vendor,
        connections.capability, connections.externalAccount,
      ],
      set: {
        displayName: (input.displayName ?? '').slice(0, 255),
        scope: input.scope ?? '',
        // Reconnecting IS the recovery path for a revoked grant.
        status: 'connected',
        lastError: null,
        cacheVersion: sql`${connections.cacheVersion} + 1`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  await db
    .insert(credentials)
    .values({
      tenantId: input.tenantId,
      connectionId: row!.id,
      purpose: LEDGER_SECRET_PURPOSE,
      secretEnc: sealed.enc,
      secretIv: sealed.iv,
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: [credentials.tenantId, credentials.connectionId, credentials.purpose],
      set: {
        secretEnc: sealed.enc,
        secretIv: sealed.iv,
        expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
        status: 'active',
        rotatedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      },
    });

  return view(row!);
}

/** Every set of books this workspace has connected, in connection order. */
export async function listLedgerConnections(db: Db, tenantId: number): Promise<LedgerConnectionView[]> {
  const rows = await db
    .select()
    .from(connections)
    .where(scopedToTenant(connections, tenantId, eq(connections.capability, LEDGER_CAPABILITY)))
    .orderBy(asc(connections.id));
  return rows.map(view);
}

/**
 * Disconnect. The `credentials` and `sync_states` rows cascade from the FK, and
 * that is the intended behaviour: a credential nothing can reach is a secret nobody
 * can revoke, and a cursor with no connection would resume a feed that no longer
 * has permission to be read.
 *
 * The synced `ledger_entries` rows are deliberately LEFT. They are a record of
 * money that actually moved, and deleting a quarter of a company's history because
 * somebody rotated an integration is not a disconnect — it is data loss with a
 * button on it.
 */
export async function deleteLedgerConnection(db: Db, tenantId: number, connectionId: number): Promise<void> {
  await db.delete(connections).where(scopedToTenant(
    connections,
    tenantId,
    and(eq(connections.id, connectionId), eq(connections.capability, LEDGER_CAPABILITY)),
  ));
}

async function markConnection(
  db: Db,
  tenantId: number,
  connectionId: number,
  set: Partial<{ status: string; lastError: string | null; lastSyncedAt: Date }>,
): Promise<void> {
  await db
    .update(connections)
    .set({ ...set, updatedAt: sql`NOW()` })
    .where(scopedToTenant(connections, tenantId, eq(connections.id, connectionId)));
}

/** Stamp a successful sync. This timestamp is what the finance surface renders as
 *  "last synced" — the one thing that lets a person tell a live figure from one
 *  that was typed, which is the entire point of the port. */
export async function markLedgerSynced(db: Db, tenantId: number, connectionId: number, at: Date): Promise<void> {
  await markConnection(db, tenantId, connectionId, { lastSyncedAt: at, lastError: null, status: 'connected' });
}

/** Record a failure WITHOUT changing status: a 500 from Xero is not a withdrawn
 *  consent, and marking it revoked would make an outage look like one. */
export async function markLedgerError(db: Db, tenantId: number, connectionId: number, message: string): Promise<void> {
  await markConnection(db, tenantId, connectionId, { lastError: message.slice(0, 1_000) });
}

/* ── credential ──────────────────────────────────────────────────────────────── */

export type LedgerCredentialResult =
  | { ok: true; credential: AccountingCredential; provider: AccountingProviderName }
  | { ok: false; status: 'revoked' | 'unavailable' | 'missing'; error: string };

/**
 * A usable credential for one connection, refreshing the access token when it is
 * close to expiry.
 *
 * The refresh is skipped entirely for a grant with no refresh token, and that is
 * not a degraded path — it is the normal one for two of the five. A NetSuite token
 * pair never expires and Plaid's access token is long-lived, so a module that
 * insisted on refreshing would revoke both on their first sync.
 */
export async function openLedgerCredential(
  db: Db,
  env: Env,
  tenantId: number,
  connectionId: number,
): Promise<LedgerCredentialResult> {
  const [row] = await db
    .select({
      id: connections.id,
      vendor: connections.vendor,
      externalAccount: connections.externalAccount,
      secretEnc: credentials.secretEnc,
      secretIv: credentials.secretIv,
    })
    .from(connections)
    .innerJoin(credentials, and(
      eq(credentials.connectionId, connections.id),
      eq(credentials.purpose, LEDGER_SECRET_PURPOSE),
    ))
    .where(scopedToTenant(connections, tenantId, and(
      eq(connections.id, connectionId),
      eq(connections.capability, LEDGER_CAPABILITY),
    )))
    .limit(1);
  if (!row) return { ok: false, status: 'missing', error: 'That book is not connected.' };

  const name = row.vendor;
  if (!isAccountingProviderName(name)) {
    return { ok: false, status: 'unavailable', error: 'That accounting provider is no longer supported.' };
  }
  const provider = accountingProvider(name);

  const tokens = await unsealOAuthTokens(env, tenantId, row.secretEnc, row.secretIv);
  if (!tokens) {
    return { ok: false, status: 'unavailable', error: 'Stored ledger credentials could not be decrypted.' };
  }

  const credential = (accessToken: string | undefined, refreshToken: string | undefined, fields: Record<string, string> | undefined): AccountingCredential => ({
    accessToken: accessToken || undefined,
    refreshToken,
    fields: deploymentFields(env, name, fields),
    externalAccountId: row.externalAccount || undefined,
  });

  if (!tokens.refreshToken || !oauthTokensStale(tokens) || !provider.oauth) {
    return { ok: true, credential: credential(tokens.accessToken, tokens.refreshToken, tokens.fields), provider: name };
  }

  const bag = env as unknown as Record<string, string | undefined>;
  const clientId = bag[provider.oauth.clientIdKey];
  const clientSecret = bag[provider.oauth.clientSecretKey];
  if (!clientId || !clientSecret) {
    return { ok: false, status: 'unavailable', error: `${provider.label} is not configured on this deployment.` };
  }

  try {
    const refreshed = await refreshAccessToken(
      { tokenUrl: provider.oauth.tokenUrl, clientId, clientSecret },
      tokens.refreshToken,
    );
    const next = mergeRefreshedTokens(tokens, refreshed);
    const sealed = await sealOAuthTokens(env, tenantId, next);
    await db
      .update(credentials)
      .set({
        secretEnc: sealed.enc,
        secretIv: sealed.iv,
        expiresAt: next.expiresAtMs ? new Date(next.expiresAtMs) : null,
        status: 'active',
        rotatedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(scopedToTenant(credentials, tenantId, and(
        eq(credentials.connectionId, connectionId),
        eq(credentials.purpose, LEDGER_SECRET_PURPOSE),
      )));
    return {
      ok: true,
      provider: name,
      credential: credential(next.accessToken, next.refreshToken, next.fields),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed';
    if (isTerminalRefreshFailure(message)) {
      await markConnection(db, tenantId, connectionId, { status: 'revoked', lastError: message.slice(0, 1_000) });
      return { ok: false, status: 'revoked', error: 'This connection needs to be reconnected.' };
    }
    reportCaughtError(error, {
      source: 'application/finance/ledgerConnections.ts',
      operation: 'openLedgerCredential',
    });
    await markLedgerError(db, tenantId, connectionId, message);
    return { ok: false, status: 'unavailable', error: 'Could not refresh access to that book.' };
  }
}

/**
 * Deployment-level credentials a provider needs at CALL time, merged in here rather
 * than sealed into the tenant's blob.
 *
 * Plaid is the only one: it authenticates every request with the deployment's
 * `client_id` + `secret` in the body ALONGSIDE the tenant's access token. Sealing
 * those into each tenant's credential would copy one deployment secret into every
 * connected workspace, so rotating it would mean rewriting every row — and a
 * rotation that only half-succeeded would leave some workspaces silently unable to
 * sync. Read from the env at the moment of use, they rotate everywhere at once.
 */
function deploymentFields(
  env: Env,
  provider: AccountingProviderName,
  stored: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (provider !== 'plaid') return stored;
  const bag = env as unknown as Record<string, string | undefined>;
  return {
    ...(stored ?? {}),
    ...(bag.PLAID_CLIENT_ID ? { clientId: bag.PLAID_CLIENT_ID } : {}),
    ...(bag.PLAID_SECRET ? { secret: bag.PLAID_SECRET } : {}),
    ...(bag.PLAID_ENV ? { environment: bag.PLAID_ENV } : {}),
  };
}

/* ── the sync cursor ─────────────────────────────────────────────────────────── */

/**
 * Where the transaction feed got to, and how the last run went.
 *
 * `sync_states` rather than a column on the connection, because the kernel already
 * models exactly this — one row per (connection, resource) with a cursor, a run
 * stamp, an error and two counters — and a stuck importer being one `status` column
 * away from visible is the reason it does.
 */
export async function readLedgerCursor(db: Db, tenantId: number, connectionId: number): Promise<string | null> {
  const [row] = await db
    .select({ cursor: syncStates.cursor })
    .from(syncStates)
    .where(scopedToTenant(syncStates, tenantId, and(
      eq(syncStates.connectionId, connectionId),
      eq(syncStates.resource, LEDGER_SYNC_RESOURCE),
    )))
    .limit(1);
  return row?.cursor ?? null;
}

export async function writeLedgerCursor(
  db: Db,
  tenantId: number,
  connectionId: number,
  state: { cursor: string | null; seen: number; written: number; error?: string | null; at: Date },
): Promise<void> {
  await db
    .insert(syncStates)
    .values({
      tenantId,
      connectionId,
      resource: LEDGER_SYNC_RESOURCE,
      cursor: state.cursor,
      lastRunAt: state.at,
      lastSuccessAt: state.error ? null : state.at,
      lastError: state.error ?? null,
      recordsSeen: state.seen,
      recordsWritten: state.written,
      status: state.error ? 'error' : 'idle',
    })
    .onConflictDoUpdate({
      target: [syncStates.tenantId, syncStates.connectionId, syncStates.resource],
      set: {
        // A failed run must NOT advance the cursor — that is how a page of
        // transactions gets skipped permanently and a month of burn goes missing.
        ...(state.error ? {} : { cursor: state.cursor }),
        lastRunAt: state.at,
        ...(state.error ? {} : { lastSuccessAt: state.at }),
        lastError: state.error ?? null,
        recordsSeen: sql`${syncStates.recordsSeen} + ${state.seen}`,
        recordsWritten: sql`${syncStates.recordsWritten} + ${state.written}`,
        status: state.error ? 'error' : 'idle',
        updatedAt: sql`NOW()`,
      },
    });
}
