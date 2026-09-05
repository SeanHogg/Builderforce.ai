/**
 * The Kimi Code OAuth protocol — one definition, two surfaces.
 *
 * Kimi is reached from two places that share nothing else: the API Worker runs the DEVICE
 * grant so a tenant can connect their subscription from the web, and the VS Code extension
 * runs the REFRESH grant against the credential the user's local Kimi Code install already
 * wrote. Both were spelled out independently, from the same reading of the shipped client,
 * so they agreed on the day they were written and nothing kept them agreeing: rotate the
 * client id and one surface would keep working while the other failed with an OAuth error
 * naming nothing useful.
 *
 * ONE reason to change: Kimi's OAuth protocol.
 *
 * The contract is deliberately I/O-FREE. This module BUILDS requests and READS responses;
 * it never performs one. That is what lets it be shared at all — the Worker's `fetch` and
 * the extension's injected `fetch` have different lifetimes, different failure vocabularies
 * and different retry policies, and none of that belongs here. What DOES belong here is
 * everything that has to be byte-identical on both sides:
 *
 *   POST {host}/api/oauth/device_authorization  { client_id }
 *   POST {host}/api/oauth/token                 { client_id, device_code, grant_type=…:device_code }
 *   POST {host}/api/oauth/token                 { client_id, grant_type=refresh_token, refresh_token }
 *
 * Storage shape stays with each consumer: the API keeps absolute epoch MILLISECONDS beside
 * its other BYO subscription tokens, and the extension writes Kimi's own on-disk record in
 * epoch SECONDS. Neither is this package's business, so the parser returns the wire's own
 * `expires_in` and lets each side convert.
 */

/**
 * Kimi Code's PUBLIC OAuth client id — the identifier every distributed native client
 * embeds, and not a secret (a public client cannot hold one). It names the application;
 * what authorizes a grant is the user's own device approval or their own refresh token,
 * neither of which this constant substitutes for.
 */
export const KIMI_OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';

export const KIMI_OAUTH_DEFAULT_HOST = 'https://auth.kimi.com';

export const KIMI_DEVICE_AUTHORIZATION_PATH = '/api/oauth/device_authorization';
export const KIMI_TOKEN_PATH = '/api/oauth/token';

/** RFC 8628's grant type, spelled exactly. */
export const KIMI_DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * The access-token lifetime Kimi issues, used when a response omits `expires_in`.
 *
 * Fifteen minutes. It is short enough that both surfaces must refresh rather than read,
 * which is the whole reason the refresh grant is shared rather than duplicated.
 */
export const KIMI_DEFAULT_EXPIRES_IN_SECONDS = 900;

/** Statuses worth another attempt, matching Kimi Code's own retry set. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/**
 * Host overrides, honouring the same variables Kimi Code itself honours so a staging or
 * self-hosted deployment keeps working on both surfaces.
 */
export interface KimiOAuthEnv {
  KIMI_CODE_OAUTH_HOST?: string | undefined;
  KIMI_OAUTH_HOST?: string | undefined;
}

export function kimiOAuthHost(env?: KimiOAuthEnv): string {
  const configured = (env?.KIMI_CODE_OAUTH_HOST ?? env?.KIMI_OAUTH_HOST ?? '').trim();
  return (configured.length > 0 ? configured : KIMI_OAUTH_DEFAULT_HOST).replace(/\/+$/, '');
}

/** A request ready to hand to any `fetch`. Headers are lowercase because that is what the
 *  Fetch standard normalizes them to anyway — spelling them two ways invited the diff. */
export interface KimiOAuthRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

function formRequest(url: string, params: Record<string, string>): KimiOAuthRequest {
  return {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  };
}

/** Ask Kimi for a device code and the page to send the user to. */
export function kimiDeviceAuthorizationRequest(env?: KimiOAuthEnv): KimiOAuthRequest {
  return formRequest(`${kimiOAuthHost(env)}${KIMI_DEVICE_AUTHORIZATION_PATH}`, {
    client_id: KIMI_OAUTH_CLIENT_ID,
  });
}

/** Poll once for the user's approval of a device code. */
export function kimiDeviceTokenRequest(deviceCode: string, env?: KimiOAuthEnv): KimiOAuthRequest {
  return formRequest(`${kimiOAuthHost(env)}${KIMI_TOKEN_PATH}`, {
    client_id: KIMI_OAUTH_CLIENT_ID,
    device_code: deviceCode,
    grant_type: KIMI_DEVICE_CODE_GRANT_TYPE,
  });
}

/**
 * Exchange a refresh token for a new access token.
 *
 * Device headers are deliberately omitted: they are optional in Kimi Code's own client
 * (`this.deviceHeaders?.()`), and sending a fabricated device identity would be a claim
 * about the machine that neither surface has any business making.
 */
export function kimiRefreshTokenRequest(refreshToken: string, env?: KimiOAuthEnv): KimiOAuthRequest {
  return formRequest(`${kimiOAuthHost(env)}${KIMI_TOKEN_PATH}`, {
    client_id: KIMI_OAUTH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

/** Tokens exactly as the wire carried them. Absolute expiry is the caller's conversion. */
export interface KimiGrantTokens {
  accessToken: string;
  /** The ROTATED token when the server returned one, else the token that was presented. */
  refreshToken: string;
  /** The wire's own `expires_in`, in SECONDS, or null when it carried none. */
  expiresInSeconds: number | null;
  scope: string;
  tokenType: string;
}

/**
 * Every answer either grant can give.
 *
 * The four RFC 8628 waiting/terminal statuses are kept DISTINCT rather than collapsed into
 * "not yet": `pending` means keep waiting, `slow_down` means Kimi wants a wider interval,
 * and `expired` / `denied` are terminal answers an operator must be told about instead of
 * watching a spinner that will never resolve.
 *
 * `unauthorized` is separate from `failed` because only it is terminal FOR THE CREDENTIAL:
 * it means the refresh token is spent or revoked, and no amount of retrying recovers it.
 */
export type KimiGrantOutcome =
  | { kind: 'tokens'; tokens: KimiGrantTokens }
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'unauthorized'; detail: string }
  | { kind: 'failed'; status: number; detail: string; retryable: boolean };

/** A JSON object body. `{}` when the response carried none. */
export type KimiResponseBody = Record<string, unknown>;

/** How much of a non-JSON body is worth quoting back. Enough to recognise an HTML block
 *  page or a proxy banner; short enough not to paste a document into an error message. */
const NON_JSON_BODY_EXCERPT = 200;

/**
 * A response body, and — when it was not a JSON object — the body itself.
 *
 * The second field is the whole point. Kimi's edge answers a request it refuses with an
 * HTML page rather than an API envelope, and that is the single most diagnostic thing
 * about such a response: it says the refusal happened in front of the API, before any
 * credential was read. Discarding the parse failure turns that into "unknown error".
 */
export interface KimiParsedBody {
  data: KimiResponseBody;
  nonJsonBody: string | null;
}

/** Read a raw response body. The ONE place either surface parses one. */
export function parseKimiResponseBody(raw: string): KimiParsedBody {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { data: {}, nonJsonBody: null };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as KimiResponseBody, nonJsonBody: null };
    }
    // Valid JSON, but a scalar or array — no error fields to read, so treat it as opaque.
    return { data: {}, nonJsonBody: trimmed.slice(0, NON_JSON_BODY_EXCERPT) };
  } catch (error) {
    return {
      data: {},
      nonJsonBody: `${trimmed.slice(0, NON_JSON_BODY_EXCERPT)} (${(error as Error).message})`,
    };
  }
}

function detailOf(body: KimiParsedBody): string {
  const description = typeof body.data.error_description === 'string' ? body.data.error_description : '';
  const code = typeof body.data.error === 'string' ? body.data.error : '';
  return description || code || body.nonJsonBody || '';
}

function stringField(data: KimiResponseBody, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Decide what a token-endpoint response means.
 *
 * `presentedRefreshToken` is the token the caller sent, and is what a non-rotating server's
 * response falls back to. Kimi DOES rotate, so the returned token is normally new — and
 * storing it is the caller's obligation, because the presented one is retired the moment
 * this returns.
 */
export function parseKimiTokenResponse(
  status: number,
  body: KimiParsedBody,
  presentedRefreshToken = '',
): KimiGrantOutcome {
  const { data } = body;
  const accessToken = stringField(data, 'access_token');
  if (status === 200 && accessToken.length > 0) {
    const expiresIn = Number(data.expires_in);
    const rotated = stringField(data, 'refresh_token');
    return {
      kind: 'tokens',
      tokens: {
        accessToken,
        refreshToken: rotated.length > 0 ? rotated : presentedRefreshToken,
        expiresInSeconds: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null,
        scope: stringField(data, 'scope'),
        tokenType: stringField(data, 'token_type') || 'Bearer',
      },
    };
  }

  const error = stringField(data, 'error');
  switch (error) {
    case 'authorization_pending': return { kind: 'pending' };
    case 'slow_down': return { kind: 'slow_down' };
    case 'expired_token': return { kind: 'expired' };
    case 'access_denied': return { kind: 'denied' };
    default: break;
  }

  const detail = detailOf(body);
  if (status === 401 || status === 403 || error === 'invalid_grant') {
    return { kind: 'unauthorized', detail: detail || `Refresh rejected (HTTP ${status}).` };
  }
  return {
    kind: 'failed',
    status,
    detail: detail || `Kimi returned HTTP ${status}.`,
    retryable: RETRYABLE_STATUSES.has(status),
  };
}

/** The device authorization Kimi hands back, once it is known to be complete. */
export interface KimiDeviceAuthorizationFields {
  deviceCode: string;
  userCode: string;
  /** The page to send the user to — already carries the code, so nothing is typed. */
  verificationUriComplete: string;
  verificationUri: string;
  /** Seconds Kimi asks us to wait between polls. */
  interval: number;
  expiresIn: number | null;
}

export type KimiDeviceAuthorizationOutcome =
  | { kind: 'authorization'; authorization: KimiDeviceAuthorizationFields }
  | { kind: 'failed'; status: number; detail: string; retryable: boolean };

/**
 * Read a device-authorization response, refusing an incomplete one.
 *
 * A response missing `verification_uri_complete` is rejected rather than patched around:
 * that field is what makes this a redirect-and-approve flow with nothing for the user to
 * copy, and falling back to the bare URI would silently downgrade it to a code they have
 * to type from a screen we never showed them.
 */
export function parseKimiDeviceAuthorization(
  status: number,
  body: KimiParsedBody,
): KimiDeviceAuthorizationOutcome {
  const { data } = body;
  if (status !== 200) {
    return {
      kind: 'failed',
      status,
      detail: detailOf(body) || `Kimi returned HTTP ${status}.`,
      retryable: RETRYABLE_STATUSES.has(status),
    };
  }
  for (const field of ['device_code', 'user_code', 'verification_uri_complete'] as const) {
    if (stringField(data, field).length === 0) {
      return { kind: 'failed', status, detail: `Kimi device authorization returned no ${field}`, retryable: false };
    }
  }
  const interval = Number(data.interval);
  const expiresIn = Number(data.expires_in);
  return {
    kind: 'authorization',
    authorization: {
      deviceCode: stringField(data, 'device_code'),
      userCode: stringField(data, 'user_code'),
      verificationUriComplete: stringField(data, 'verification_uri_complete'),
      verificationUri: stringField(data, 'verification_uri'),
      interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null,
    },
  };
}

/** ONE lifetime policy for both surfaces, so a response that omits `expires_in` cannot
 *  mean "assume fifteen minutes" in the Worker and "refuse to continue" in the extension. */
export function kimiExpiresInSeconds(expiresInSeconds: number | null): number {
  return expiresInSeconds ?? KIMI_DEFAULT_EXPIRES_IN_SECONDS;
}
