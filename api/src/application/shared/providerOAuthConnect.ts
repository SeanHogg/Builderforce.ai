/**
 * Connecting a THIRD-PARTY ACCOUNT over OAuth — the one implementation.
 *
 * Every surface that lets a person hand us a grant on something they own goes
 * through this module: mailbox, drive, calendar, payouts, ledger and YouTube
 * (deployment-configured clients), MCP extensions (a dynamically registered
 * client) and the BYO subscription providers (a published public client). The
 * login and enterprise-SSO flows share the authorization URL, the descriptors
 * and the code exchange from here too, while keeping their own session logic.
 *
 * What lives here, so no caller re-implements it:
 *
 *   • the provider DESCRIPTOR ({@link OAuthProviderConfig}) — endpoints, scopes,
 *     env keys, authorize extras, token body encoding. A provider difference is a
 *     field on the descriptor, never a branch in a caller;
 *   • the authorization URL ({@link buildAuthorizationUrl});
 *   • the signed connect `state` ({@link signProviderConnectState} /
 *     {@link verifyProviderConnectState}) and the `returnTo` constraint;
 *   • the code exchange and refresh (re-exported from infrastructure so callers
 *     stay on the right side of `check:layering`).
 *
 * Two things this centralizes that are easy to get subtly wrong per-route:
 *
 *   • `returnTo` is constrained to a path on OUR OWN app. A crafted `returnTo`
 *     round-tripped through the provider would otherwise turn the callback into
 *     an open redirect, and the constraint has to hold on EVERY flow, not the
 *     ones that remembered it.
 *   • Both halves of the OAuth client (id AND secret) are required at CONNECT
 *     time. Checking only the id defers a misconfiguration to the callback,
 *     where the user has already granted consent and gets a dead end.
 *
 * The CSRF story is the signed `state` primitive
 * ({@link ../../infrastructure/auth/oauthState}): the callback is a top-level
 * browser redirect with no bearer token, so the HMAC-signed state naming the
 * connecting user and tenant is what authenticates it.
 *
 * Token STORAGE and the refresh lifecycle (seal, stale check, merge, revoked vs
 * transient) live next door in {@link ../integrations/oauthTokenVault}; each
 * domain keeps only its own table write. The browser-facing connect/callback
 * ROUTES live in `presentation/routes/providerOAuthConnectRoutes`.
 *
 * This is the application layer, so routes can call it without reaching into
 * infrastructure themselves (`npm run check:layering`).
 */

import {
  signState,
  verifyState,
  exchangeCodeForTokens,
  type TokenClient,
  type TokenResponse,
} from '../../infrastructure/auth/oauthState';

// The token calls themselves have exactly one implementation, in infrastructure.
// They are re-exported so application and presentation callers (login, SSO, the
// subscription providers, MCP) reach them through this front door rather than
// each importing `infrastructure/auth` — which a route may not do.
export {
  exchangeCodeForTokens,
  refreshAccessToken,
  TokenEndpointError,
  type TokenClient,
  type TokenResponse,
} from '../../infrastructure/auth/oauthState';

/**
 * Endpoints shared by several descriptors. Google and Microsoft each back four
 * or five surfaces (login, mailbox, drive, calendar, YouTube, calendar sync); the
 * endpoint pair is declared once so a provider-side move lands everywhere at once.
 */
export const GOOGLE_OAUTH_ENDPOINTS = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
} as const;

/** `common` rather than a tenant id: a customer's Microsoft tenant is not ours,
 *  and pinning our own would make every external account unconnectable. */
export const MICROSOFT_OAUTH_ENDPOINTS = {
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
} as const;

/**
 * The provider DESCRIPTOR — the OAuth-app half of a provider adapter. Every
 * provider registry (mailbox, drive, calendar, payouts, ledger, YouTube, login)
 * already declares these fields; this is the subset this module needs, so an
 * adapter satisfies it structurally with no changes.
 */
export interface OAuthProviderConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  /** Env var names holding this deployment's OAuth client credentials. */
  clientIdKey: string;
  clientSecretKey: string;
  /** Provider-specific authorize params (e.g. Google's `access_type=offline`). */
  extraAuthParams?: Record<string, string>;
  /** Token request encoding; omitted means RFC 6749 form encoding. */
  tokenBodyEncoding?: TokenClient['bodyEncoding'];
}

/**
 * The environment as this module reads it. Only `JWT_SECRET` is named; the
 * client id/secret are looked up by the key names the provider declares, which
 * is why the rest is read through an index cast rather than typed here.
 */
export interface OAuthEnv {
  JWT_SECRET: string;
}

/** What the signed `state` carries across the provider round trip. */
export interface ProviderConnectState extends Record<string, unknown> {
  provider: string;
  userId: string;
  tenantId: number;
  returnTo: string;
}

/** A resolved OAuth client for one provider on this deployment. */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Where the connect flow may send the browser back to: a path on our own app.
 * Anything absolute, protocol-relative (`//evil.example`) or empty falls back,
 * so a crafted `returnTo` cannot make the callback an open redirect.
 */
export function safeReturnTo(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim();
  return value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

/**
 * This deployment's OAuth client for a provider, or `null` when either half is
 * missing — which is what "not configured here" means.
 *
 * Takes the env as a bag rather than the typed `Env` because the keys are named
 * by the provider adapter, and because the provider REGISTRIES call it to answer
 * "configured?" without carrying a JWT secret they have no use for.
 */
export function providerOAuthCredentials(
  env: Record<string, unknown>,
  provider: Pick<OAuthProviderConfig, 'clientIdKey' | 'clientSecretKey'>,
): OAuthClientCredentials | null {
  const clientId = env[provider.clientIdKey];
  const clientSecret = env[provider.clientSecretKey];
  return typeof clientId === 'string' && clientId && typeof clientSecret === 'string' && clientSecret
    ? { clientId, clientSecret }
    : null;
}

/**
 * Whether a provider can be connected on this deployment. BOTH halves of the
 * OAuth client are required: advertising a provider whose secret is missing
 * sends the user to a consent screen that cannot complete.
 */
export function isProviderOAuthConfigured(
  env: Record<string, unknown>,
  provider: Pick<OAuthProviderConfig, 'clientIdKey' | 'clientSecretKey'>,
): boolean {
  return providerOAuthCredentials(env, provider) !== null;
}

/**
 * The token-endpoint client for a descriptor on this deployment, or `null` when
 * it is not configured. The one place a descriptor plus env becomes something
 * {@link exchangeCodeForTokens} / `refreshAccessToken` can call — so the refresh
 * paths stop each reading `env[clientIdKey]` by hand.
 */
export function providerTokenClient(
  env: Record<string, unknown>,
  provider: Pick<OAuthProviderConfig, 'tokenUrl' | 'clientIdKey' | 'clientSecretKey' | 'tokenBodyEncoding'>,
): TokenClient | null {
  const credentials = providerOAuthCredentials(env, provider);
  if (!credentials) return null;
  return {
    tokenUrl: provider.tokenUrl,
    ...credentials,
    ...(provider.tokenBodyEncoding ? { bodyEncoding: provider.tokenBodyEncoding } : {}),
  };
}

/** Everything an authorization (consent) URL can carry. */
export interface AuthorizationUrlParams {
  clientId: string;
  redirectUri: string;
  /** Space-joined when an array; omitted from the URL when empty. */
  scopes?: readonly string[] | string;
  /** Omitted when the caller appends its own state later (SSO signs a nonce into it). */
  state?: string;
  /** PKCE S256 challenge (RFC 7636); adds `code_challenge_method=S256`. */
  codeChallenge?: string;
  /** Provider- or protocol-specific params (`access_type`, `resource`, `nonce`, …). */
  extra?: Record<string, string>;
}

/**
 * The ONE authorization URL builder.
 *
 * Parameters are SET on the endpoint URL rather than string-appended with `?`,
 * because a discovered endpoint (an MCP authorization server, xAI's OIDC
 * metadata, an enterprise IdP) may already carry a query string, and
 * `${url}?${query}` would then produce a second `?` the provider rejects.
 */
export function buildAuthorizationUrl(authUrl: string, params: AuthorizationUrlParams): string {
  const url = new URL(authUrl);
  const scope = typeof params.scopes === 'string' ? params.scopes : (params.scopes ?? []).join(' ');
  const set: Record<string, string> = {
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    ...(scope ? { scope } : {}),
    ...(params.state ? { state: params.state } : {}),
    ...(params.codeChallenge ? { code_challenge: params.codeChallenge, code_challenge_method: 'S256' } : {}),
    ...(params.extra ?? {}),
  };
  for (const [key, value] of Object.entries(set)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * Sign the connect `state` for a per-user grant.
 *
 * `extra` carries what one flow needs back that the others do not — the MCP
 * flow's extension id — inside the SAME signed envelope, so there is one state
 * format and one verifier rather than a second `signState` call per flow. The
 * named fields are written last so `extra` can never overwrite them.
 */
export async function signProviderConnectState(
  env: OAuthEnv,
  params: {
    providerName: string;
    userId: string;
    tenantId: number;
    /** Raw `returnTo`; constrained by {@link safeReturnTo} before it is signed. */
    returnTo: string | undefined;
    returnToFallback: string;
    extra?: Record<string, string | number>;
  },
): Promise<string> {
  return signState(env.JWT_SECRET, {
    ...(params.extra ?? {}),
    provider: params.providerName,
    userId: params.userId,
    tenantId: params.tenantId,
    returnTo: safeReturnTo(params.returnTo, params.returnToFallback),
  } satisfies ProviderConnectState);
}

/**
 * Build the provider consent URL for a per-user grant.
 *
 * Returns `null` when the provider is not configured on this deployment, so the
 * caller can answer 503 BEFORE sending anyone to a consent screen that cannot
 * complete. The URL is handed back for the client to navigate to rather than
 * issued as a 302: a top-level navigation cannot carry the bearer token, so the
 * browser has to make the jump itself after an authenticated fetch.
 */
export async function buildProviderConsentUrl(
  env: OAuthEnv,
  provider: OAuthProviderConfig,
  params: {
    /** The provider name as it appears in the callback path. */
    providerName: string;
    redirectUri: string;
    userId: string;
    tenantId: number;
    /** Raw `returnTo` from the query string; constrained by {@link safeReturnTo}. */
    returnTo: string | undefined;
    returnToFallback: string;
  },
): Promise<string | null> {
  const credentials = providerOAuthCredentials(env as unknown as Record<string, unknown>, provider);
  if (!credentials) return null;

  const state = await signProviderConnectState(env, params);
  return buildAuthorizationUrl(provider.authUrl, {
    clientId: credentials.clientId,
    redirectUri: params.redirectUri,
    scopes: provider.scopes,
    state,
    ...(provider.extraAuthParams ? { extra: provider.extraAuthParams } : {}),
  });
}

/**
 * The callback half: verify the returned state and trade the code for tokens.
 *
 * Failures are returned rather than thrown because every caller answers them the
 * same way — a redirect back into the app carrying a reason — and `returnTo` is
 * only known once the state verifies, which is exactly the distinction the
 * result type makes.
 */
export type ProviderCallbackResult =
  | { ok: true; state: ProviderConnectState & { ts: number }; tokens: TokenResponse }
  /** State missing, tampered with, expired, or signed for a different provider. */
  | { ok: false; reason: 'invalid_state'; returnTo: null }
  /** State was good, but this deployment has no client credentials to exchange with. */
  | { ok: false; reason: 'unavailable'; returnTo: string }
  /** The provider refused the code→token exchange. */
  | { ok: false; reason: 'exchange_failed'; returnTo: string; error: unknown };

/**
 * Verify the signed `state` WITHOUT exchanging anything.
 *
 * {@link completeProviderOAuthCallback} does both halves together because for most
 * surfaces they are inseparable. Two flows need the check alone: Plaid (Link
 * redirects with a `public_token`, not a `code`) and MCP (the exchange needs the
 * PKCE verifier sealed on the extension row). The CSRF story must not differ for
 * them, so they call this rather than re-implementing it.
 *
 * `returnTo` is re-constrained by {@link safeReturnTo} on the way out, so a state
 * signed before that rule tightened cannot become an open redirect.
 */
export async function verifyProviderConnectState(
  env: OAuthEnv,
  providerName: string,
  rawState: string,
  returnToFallback: string,
): Promise<(ProviderConnectState & { ts: number }) | null> {
  const state = await verifyState<ProviderConnectState>(env.JWT_SECRET, rawState);
  if (!state || state.provider !== providerName) return null;
  return { ...state, returnTo: safeReturnTo(state.returnTo, returnToFallback) };
}

export async function completeProviderOAuthCallback(
  env: OAuthEnv,
  provider: OAuthProviderConfig,
  params: {
    /** Expected provider name — the state must have been signed for it. */
    providerName: string;
    code: string;
    rawState: string;
    redirectUri: string;
    /** Where to land when the signed `returnTo` no longer passes {@link safeReturnTo}. */
    returnToFallback?: string;
  },
): Promise<ProviderCallbackResult> {
  const state = await verifyProviderConnectState(env, params.providerName, params.rawState, params.returnToFallback ?? '/');
  if (!state) return { ok: false, reason: 'invalid_state', returnTo: null };

  const client = providerTokenClient(env as unknown as Record<string, unknown>, provider);
  if (!client) return { ok: false, reason: 'unavailable', returnTo: state.returnTo };

  try {
    const tokens = await exchangeCodeForTokens(client, params.code, params.redirectUri);
    return { ok: true, state, tokens };
  } catch (error) {
    return { ok: false, reason: 'exchange_failed', returnTo: state.returnTo, error };
  }
}
