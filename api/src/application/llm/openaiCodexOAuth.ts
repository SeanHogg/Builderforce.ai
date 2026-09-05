/** OpenAI Codex / ChatGPT subscription OAuth for tenant-owned credentials. */
import { throwTokenExchangeFailure } from './subscriptionOAuthCode';

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

/**
 * The extra way an OpenAI code dies, which no other provider shares.
 *
 * {@link OPENAI_CODEX_REDIRECT_URI} is `http://localhost:1455/auth/callback`
 * because that is what OpenAI has registered for this client id — we cannot point
 * it at our own domain. The user is expected to see a connection-refused page and
 * copy the URL out of the address bar. But if the REAL Codex CLI is mid-`codex
 * login` on the same machine, it owns port 1455, its local server receives the
 * redirect first and exchanges the code — and by the time the user pastes the URL
 * here, OpenAI answers `400 invalid_grant`, indistinguishable from an ordinary
 * expiry. Naming that cause is the part a code change CAN fix; the redirect
 * itself is an OpenAI-side client registration we do not control.
 */
const CODEX_CLI_ATE_THE_CODE =
  'If the Codex CLI is running a `codex login` on this machine it owns http://localhost:1455 and consumed the code first — quit it before starting again.';

async function requestTokens(body: URLSearchParams): Promise<OpenAICodexOAuthTokens> {
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) {
    throwTokenExchangeFailure({ status: response.status, body: await response.text(), label: 'OpenAI', spentHint: CODEX_CLI_ATE_THE_CODE });
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
