/**
 * Kimi Code subscription OAuth — the DEVICE authorization grant.
 *
 * Kimi is the fourth "connect your own subscription" provider, and the first whose
 * public client does not use an authorization code the user pastes back. It runs RFC 8628
 * instead: we ask Kimi for a device code, send the user to a Kimi page that already has
 * the code embedded, and poll until they approve. That is a better fit for a web app than
 * the paste flows — nothing has to be copied, and no redirect URI has to be registered
 * for a client we do not own.
 *
 * Why a subscription connect at all, given Kimi's edge refuses this gateway's egress
 * (`hostEgress.ts`): the credential is what the tenant's OWN connected runtime presents
 * when it makes the call from their machine. Before this, the card asked for an `sk-…`
 * API key — which a Kimi Code subscription does not even issue. Its own `config.toml`
 * leaves `api_key` empty and keeps an OAuth record beside it, so the paste field was
 * asking for a credential that does not exist.
 *
 * Protocol constants and error vocabulary are Kimi's own, matched exactly so a token this
 * module mints is interchangeable with one Kimi Code minted:
 *
 *   POST {host}/api/oauth/device_authorization  { client_id }
 *   POST {host}/api/oauth/token                 { client_id, device_code, grant_type=…:device_code }
 *   POST {host}/api/oauth/token                 { client_id, grant_type=refresh_token, refresh_token }
 */

/**
 * Kimi Code's PUBLIC OAuth client id — the identifier every distributed native client
 * embeds, and not a secret (a public client cannot hold one). It names the application;
 * the user's own device approval is what authorizes the grant.
 */
export const KIMI_OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';

/** Kimi's auth host, honouring the same overrides Kimi Code itself honours so a staging
 *  or self-hosted deployment keeps working. */
export function kimiOAuthHost(env?: { KIMI_CODE_OAUTH_HOST?: string; KIMI_OAUTH_HOST?: string }): string {
  const configured = (env?.KIMI_CODE_OAUTH_HOST ?? env?.KIMI_OAUTH_HOST ?? '').trim();
  return (configured.length > 0 ? configured : 'https://auth.kimi.com').replace(/\/+$/, '');
}

/** Tokens as the rest of the BYO layer stores them. Mirrors `XaiOAuthTokens`. */
export interface KimiOAuthTokens {
  access: string;
  refresh: string;
  /** Absolute expiry in epoch MILLISECONDS (the shape the credential store keeps). */
  expires: number;
}

/** What `start` hands the browser. */
export interface KimiDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  /** The page to send the user to — already carries the code, so nothing is typed. */
  verificationUriComplete: string;
  verificationUri: string;
  /** Seconds Kimi asks us to wait between polls. */
  interval: number;
  expiresIn: number | null;
}

/** Polling outcome. `pending` is the normal answer until the user approves. */
export type KimiDevicePoll =
  | { kind: 'tokens'; tokens: KimiOAuthTokens }
  | { kind: 'pending' }
  /** Kimi asked us to back off; the caller widens its interval. */
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' };

/** Kimi's OAuth endpoints speak form-encoded requests and JSON responses. */
async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  let data: Record<string, unknown> = {};
  try {
    const parsed = await response.json() as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // Status alone decides below; a non-JSON body is not separately interesting.
  }
  return { status: response.status, data };
}

function detailOf(data: Record<string, unknown>): string {
  const description = typeof data.error_description === 'string' ? data.error_description : '';
  const code = typeof data.error === 'string' ? data.error : '';
  return description || code || 'unknown error';
}

/** Absolute-ms expiry from a grant's `expires_in`, or a conservative default. */
function expiresAtMs(data: Record<string, unknown>, nowMs: number): number {
  const seconds = Number(data.expires_in);
  return nowMs + (Number.isFinite(seconds) && seconds > 0 ? seconds : 900) * 1000;
}

/** Begin the device flow: ask Kimi for a code and the page to send the user to. */
export async function startKimiDeviceAuthorization(
  env?: { KIMI_CODE_OAUTH_HOST?: string; KIMI_OAUTH_HOST?: string },
): Promise<KimiDeviceAuthorization> {
  const { status, data } = await postForm(
    `${kimiOAuthHost(env)}/api/oauth/device_authorization`,
    { client_id: KIMI_OAUTH_CLIENT_ID },
  );
  if (status !== 200) throw new Error(`Kimi device authorization failed (HTTP ${status}): ${detailOf(data)}`);
  const deviceCode = data.device_code;
  const userCode = data.user_code;
  const verificationUriComplete = data.verification_uri_complete;
  if (typeof deviceCode !== 'string' || deviceCode.length === 0) throw new Error('Kimi device authorization returned no device_code');
  if (typeof userCode !== 'string' || userCode.length === 0) throw new Error('Kimi device authorization returned no user_code');
  if (typeof verificationUriComplete !== 'string' || verificationUriComplete.length === 0) {
    throw new Error('Kimi device authorization returned no verification_uri_complete');
  }
  return {
    deviceCode,
    userCode,
    verificationUriComplete,
    verificationUri: typeof data.verification_uri === 'string' ? data.verification_uri : '',
    interval: Number(data.interval ?? 5),
    expiresIn: data.expires_in !== undefined ? Number(data.expires_in) : null,
  };
}

/**
 * Poll once for the user's approval.
 *
 * The four RFC 8628 statuses are kept DISTINCT rather than collapsed into "not yet":
 * `pending` means keep waiting, `slow_down` means Kimi wants a wider interval, and
 * `expired` / `denied` are terminal answers the operator must be told about instead of
 * watching a spinner that will never resolve.
 */
export async function pollKimiDeviceToken(
  deviceCode: string,
  opts: { nowMs?: number; env?: { KIMI_CODE_OAUTH_HOST?: string; KIMI_OAUTH_HOST?: string } } = {},
): Promise<KimiDevicePoll> {
  const { status, data } = await postForm(`${kimiOAuthHost(opts.env)}/api/oauth/token`, {
    client_id: KIMI_OAUTH_CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (status === 200 && typeof data.access_token === 'string' && data.access_token.length > 0) {
    return {
      kind: 'tokens',
      tokens: {
        access: data.access_token,
        refresh: typeof data.refresh_token === 'string' ? data.refresh_token : '',
        expires: expiresAtMs(data, opts.nowMs ?? Date.now()),
      },
    };
  }
  switch (typeof data.error === 'string' ? data.error : '') {
    case 'authorization_pending': return { kind: 'pending' };
    case 'slow_down': return { kind: 'slow_down' };
    case 'expired_token': return { kind: 'expired' };
    case 'access_denied': return { kind: 'denied' };
    default:
      throw new Error(`Kimi device token polling failed (HTTP ${status}): ${detailOf(data)}`);
  }
}

/**
 * Exchange a refresh token for a new access token.
 *
 * Kimi ROTATES the refresh token on every grant, so the returned pair must be stored
 * whole — keeping the presented refresh token would leave the tenant holding one the
 * server has already retired. Falls back to the presented token only when the server
 * returns none, which is the non-rotating case.
 */
export async function refreshKimiOAuth(
  refreshToken: string,
  opts: { nowMs?: number; env?: { KIMI_CODE_OAUTH_HOST?: string; KIMI_OAUTH_HOST?: string } } = {},
): Promise<KimiOAuthTokens> {
  const { status, data } = await postForm(`${kimiOAuthHost(opts.env)}/api/oauth/token`, {
    client_id: KIMI_OAUTH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (status === 200 && typeof data.access_token === 'string' && data.access_token.length > 0) {
    return {
      access: data.access_token,
      refresh: typeof data.refresh_token === 'string' && data.refresh_token.length > 0
        ? data.refresh_token
        : refreshToken,
      expires: expiresAtMs(data, opts.nowMs ?? Date.now()),
    };
  }
  const error = new Error(`Kimi token refresh failed (HTTP ${status}): ${detailOf(data)}`) as Error & { status?: number };
  error.status = status === 400 && data.error === 'invalid_grant' ? 401 : status;
  throw error;
}
