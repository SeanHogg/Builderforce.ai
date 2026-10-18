/** xAI SuperGrok OAuth (OIDC discovery + authorization-code PKCE). */
import {
  OAuthDiscoveryError,
  exchangeSubscriptionCode,
  refreshSubscriptionToken,
  subscriptionAuthorizeUrl,
  type SubscriptionOAuthClient,
} from './subscriptionOAuthCode';
import type { TokenResponse } from '../shared/providerOAuthConnect';

const DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration';
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_REDIRECT_URI = 'http://127.0.0.1:56121/callback';
const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'grok-cli:access', 'api:access'];

export interface XaiOAuthTokens { access: string; refresh: string; expires: number }
interface Discovery { authorization_endpoint: string; token_endpoint: string }

function trustedEndpoint(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new OAuthDiscoveryError(`xAI discovery missing ${field}`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.hostname !== 'x.ai' && !url.hostname.endsWith('.x.ai'))) {
    throw new OAuthDiscoveryError(`xAI discovery returned an untrusted ${field}`);
  }
  return url.toString();
}

export async function discoverXaiOAuth(): Promise<Discovery> {
  const response = await fetch(DISCOVERY_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new OAuthDiscoveryError(`xAI OAuth discovery failed (${response.status})`);
  const data = await response.json() as Record<string, unknown>;
  return {
    authorization_endpoint: trustedEndpoint(data['authorization_endpoint'], 'authorization_endpoint'),
    token_endpoint: trustedEndpoint(data['token_endpoint'], 'token_endpoint'),
  };
}

/**
 * The SuperGrok public client as a descriptor. Its endpoints come from OIDC
 * discovery (and are pinned to *.x.ai by {@link trustedEndpoint}), so the
 * descriptor is completed per call rather than declared with fixed URLs.
 */
async function xaiOAuthClient(): Promise<SubscriptionOAuthClient> {
  const discovery = await discoverXaiOAuth();
  return {
    label: 'xAI',
    clientId: CLIENT_ID,
    authUrl: discovery.authorization_endpoint,
    tokenUrl: discovery.token_endpoint,
    redirectUri: XAI_REDIRECT_URI,
    scopes: SCOPES,
  };
}

export async function buildXaiAuthorizeUrl(params: { state: string; challenge: string }): Promise<string> {
  return subscriptionAuthorizeUrl(await xaiOAuthClient(), params);
}

/** xAI's token parsing — `expires_in` is optional, so an hour is assumed. */
function toTokens(data: TokenResponse): XaiOAuthTokens {
  if (!data.refresh_token) throw new Error('xAI OAuth token response was incomplete');
  return { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 - 120_000 };
}

export async function exchangeXaiCode(params: { code: string; verifier: string; challenge: string }): Promise<XaiOAuthTokens> {
  // xAI's token endpoint also wants the challenge re-sent beside the verifier.
  return toTokens(await exchangeSubscriptionCode(await xaiOAuthClient(), {
    code: params.code,
    verifier: params.verifier,
    extra: { code_challenge: params.challenge, code_challenge_method: 'S256' },
  }));
}

export async function refreshXaiToken(refreshToken: string): Promise<XaiOAuthTokens> {
  return toTokens(await refreshSubscriptionToken(await xaiOAuthClient(), refreshToken));
}
