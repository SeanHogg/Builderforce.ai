/**
 * Connecting a THIRD-PARTY ACCOUNT to a user — the one implementation.
 *
 * Three surfaces let a person hand us a grant on something they own: a mailbox
 * (`/api/mailbox`), a drive (`/api/drive`) and a calendar (`/api/calendar`). The
 * OAuth dance is identical in all three and differs only in the provider
 * registry and the query-param vocabulary the browser is redirected back with —
 * so the dance lives here and the routes keep only their vocabulary.
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
 * The CSRF story stays the signed `state` primitive
 * ({@link ../../infrastructure/auth/oauthState}): the callback is a top-level
 * browser redirect with no bearer token, so the HMAC-signed state naming the
 * connecting user and tenant is what authenticates it.
 *
 * This is the application layer, so routes can call it without reaching into
 * infrastructure themselves (`npm run check:layering`).
 */

import {
  signState,
  verifyState,
  exchangeCodeForTokens,
  type TokenResponse,
} from '../../infrastructure/auth/oauthState';

/**
 * The OAuth-app half of a provider adapter. Every provider registry
 * (mailbox/drive/calendar) already declares these fields; this is the subset
 * this module needs, so an adapter satisfies it structurally with no changes.
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

  const state = await signState(env.JWT_SECRET, {
    provider: params.providerName,
    userId: params.userId,
    tenantId: params.tenantId,
    returnTo: safeReturnTo(params.returnTo, params.returnToFallback),
  } satisfies ProviderConnectState);

  const query = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: provider.scopes.join(' '),
    state,
    ...(provider.extraAuthParams ?? {}),
  });
  return `${provider.authUrl}?${query}`;
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

export async function completeProviderOAuthCallback(
  env: OAuthEnv,
  provider: OAuthProviderConfig,
  params: {
    /** Expected provider name — the state must have been signed for it. */
    providerName: string;
    code: string;
    rawState: string;
    redirectUri: string;
  },
): Promise<ProviderCallbackResult> {
  const state = await verifyState<ProviderConnectState>(env.JWT_SECRET, params.rawState);
  if (!state || state.provider !== params.providerName) {
    return { ok: false, reason: 'invalid_state', returnTo: null };
  }

  const credentials = providerOAuthCredentials(env as unknown as Record<string, unknown>, provider);
  if (!credentials) return { ok: false, reason: 'unavailable', returnTo: state.returnTo };

  try {
    const tokens = await exchangeCodeForTokens(
      { tokenUrl: provider.tokenUrl, ...credentials },
      params.code,
      params.redirectUri,
    );
    return { ok: true, state, tokens };
  } catch (error) {
    return { ok: false, reason: 'exchange_failed', returnTo: state.returnTo, error };
  }
}
