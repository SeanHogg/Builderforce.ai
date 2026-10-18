/**
 * The two judgements every "connect your own subscription" OAuth flow makes, in
 * one place.
 *
 * Anthropic (Claude Pro/Max), OpenAI (ChatGPT/Codex) and xAI all use the same
 * shape: a public PKCE client whose redirect we do NOT control, so the user is
 * shown an authorization code on a page we do not own and pastes it back to us.
 * Three modules had each written their own copy of the two steps that follow,
 * and the copies had drifted in the way that costs an operator an afternoon:
 *
 *   • READING THE PASTE. OpenAI and xAI accepted a full redirect URL, a
 *     `code#state` pair or a bare code; Anthropic accepted only `code#state`.
 *     Same box, same instruction, three different tolerances.
 *
 *   • NAMING A DEAD CODE. An authorization code is single-use and short-lived,
 *     so `400 invalid_grant` is by far the most common way a connect fails —
 *     the user consented, went to make coffee, and pasted a code the provider
 *     had already retired. Only the OpenAI path classified it; Anthropic and
 *     xAI answered `502 oauth_exchange_failed` with the upstream JSON body
 *     pasted verbatim into the UI, which tells the operator that BuilderForce
 *     or Anthropic is broken and gives them nothing to do about it. It is
 *     neither: it is a 400 they fix by starting the connect again.
 *
 * Provider-specific ADVICE still belongs to the provider (only the OpenAI flow
 * has a Codex CLI that can eat the code off localhost), so the hint is a
 * parameter — the classification and the wire contract are shared.
 *
 * The provider DESCRIPTORS ({@link SubscriptionOAuthClient}) and the authorize /
 * exchange / refresh calls built on the shared OAuth primitive live here too, so
 * each provider module is its descriptor plus its own token parsing.
 */

import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  TokenEndpointError,
  type TokenClient,
  type TokenResponse,
} from '../shared/providerOAuthConnect';

/** A pasted authorization code, split from whatever wrapper it arrived in. */
export interface PastedAuthorizationCode {
  /** The authorization code, or `''` when the paste carried none. */
  code: string;
  /** The CSRF `state` when the paste carried one — the KV lookup key. */
  state: string | null;
}

/** The pasted value as a URL, or null when it is not one. */
function asRedirectUrl(value: string): URL | null {
  // Screened by prefix first so that "not a URL" — the EXPECTED shape for two of
  // the three accepted pastes — is decided without raising an exception at all.
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null; // Looked like a URL, is not one — read it as a code instead.
  }
}

/**
 * Read the authorization code out of whatever the user pasted.
 *
 * Accepts all three shapes a consent page can leave on a clipboard, because the
 * user cannot be expected to know which one they have:
 *   • a full redirect URL — `https://…/callback?code=…&state=…`
 *   • the `code#state` pair Anthropic's console page renders for copying
 *   • a bare code, when the flow carries `state` out of band
 */
export function parsePastedAuthorizationCode(input: string): PastedAuthorizationCode {
  const value = input.trim();
  const url = asRedirectUrl(value);
  if (url) return { code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') };
  const hash = value.indexOf('#');
  if (hash === -1) return { code: value, state: null };
  return { code: value.slice(0, hash), state: value.slice(hash + 1) || null };
}

/**
 * Wire code for "that authorization code is no longer redeemable".
 *
 * The distinction this carries is the whole point: a spent code is a 400 the
 * operator resolves by consenting again, NOT the 502 that says our gateway or
 * the provider is down. The frontend reads it to drop the user back to the
 * Connect button instead of leaving them retrying a code that can never work.
 */
export const OAUTH_CODE_SPENT = 'oauth_code_spent';
/** Wire code for "the account behind this grant has no subscription to use". */
export const OAUTH_SUBSCRIPTION_NOT_ENTITLED = 'oauth_subscription_not_entitled';
/** Wire code for every other token-endpoint failure — "not your fault, retry later". */
export const OAUTH_EXCHANGE_FAILED = 'oauth_exchange_failed';
/** Wire code for a provider whose authorize/device endpoint could not be reached or trusted. */
export const OAUTH_DISCOVERY_FAILED = 'oauth_discovery_failed';

/**
 * An exchange failure, carrying the status and wire code THIS API answers with.
 *
 * The distinction that matters: a dead authorization code is a 400 the operator
 * fixes by consenting again, an unentitled account is a 403 they fix on the
 * provider's billing page, and only everything else is the 502 that says "not
 * your fault". `upstreamStatus` keeps what the token endpoint actually said for
 * the reporter; it is never the answer, because a provider's 500 is our 502.
 */
export class OAuthExchangeError extends Error {
  readonly status: 400 | 403 | 502;
  readonly code: typeof OAUTH_CODE_SPENT | typeof OAUTH_SUBSCRIPTION_NOT_ENTITLED | typeof OAUTH_EXCHANGE_FAILED;
  constructor(message: string, readonly upstreamStatus: number, spentCode = false) {
    super(message);
    this.name = 'OAuthExchangeError';
    if (spentCode) {
      this.status = 400;
      this.code = OAUTH_CODE_SPENT;
    } else if (upstreamStatus === 403) {
      this.status = 403;
      this.code = OAUTH_SUBSCRIPTION_NOT_ENTITLED;
    } else {
      this.status = 502;
      this.code = OAUTH_EXCHANGE_FAILED;
    }
  }
}

/** A provider's OIDC discovery / device-authorization step failed — an upstream 502. */
export class OAuthDiscoveryError extends Error {
  readonly status = 502;
  readonly code = OAUTH_DISCOVERY_FAILED;
  constructor(message: string) {
    super(message);
    this.name = 'OAuthDiscoveryError';
  }
}

/**
 * True when a token endpoint's rejection means the code itself is dead —
 * already redeemed, expired, or never issued by us.
 *
 * All three providers answer `400` with an OAuth2 `invalid_grant`; Anthropic
 * adds `"Invalid 'code' in request."`, OpenAI a prose "authorization code"
 * sentence. Matching the standard error keeps this from depending on any one
 * provider's phrasing.
 */
export function isSpentAuthorizationCode(status: number, body: string): boolean {
  return status === 400 && /invalid_grant|authorization code/i.test(body);
}

/**
 * The error a provider exchange throws for a dead code. `hint` is the
 * provider's own advice about HOW the code died, appended to the shared
 * explanation — omit it when there is nothing provider-specific to say.
 */
export function spentAuthorizationCodeError(hint?: string): OAuthExchangeError {
  const base = 'That authorization code has already been used or expired — codes are single-use and short-lived. Start the connect again and paste the new code promptly.';
  return new OAuthExchangeError(hint ? `${base} ${hint}` : base, 400, true);
}

/**
 * Throw the right error for a non-ok token response: the shared spent-code error
 * when the body says the code is dead, otherwise a status-carrying failure the
 * route reports as an upstream problem.
 */
export function throwTokenExchangeFailure(params: {
  status: number;
  body: string;
  /** Provider name for the generic message, e.g. `'Anthropic'`. */
  label: string;
  /** Provider-specific advice for the spent-code case. */
  spentHint?: string;
}): never {
  const detail = params.body.slice(0, 240);
  if (isSpentAuthorizationCode(params.status, detail)) throw spentAuthorizationCodeError(params.spentHint);
  throw new OAuthExchangeError(`${params.label} OAuth token request failed (${params.status}): ${detail}`, params.status);
}

/**
 * A subscription provider's PUBLIC OAuth client, as data.
 *
 * The three paste-back providers differ only in values: the published client id,
 * the redirect the provider registered for it (a page we do not own), the scopes,
 * extra authorize params, and — for Anthropic alone — a JSON token body. The URL,
 * the exchange, the refresh and the failure classification are shared, so a
 * fourth provider is one more descriptor, not a fourth fetch.
 */
export interface SubscriptionOAuthClient {
  /** Provider name for error messages, e.g. `'Anthropic'`. */
  label: string;
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: readonly string[];
  extraAuthParams?: Record<string, string>;
  tokenBodyEncoding?: TokenClient['bodyEncoding'];
  /** Provider-specific advice appended when the pasted code turns out to be spent. */
  spentHint?: string;
}

const tokenClientOf = (client: SubscriptionOAuthClient): TokenClient => ({
  tokenUrl: client.tokenUrl,
  clientId: client.clientId,
  ...(client.tokenBodyEncoding ? { bodyEncoding: client.tokenBodyEncoding } : {}),
});

/** The consent URL for a subscription provider (PKCE S256, our random `state`). */
export function subscriptionAuthorizeUrl(
  client: SubscriptionOAuthClient,
  params: { state: string; challenge: string },
): string {
  return buildAuthorizationUrl(client.authUrl, {
    clientId: client.clientId,
    redirectUri: client.redirectUri,
    scopes: client.scopes,
    state: params.state,
    codeChallenge: params.challenge,
    ...(client.extraAuthParams ? { extra: client.extraAuthParams } : {}),
  });
}

/**
 * Trade a pasted code (+ PKCE verifier) for tokens. A refusal is classified once
 * here — spent code (400), unentitled account (403), or upstream failure (502) —
 * instead of by each provider module.
 */
export async function exchangeSubscriptionCode(
  client: SubscriptionOAuthClient,
  params: { code: string; verifier: string; extra?: Record<string, string> },
): Promise<TokenResponse> {
  try {
    return await exchangeCodeForTokens(tokenClientOf(client), params.code, client.redirectUri, {
      code_verifier: params.verifier,
      ...(params.extra ?? {}),
    });
  } catch (error) {
    if (error instanceof TokenEndpointError && error.status >= 400) {
      throwTokenExchangeFailure({ status: error.status, body: error.body, label: client.label, spentHint: client.spentHint });
    }
    throw error;
  }
}

/**
 * Re-mint subscription tokens. Throws the shared {@link TokenEndpointError},
 * whose `status` is the UPSTREAM status — the resolvers read it to tell a revoked
 * refresh token (401/403) from a transient failure, which a 400/403/502 API
 * status would blur.
 */
export function refreshSubscriptionToken(client: SubscriptionOAuthClient, refreshToken: string): Promise<TokenResponse> {
  return refreshAccessToken(tokenClientOf(client), refreshToken);
}
