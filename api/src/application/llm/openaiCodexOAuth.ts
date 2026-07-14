/** OpenAI Codex / ChatGPT subscription OAuth for tenant-owned credentials. */

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const OPENAI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const JWT_AUTH_CLAIM = 'https://api.openai.com/auth';

export interface OpenAICodexOAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch { return null; }
}

function accountIdFromToken(token: string): string {
  const auth = decodeJwt(token)?.[JWT_AUTH_CLAIM] as { chatgpt_account_id?: unknown } | undefined;
  if (typeof auth?.chatgpt_account_id !== 'string' || !auth.chatgpt_account_id) {
    throw new Error('OpenAI OAuth token did not contain a ChatGPT account id');
  }
  return auth.chatgpt_account_id;
}

export function buildOpenAICodexAuthorizeUrl(params: { state: string; challenge: string }): string {
  const url = new URL(AUTHORIZE_URL);
  for (const [key, value] of Object.entries({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: OPENAI_CODEX_REDIRECT_URI,
    scope: 'openid profile email offline_access', code_challenge: params.challenge,
    code_challenge_method: 'S256', state: params.state, id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true', originator: 'builderforce',
  })) url.searchParams.set(key, value);
  return url.toString();
}

export function parseOpenAICodexCallback(input: string): { code: string; state: string | null } {
  const value = input.trim();
  try {
    const url = new URL(value);
    return { code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') };
  } catch { /* code or code#state */ }
  const [code, state] = value.split('#', 2);
  return { code: code ?? '', state: state || null };
}

async function requestTokens(body: URLSearchParams): Promise<OpenAICodexOAuthTokens> {
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) {
    const err = new Error(`OpenAI OAuth token request failed (${response.status}): ${(await response.text()).slice(0, 240)}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token || !data.refresh_token || typeof data.expires_in !== 'number') throw new Error('OpenAI OAuth token response was incomplete');
  return { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + data.expires_in * 1000 - 300_000, accountId: accountIdFromToken(data.access_token) };
}

export function exchangeOpenAICodexCode(params: { code: string; verifier: string }): Promise<OpenAICodexOAuthTokens> {
  return requestTokens(new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code: params.code, code_verifier: params.verifier, redirect_uri: OPENAI_CODEX_REDIRECT_URI }));
}

export function refreshOpenAICodexToken(refreshToken: string): Promise<OpenAICodexOAuthTokens> {
  return requestTokens(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }));
}
