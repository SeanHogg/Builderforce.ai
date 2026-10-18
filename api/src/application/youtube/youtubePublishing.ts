import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connectionCredentialConflict, connections, credentials } from '../../infrastructure/database/schema';
import { GOOGLE_OAUTH_ENDPOINTS } from '../shared/providerOAuthConnect';
import {
  providerGrantRefresher,
  refreshGrantIfStale,
  sealOAuthTokens,
  unsealOAuthTokens,
  type SealedOAuthTokens,
} from '../integrations/oauthTokenVault';

export const YOUTUBE_PROVIDER = {
  name: 'google', capability: 'youtube', label: 'YouTube',
  ...GOOGLE_OAUTH_ENDPOINTS,
  scopes: [
    'openid', 'email', 'profile',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
  ],
  clientIdKey: 'GOOGLE_CLIENT_ID', clientSecretKey: 'GOOGLE_CLIENT_SECRET',
  extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
} as const;

export interface YouTubeConnectionView { id: number; accountEmail: string; displayName: string; status: string; lastError: string | null }

export async function listYouTubeConnections(db: Db, tenantId: number, userId: string): Promise<YouTubeConnectionView[]> {
  return db.select({ id: connections.id, accountEmail: connections.externalAccount, displayName: connections.displayName, status: connections.status, lastError: connections.lastError })
    .from(connections).where(and(eq(connections.tenantId, tenantId), eq(connections.userId, userId), eq(connections.vendor, 'google'), eq(connections.capability, 'youtube')));
}

export async function saveYouTubeConnection(db: Db, env: Env, input: { tenantId: number; userId: string; accountEmail: string; displayName: string; tokens: SealedOAuthTokens }): Promise<void> {
  const sealed = await sealOAuthTokens(env, input.tenantId, input.tokens);
  const [connection] = await db.insert(connections).values({
    tenantId: input.tenantId, userId: input.userId, vendor: 'google', capability: 'youtube',
    externalAccount: input.accountEmail.toLowerCase(), displayName: input.displayName,
    scope: input.tokens.scope ?? YOUTUBE_PROVIDER.scopes.join(' '), status: 'connected', lastError: null,
  }).onConflictDoUpdate({
    target: [connections.tenantId, connections.userId, connections.vendor, connections.capability, connections.externalAccount],
    set: { displayName: input.displayName, scope: input.tokens.scope ?? YOUTUBE_PROVIDER.scopes.join(' '), status: 'connected', lastError: null, updatedAt: sql`NOW()` },
  }).returning({ id: connections.id });
  await db.insert(credentials).values({
    tenantId: input.tenantId, connectionId: connection!.id, purpose: 'oauth', secretEnc: sealed.enc, secretIv: sealed.iv,
    expiresAt: input.tokens.expiresAtMs ? new Date(input.tokens.expiresAtMs) : null,
  }).onConflictDoUpdate({
    ...connectionCredentialConflict,
    set: { secretEnc: sealed.enc, secretIv: sealed.iv, expiresAt: input.tokens.expiresAtMs ? new Date(input.tokens.expiresAtMs) : null, status: 'active', updatedAt: sql`NOW()` },
  });
}

export async function deleteYouTubeConnection(db: Db, tenantId: number, userId: string, connectionId: number): Promise<void> {
  await db.delete(connections).where(and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId), eq(connections.userId, userId), eq(connections.capability, 'youtube')));
}

export async function freshYouTubeToken(db: Db, env: Env, tenantId: number, userId: string, connectionId: number): Promise<string> {
  const [row] = await db.select({ connection: connections, credential: credentials }).from(connections)
    .innerJoin(credentials, and(eq(credentials.connectionId, connections.id), eq(credentials.tenantId, tenantId), eq(credentials.purpose, 'oauth')))
    .where(and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId), eq(connections.userId, userId), eq(connections.capability, 'youtube'))).limit(1);
  if (!row) throw new Error('YouTube is not connected.');
  const tokens = await unsealOAuthTokens(env, tenantId, row.credential.secretEnc, row.credential.secretIv);
  if (!tokens) throw new Error('The YouTube connection must be reconnected.');
  // The shared lifecycle decides; this function only writes the credential row.
  const refresh = await refreshGrantIfStale(tokens, providerGrantRefresher(env, YOUTUBE_PROVIDER));
  if (!refresh.ok) {
    if (refresh.reason === 'no_refresh_token') throw new Error('The YouTube connection must be reconnected.');
    if (refresh.reason === 'unconfigured') throw new Error('YouTube OAuth is not configured on this deployment.');
    if (refresh.reason === 'revoked') {
      await db.update(connections).set({ status: 'revoked', lastError: refresh.message, updatedAt: new Date() }).where(and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)));
    }
    throw refresh.error;
  }
  if (!refresh.refreshed) return refresh.tokens.accessToken;
  const next = refresh.tokens;
  const sealed = await sealOAuthTokens(env, tenantId, next);
  await db.update(credentials).set({ secretEnc: sealed.enc, secretIv: sealed.iv, expiresAt: next.expiresAtMs ? new Date(next.expiresAtMs) : null, lastUsedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(credentials.id, row.credential.id), eq(credentials.tenantId, tenantId)));
  return next.accessToken;
}

/** The grant an upload spends: whose `connections` row, and which user owns it. */
export interface YouTubeUploadGrant { connectionId: number; userId: string }

/**
 * Pick the YouTube upload grant for work that has no person attached — a campaign
 * publishing on the sweep.
 *
 * The person who connected the campaign's YouTube account is preferred, because it is
 * their channel the post is meant for. Otherwise the workspace's ONE connected grant
 * is used, and more than one with no preference is a question, not a guess: posting a
 * launch video to the wrong channel is not a recoverable mistake.
 */
export async function resolveYouTubeUploadGrant(
  db: Db, tenantId: number, preferredUserId: string | null,
): Promise<YouTubeUploadGrant | { error: string }> {
  const grants = await db.select({ id: connections.id, userId: connections.userId }).from(connections)
    .where(and(eq(connections.tenantId, tenantId), eq(connections.vendor, 'google'), eq(connections.capability, 'youtube'), eq(connections.status, 'connected')));
  const usable = grants.filter((grant): grant is { id: number; userId: string } => !!grant.userId);
  const preferred = preferredUserId ? usable.find((grant) => grant.userId === preferredUserId) : undefined;
  const chosen = preferred ?? (usable.length === 1 ? usable[0] : undefined);
  if (chosen) return { connectionId: chosen.id, userId: chosen.userId };
  return usable.length === 0
    ? { error: 'Uploading to YouTube needs a YouTube upload connection. Connect YouTube from a video on the canvas, then publish again.' }
    : { error: 'More than one person in this workspace has connected YouTube. The person who connected this YouTube account should connect YouTube uploads too, so the video goes to their channel.' };
}
