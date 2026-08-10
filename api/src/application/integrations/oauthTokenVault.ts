/**
 * Sealed OAuth grants — the shared mechanics behind every per-user connection.
 *
 * A mailbox grant and a Drive grant are different permissions on different
 * tables, but the handling of the TOKENS is identical work: seal the blob with
 * the tenant's key, decide whether it is stale, merge a refresh that may or may
 * not have rotated the refresh token, and tell a terminal failure from a
 * retryable one. That logic lived once inside `mailboxService`; Drive needed the
 * same four answers, so it moved here rather than being copied.
 *
 * What deliberately does NOT live here is the persistence: each connection kind
 * owns its own table and its own natural key, and a generic "update the row"
 * helper would have to take a table plus a column map, which is longer and less
 * readable than the four lines it would save.
 */

import type { Env } from '../../env';
import { credentialSecret, decryptCredentials, encryptCredentials } from './credentialCrypto';

/**
 * Refresh this far before the stamped expiry.
 *
 * A batch of work can spend tens of seconds between "we checked the token" and
 * "the last call goes out", so a token that is merely *not yet expired* is not
 * good enough — the tail of the batch would 401.
 */
export const REFRESH_MARGIN_MS = 120_000;

export interface SealedOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  scope?: string;
}

/** The subset of a token response both providers agree on. */
export interface RefreshedTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function sealOAuthTokens(
  env: Env,
  tenantId: number,
  tokens: SealedOAuthTokens,
): Promise<{ enc: string; iv: string }> {
  return encryptCredentials(tokens as unknown as Record<string, unknown>, credentialSecret(env), tenantId);
}

/** Returns null when the blob cannot be opened or carries no access token — a
 * row we cannot read is treated as a grant that must be reconnected, never as
 * an empty-string token that would 401 on every call. */
export async function unsealOAuthTokens(
  env: Env,
  tenantId: number,
  enc: string,
  iv: string,
): Promise<SealedOAuthTokens | null> {
  const blob = await decryptCredentials(enc, iv, credentialSecret(env), tenantId);
  if (!blob || typeof blob.accessToken !== 'string') return null;
  return {
    accessToken: blob.accessToken,
    refreshToken: typeof blob.refreshToken === 'string' ? blob.refreshToken : undefined,
    expiresAtMs: typeof blob.expiresAtMs === 'number' ? blob.expiresAtMs : undefined,
    scope: typeof blob.scope === 'string' ? blob.scope : undefined,
  };
}

/** Whether the access token should be refreshed before it is used. A grant with
 * no stamped expiry is taken at face value — some providers omit `expires_in`
 * and refreshing on every call would burn the rate limit. */
export function oauthTokensStale(tokens: SealedOAuthTokens, now = Date.now()): boolean {
  return typeof tokens.expiresAtMs === 'number' && tokens.expiresAtMs - REFRESH_MARGIN_MS <= now;
}

/**
 * The blob to store after a refresh.
 *
 * Microsoft ROTATES the refresh token on every refresh; Google omits it and
 * expects the old one to be kept. Preferring the new value and falling back to
 * the old covers both without a per-provider branch — dropping the old one is
 * how a Google grant silently becomes unrefreshable.
 */
export function mergeRefreshedTokens(previous: SealedOAuthTokens, refreshed: RefreshedTokens): SealedOAuthTokens {
  return {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? previous.refreshToken,
    expiresAtMs: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : undefined,
    scope: refreshed.scope ?? previous.scope,
  };
}

/**
 * Whether a refresh failure means the grant is gone for good.
 *
 * `refreshAccessToken` throws `Token refresh failed: <status>`. A 400 or 401 is
 * the provider saying the refresh token is no longer valid — the user must
 * reconnect. Anything else (a 5xx, a network blip) is worth retrying, and
 * marking those revoked would make an outage look like a withdrawn consent.
 */
export function isTerminalRefreshFailure(message: string): boolean {
  return /:\s*(400|401)\b/.test(message);
}
