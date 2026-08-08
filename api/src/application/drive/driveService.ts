/**
 * Connected drives — persistence, token lifecycle, and the browse/fetch surface.
 *
 * The routes and (later) any MCP tool come through here; none of them touch a
 * provider adapter or a token directly. That is what makes the two invariants
 * below enforceable in one place, and they are the same two `mailboxService`
 * holds for mail:
 *
 *   1. A TOKEN IS NEVER RETURNED. `DriveConnectionView` is what every caller
 *      sees and it carries no secret; the sealed blob is opened only inside
 *      {@link freshDriveToken}.
 *   2. A REVOKED GRANT SAYS SO. A refresh that fails 400/401 marks the row
 *      `revoked`, so the UI can offer "reconnect" instead of failing every
 *      listing with an opaque error.
 *
 * The token mechanics themselves live in the shared `oauthTokenVault`, so a fix
 * to sealing, staleness or refresh-token rotation lands on mail and files at
 * once.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { driveConnections } from '../../infrastructure/database/schema';
import { refreshAccessToken } from '../../infrastructure/auth/oauthState';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
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
  DriveProviderError,
  getDriveProvider,
  type DriveDownload,
  type DriveListing,
  type DriveProvider,
  type DriveProviderName,
} from './driveProviders';

/** What every caller outside this module sees. Deliberately carries no token. */
export interface DriveConnectionView {
  id: number;
  provider: DriveProviderName;
  accountEmail: string;
  displayName: string;
  status: 'connected' | 'expired' | 'revoked' | string;
  lastError: string | null;
  createdAt: Date;
}

const VIEW_COLUMNS = {
  id: driveConnections.id,
  provider: driveConnections.provider,
  accountEmail: driveConnections.accountEmail,
  displayName: driveConnections.displayName,
  status: driveConnections.status,
  lastError: driveConnections.lastError,
  createdAt: driveConnections.createdAt,
} as const;

function toView(row: {
  id: number; provider: string; accountEmail: string; displayName: string;
  status: string; lastError: string | null; createdAt: Date;
}): DriveConnectionView {
  return { ...row, provider: row.provider as DriveProviderName };
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

/**
 * Persist a completed OAuth grant, replacing any previous grant on the same
 * drive.
 *
 * Reconnecting bumps `cacheVersion`, which is what evicts every cached folder
 * listing under that drive — a person reconnects precisely BECAUSE something is
 * wrong or stale, so serving them the old tree afterwards would be the worst
 * possible moment to return a cache hit.
 */
export async function saveDriveConnection(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    userId: string;
    provider: DriveProviderName;
    accountEmail: string;
    displayName?: string;
    accessToken: string;
    refreshToken?: string;
    expiresInSeconds?: number;
    scope?: string;
  },
): Promise<DriveConnectionView> {
  const expiresAtMs = input.expiresInSeconds ? Date.now() + input.expiresInSeconds * 1000 : undefined;
  const sealed = await sealOAuthTokens(env, input.tenantId, {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAtMs,
    scope: input.scope,
  });

  const [row] = await db
    .insert(driveConnections)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      provider: input.provider,
      accountEmail: input.accountEmail.toLowerCase(),
      displayName: (input.displayName ?? '').slice(0, 255),
      tokenEnc: sealed.enc,
      tokenIv: sealed.iv,
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
      scope: input.scope ?? '',
      status: 'connected',
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [
        driveConnections.tenantId, driveConnections.userId,
        driveConnections.provider, driveConnections.accountEmail,
      ],
      set: {
        tokenEnc: sealed.enc,
        tokenIv: sealed.iv,
        expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
        scope: input.scope ?? '',
        displayName: (input.displayName ?? '').slice(0, 255),
        // Reconnecting IS the recovery path for a revoked grant.
        status: 'connected',
        lastError: null,
        cacheVersion: sql`${driveConnections.cacheVersion} + 1`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning(VIEW_COLUMNS);
  return toView(row!);
}

/** Every drive this user has connected. Per-USER, unlike mailboxes: a drive is
 *  personal storage, and listing a colleague's private files to the whole tenant
 *  is not a feature. */
export async function listDriveConnections(db: Db, tenantId: number, userId: string): Promise<DriveConnectionView[]> {
  const rows = await db
    .select(VIEW_COLUMNS)
    .from(driveConnections)
    .where(and(eq(driveConnections.tenantId, tenantId), eq(driveConnections.userId, userId)))
    .orderBy(asc(driveConnections.id));
  return rows.map(toView);
}

export async function deleteDriveConnection(
  db: Db,
  tenantId: number,
  userId: string,
  connectionId: number,
): Promise<void> {
  await db.delete(driveConnections).where(and(
    eq(driveConnections.id, connectionId),
    eq(driveConnections.tenantId, tenantId),
    eq(driveConnections.userId, userId),
  ));
}

async function markRevoked(db: Db, tenantId: number, connectionId: number, message: string): Promise<void> {
  await db
    .update(driveConnections)
    .set({ status: 'revoked', lastError: message.slice(0, 1_000), updatedAt: sql`NOW()` })
    .where(scopedToTenant(driveConnections, tenantId, eq(driveConnections.id, connectionId)));
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export type DriveTokenResult =
  | { ok: true; accessToken: string; provider: DriveProvider; cacheVersion: number }
  | { ok: false; status: 'revoked' | 'unavailable' | 'missing'; error: string };

/**
 * A usable access token for a connection, refreshing it if it is close to
 * expiry.
 *
 * The row is loaded scoped to (tenant, user) rather than by id alone — a
 * connection id is a small integer, and the drive it opens is somebody's private
 * file store.
 */
export async function freshDriveToken(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
  connectionId: number,
): Promise<DriveTokenResult> {
  const [row] = await db
    .select()
    .from(driveConnections)
    .where(and(
      eq(driveConnections.id, connectionId),
      eq(driveConnections.tenantId, tenantId),
      eq(driveConnections.userId, userId),
    ))
    .limit(1);
  if (!row) return { ok: false, status: 'missing', error: 'That drive is not connected.' };

  const provider = getDriveProvider(row.provider);
  if (!provider) return { ok: false, status: 'unavailable', error: 'That drive provider is no longer supported.' };

  const rec = env as unknown as Record<string, string | undefined>;
  const clientId = rec[provider.clientIdKey];
  const clientSecret = rec[provider.clientSecretKey];
  if (!clientId || !clientSecret) {
    return { ok: false, status: 'unavailable', error: `${provider.label} is not configured on this deployment.` };
  }

  const tokens = await unsealOAuthTokens(env, tenantId, row.tokenEnc, row.tokenIv);
  if (!tokens) return { ok: false, status: 'unavailable', error: 'Stored drive credentials could not be decrypted.' };

  if (!oauthTokensStale(tokens)) {
    return { ok: true, accessToken: tokens.accessToken, provider, cacheVersion: row.cacheVersion };
  }
  if (!tokens.refreshToken) {
    await markRevoked(db, tenantId, connectionId, 'No refresh token stored — reconnect this drive.');
    return { ok: false, status: 'revoked', error: 'No refresh token stored — reconnect this drive.' };
  }

  try {
    const refreshed = await refreshAccessToken(
      { tokenUrl: provider.tokenUrl, clientId, clientSecret },
      tokens.refreshToken,
    );
    const next = mergeRefreshedTokens(tokens, refreshed);
    const sealed = await sealOAuthTokens(env, tenantId, next);
    await db
      .update(driveConnections)
      .set({
        tokenEnc: sealed.enc,
        tokenIv: sealed.iv,
        expiresAt: next.expiresAtMs ? new Date(next.expiresAtMs) : null,
        status: 'connected',
        lastError: null,
        updatedAt: sql`NOW()`,
      })
      .where(scopedToTenant(driveConnections, tenantId, eq(driveConnections.id, connectionId)));
    return { ok: true, accessToken: next.accessToken, provider, cacheVersion: row.cacheVersion };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed';
    if (isTerminalRefreshFailure(message)) {
      await markRevoked(db, tenantId, connectionId, message);
      return { ok: false, status: 'revoked', error: 'This drive needs to be reconnected.' };
    }
    reportCaughtError(error, { source: 'application/drive/driveService.ts', operation: 'freshDriveToken' });
    await db
      .update(driveConnections)
      .set({ lastError: message.slice(0, 1_000), updatedAt: sql`NOW()` })
      .where(scopedToTenant(driveConnections, tenantId, eq(driveConnections.id, connectionId)));
    return { ok: false, status: 'unavailable', error: 'Could not refresh access to this drive.' };
  }
}

// ---------------------------------------------------------------------------
// Browse + fetch
// ---------------------------------------------------------------------------

/**
 * How long a folder listing is served from cache.
 *
 * Short on purpose. A directory is not slow-changing data — a person who has
 * just saved a file into Drive expects to see it — but a tree view fires one
 * listing per folder the user opens, and without this, walking back up and down
 * a directory would re-hit the provider on every click and burn the API quota.
 * Two minutes absorbs the walking without ever feeling stale.
 */
const LISTING_TTL_SECONDS = 120;

/**
 * One folder's contents, cached per (connection, folder, cursor, version).
 *
 * The keyspace is unbounded — a drive has arbitrarily many folders — so the key
 * carries the connection's `cacheVersion` rather than being individually
 * invalidated. Reconnecting the drive bumps that version and the whole tree
 * falls away at once, which is exactly the moment a stale tree would be worst.
 */
export async function listDriveFolder(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
  connectionId: number,
  folderId: string | null,
  cursor?: string,
): Promise<DriveListing> {
  const token = await freshDriveToken(db, env, tenantId, userId, connectionId);
  if (!token.ok) throw new DriveProviderError(token.error, token.status === 'revoked' ? 401 : 503);
  const key = `drive:list:${tenantId}:${connectionId}:v${token.cacheVersion}:${folderId ?? 'root'}:${cursor ?? ''}`;
  return getOrSetCached(env, key, () => token.provider.list(token.accessToken, folderId, cursor), {
    kvTtlSeconds: LISTING_TTL_SECONDS,
  });
}

/**
 * The bytes of one file.
 *
 * Deliberately NOT cached: a download is a one-shot transfer straight to the
 * browser, it can be tens of megabytes, and KV is neither sized nor priced for
 * it. The listing above is the read-heavy path; this is not.
 */
export async function downloadDriveFile(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
  connectionId: number,
  fileId: string,
): Promise<DriveDownload> {
  const token = await freshDriveToken(db, env, tenantId, userId, connectionId);
  if (!token.ok) throw new DriveProviderError(token.error, token.status === 'revoked' ? 401 : 503);
  return token.provider.download(token.accessToken, fileId);
}
