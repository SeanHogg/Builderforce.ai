import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { connections, credentials } from '../../infrastructure/database/schema';
import { refreshAccessToken } from '../../infrastructure/auth/oauthState';
import {
  isTerminalRefreshFailure,
  mergeRefreshedTokens,
  oauthTokensStale,
  sealOAuthTokens,
  unsealOAuthTokens,
  type SealedOAuthTokens,
} from '../integrations/oauthTokenVault';

export const YOUTUBE_PROVIDER = {
  name: 'google', capability: 'youtube', label: 'YouTube',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/youtube.upload'],
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
    target: [credentials.tenantId, credentials.connectionId, credentials.purpose],
    set: { secretEnc: sealed.enc, secretIv: sealed.iv, expiresAt: input.tokens.expiresAtMs ? new Date(input.tokens.expiresAtMs) : null, status: 'active', updatedAt: sql`NOW()` },
  });
}

export async function deleteYouTubeConnection(db: Db, tenantId: number, userId: string, connectionId: number): Promise<void> {
  await db.delete(connections).where(and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId), eq(connections.userId, userId), eq(connections.capability, 'youtube')));
}

async function freshYouTubeToken(db: Db, env: Env, tenantId: number, userId: string, connectionId: number): Promise<string> {
  const [row] = await db.select({ connection: connections, credential: credentials }).from(connections)
    .innerJoin(credentials, and(eq(credentials.connectionId, connections.id), eq(credentials.tenantId, tenantId), eq(credentials.purpose, 'oauth')))
    .where(and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId), eq(connections.userId, userId), eq(connections.capability, 'youtube'))).limit(1);
  if (!row) throw new Error('YouTube is not connected.');
  const tokens = await unsealOAuthTokens(env, tenantId, row.credential.secretEnc, row.credential.secretIv);
  if (!tokens) throw new Error('The YouTube connection must be reconnected.');
  if (!oauthTokensStale(tokens)) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error('The YouTube connection must be reconnected.');
  try {
    const refreshed = await refreshAccessToken({ tokenUrl: YOUTUBE_PROVIDER.tokenUrl, clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! }, tokens.refreshToken);
    const next = mergeRefreshedTokens(tokens, refreshed);
    const sealed = await sealOAuthTokens(env, tenantId, next);
    await db.update(credentials).set({ secretEnc: sealed.enc, secretIv: sealed.iv, expiresAt: next.expiresAtMs ? new Date(next.expiresAtMs) : null, lastUsedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(credentials.id, row.credential.id), eq(credentials.tenantId, tenantId)));
    return next.accessToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed';
    if (isTerminalRefreshFailure(message)) await db.update(connections).set({ status: 'revoked', lastError: message, updatedAt: new Date() }).where(and(eq(connections.id, connectionId), eq(connections.tenantId, tenantId)));
    throw error;
  }
}

export interface PublishYouTubeInput { connectionId: number; storageKey: string; title: string; description?: string; privacyStatus: 'private' | 'unlisted' | 'public'; mimeType: string }

export async function publishCanvasVideoToYouTube(db: Db, env: Env, tenantId: number, userId: string, input: PublishYouTubeInput): Promise<{ videoId: string; url: string; privacyStatus: string }> {
  if (!input.storageKey.startsWith(`${tenantId}/`)) throw new Error('Video artifact not found.');
  const object = await env.UPLOADS?.get(input.storageKey);
  if (!object) throw new Error('Video artifact not found.');
  const accessToken = await freshYouTubeToken(db, env, tenantId, userId, input.connectionId);
  const metadata = JSON.stringify({ snippet: { title: input.title.slice(0, 100), description: (input.description ?? '').slice(0, 5_000), categoryId: '28' }, status: { privacyStatus: input.privacyStatus, selfDeclaredMadeForKids: false } });
  const initiated = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': String(new TextEncoder().encode(metadata).byteLength), 'X-Upload-Content-Length': String(object.size), 'X-Upload-Content-Type': input.mimeType }, body: metadata,
  });
  const uploadUrl = initiated.headers.get('Location');
  if (!initiated.ok || !uploadUrl) throw new Error(`YouTube upload could not start (${initiated.status}).`);
  const uploaded = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': input.mimeType, 'Content-Length': String(object.size) }, body: object.body });
  const result = await uploaded.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!uploaded.ok || !result.id) throw new Error(result.error?.message || `YouTube upload failed (${uploaded.status}).`);
  await db.update(credentials).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(and(eq(credentials.connectionId, input.connectionId), eq(credentials.tenantId, tenantId)));
  return { videoId: result.id, url: `https://youtu.be/${result.id}`, privacyStatus: input.privacyStatus };
}
