/**
 * Kimi Code subscription OAuth — the DEVICE authorization grant, for the web connect flow.
 *
 * Kimi is the fourth "connect your own subscription" provider, and the first whose public
 * client does not use an authorization code the user pastes back. It runs RFC 8628
 * instead: we ask Kimi for a device code, send the user to a Kimi page that already has
 * the code embedded, and poll until they approve. That is a better fit for a web app than
 * the paste flows — nothing has to be copied, and no redirect URI has to be registered for
 * a client we do not own.
 *
 * Why a subscription connect at all, given Kimi's edge refuses this gateway's egress
 * (`hostEgress.ts`): the credential is what the tenant's OWN connected runtime presents
 * when it makes the call from their machine. Before this, the card asked for an `sk-…` API
 * key — which a Kimi Code subscription does not even issue. Its own `config.toml` leaves
 * `api_key` empty and keeps an OAuth record beside it, so the paste field was asking for a
 * credential that does not exist.
 *
 * The PROTOCOL itself — client id, host, endpoints, grant types, the error vocabulary —
 * lives in `@builderforce/kimi-oauth`, shared with the VS Code extension, which runs the
 * refresh grant against the user's local Kimi Code install. What stays here is this
 * surface's own policy: absolute-millisecond expiries to match the other BYO subscription
 * tokens, and throwing rather than returning for the outcomes a route should turn into an
 * HTTP status.
 */

import {
  kimiDeviceAuthorizationRequest,
  kimiDeviceTokenRequest,
  kimiExpiresInSeconds,
  kimiRefreshTokenRequest,
  parseKimiDeviceAuthorization,
  parseKimiTokenResponse,
  type KimiDeviceAuthorizationFields,
  type KimiGrantTokens,
  type KimiOAuthEnv,
  type KimiOAuthRequest,
  type KimiResponseBody,
} from '@builderforce/kimi-oauth';


/** Tokens as the rest of the BYO layer stores them. Mirrors `XaiOAuthTokens`. */
export interface KimiOAuthTokens {
  access: string;
  refresh: string;
  /** Absolute expiry in epoch MILLISECONDS (the shape the credential store keeps). */
  expires: number;
}

/** What `start` hands the browser. */
export type KimiDeviceAuthorization = KimiDeviceAuthorizationFields;

/** Polling outcome. `pending` is the normal answer until the user approves. */
export type KimiDevicePoll =
  | { kind: 'tokens'; tokens: KimiOAuthTokens }
  | { kind: 'pending' }
  /** Kimi asked us to back off; the caller widens its interval. */
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' };

/** Perform a request the shared protocol module shaped, and hand back the parsed body. */
async function send(request: KimiOAuthRequest): Promise<{ status: number; data: KimiResponseBody }> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  let data: KimiResponseBody = {};
  try {
    const parsed = await response.json() as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as KimiResponseBody;
  } catch {
    // Status alone decides below; a non-JSON body is not separately interesting.
  }
  return { status: response.status, data };
}

/** Absolute-ms expiry from the wire's `expires_in`, under the shared lifetime policy. */
function toStoredTokens(tokens: KimiGrantTokens, nowMs: number): KimiOAuthTokens {
  return {
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    expires: nowMs + kimiExpiresInSeconds(tokens.expiresInSeconds) * 1000,
  };
}

/** Begin the device flow: ask Kimi for a code and the page to send the user to. */
export async function startKimiDeviceAuthorization(env?: KimiOAuthEnv): Promise<KimiDeviceAuthorization> {
  const { status, data } = await send(kimiDeviceAuthorizationRequest(env));
  const outcome = parseKimiDeviceAuthorization(status, data);
  if (outcome.kind === 'failed') {
    throw new Error(`Kimi device authorization failed (HTTP ${status}): ${outcome.detail}`);
  }
  return outcome.authorization;
}

/**
 * Poll once for the user's approval.
 *
 * The waiting and terminal statuses stay DISTINCT (see the shared parser): `pending` means
 * keep waiting, `slow_down` means Kimi wants a wider interval, and `expired` / `denied` are
 * terminal answers the operator must be told about instead of watching a spinner that will
 * never resolve.
 */
export async function pollKimiDeviceToken(
  deviceCode: string,
  opts: { nowMs?: number; env?: KimiOAuthEnv } = {},
): Promise<KimiDevicePoll> {
  const { status, data } = await send(kimiDeviceTokenRequest(deviceCode, opts.env));
  const outcome = parseKimiTokenResponse(status, data);
  switch (outcome.kind) {
    case 'tokens':
      return { kind: 'tokens', tokens: toStoredTokens(outcome.tokens, opts.nowMs ?? Date.now()) };
    case 'pending':
    case 'slow_down':
    case 'expired':
    case 'denied':
      return outcome;
    case 'unauthorized':
      // A device code Kimi has retired. Terminal like `expired`, and reported as such so
      // the operator restarts the connect instead of polling a code that can never approve.
      return { kind: 'expired' };
    default:
      throw new Error(`Kimi device token polling failed (HTTP ${status}): ${outcome.detail}`);
  }
}

/**
 * Exchange a refresh token for a new access token.
 *
 * Kimi ROTATES the refresh token on every grant, so the returned pair must be stored whole
 * — keeping the presented refresh token would leave the tenant holding one the server has
 * already retired. The shared parser falls back to the presented token only when the server
 * returns none, which is the non-rotating case.
 */
export async function refreshKimiOAuth(
  refreshToken: string,
  opts: { nowMs?: number; env?: KimiOAuthEnv } = {},
): Promise<KimiOAuthTokens> {
  const { status, data } = await send(kimiRefreshTokenRequest(refreshToken, opts.env));
  const outcome = parseKimiTokenResponse(status, data, refreshToken);
  if (outcome.kind === 'tokens') return toStoredTokens(outcome.tokens, opts.nowMs ?? Date.now());

  const detail = outcome.kind === 'unauthorized' || outcome.kind === 'failed'
    ? outcome.detail
    : outcome.kind;
  const error = new Error(`Kimi token refresh failed (HTTP ${status}): ${detail}`) as Error & { status?: number };
  // The credential resolver reads `status` to decide `revoked` versus a transient blip: a
  // spent or revoked refresh token must disconnect, not retry forever.
  error.status = outcome.kind === 'unauthorized' ? 401 : status;
  throw error;
}
