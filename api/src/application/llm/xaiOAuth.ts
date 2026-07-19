/** xAI SuperGrok OAuth (OIDC discovery + authorization-code PKCE). */

const DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration';
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_REDIRECT_URI = 'http://127.0.0.1:56121/callback';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access';

export interface XaiOAuthTokens { access: string; refresh: string; expires: number }
interface Discovery { authorization_endpoint: string; token_endpoint: string }

function trustedEndpoint(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`xAI discovery missing ${field}`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || (url.hostname !== 'x.ai' && !url.hostname.endsWith('.x.ai'))) {
    throw new Error(`xAI discovery returned an untrusted ${field}`);
  }
  return url.toString();
}

export async function discoverXaiOAuth(): Promise<Discovery> {
  const response = await fetch(DISCOVERY_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`xAI OAuth discovery failed (${response.status})`);
  const data = await response.json() as Record<string, unknown>;
  return {
    authorization_endpoint: trustedEndpoint(data['authorization_endpoint'], 'authorization_endpoint'),
    token_endpoint: trustedEndpoint(data['token_endpoint'], 'token_endpoint'),
  };
}

export async function buildXaiAuthorizeUrl(params: { state: string; challenge: string }): Promise<string> {
  const discovery = await discoverXaiOAuth();
  const url = new URL(discovery.authorization_endpoint);
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: XAI_REDIRECT_URI, scope: SCOPE, code_challenge: params.challenge, code_challenge_method: 'S256', state: params.state })) url.searchParams.set(key, value);
  return url.toString();
}

export function parseXaiCallback(input: string): { code: string; state: string | null } {
  const value = input.trim();
  try {
    const url = new URL(value);
    return { code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') };
  } catch { /* code#state fallback */ }
  const [code, state] = value.split('#', 2);
  return { code: code ?? '', state: state || null };
}

async function tokenRequest(body: URLSearchParams): Promise<XaiOAuthTokens> {
  const { token_endpoint } = await discoverXaiOAuth();
  const response = await fetch(token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
  if (!response.ok) {
    const err = new Error(`xAI OAuth token request failed (${response.status}): ${(await response.text()).slice(0, 240)}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token || !data.refresh_token) throw new Error('xAI OAuth token response was incomplete');
  return { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 - 120_000 };
}

export function exchangeXaiCode(params: { code: string; verifier: string; challenge: string }): Promise<XaiOAuthTokens> {
  return tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code: params.code, redirect_uri: XAI_REDIRECT_URI, client_id: CLIENT_ID, code_verifier: params.verifier, code_challenge: params.challenge, code_challenge_method: 'S256' }));
}

export function refreshXaiToken(refreshToken: string): Promise<XaiOAuthTokens> {
  return tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }));
}
