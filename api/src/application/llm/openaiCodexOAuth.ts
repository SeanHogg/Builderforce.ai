/** OpenAI Codex / ChatGPT subscription OAuth for tenant-owned credentials. */
import {
  exchangeSubscriptionCode,
  refreshSubscriptionToken,
  subscriptionAuthorizeUrl,
  type SubscriptionOAuthClient,
} from './subscriptionOAuthCode';
import type { TokenResponse } from '../shared/providerOAuthConnect';
import { tryDecodeJwtPayload } from '@builderforce/hs256-jwt';

export const OPENAI_CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const JWT_AUTH_CLAIM = 'https://api.openai.com/auth';

export interface OpenAICodexOAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

const decodeJwt = (token: string): Record<string, unknown> | null => tryDecodeJwtPayload(token);

function accountIdFromToken(token: string): string {
  const auth = decodeJwt(token)?.[JWT_AUTH_CLAIM] as { chatgpt_account_id?: unknown } | undefined;
  if (typeof auth?.chatgpt_account_id !== 'string' || !auth.chatgpt_account_id) {
    throw new Error('OpenAI OAuth token did not contain a ChatGPT account id');
  }
  return auth.chatgpt_account_id;
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

/** The Codex CLI public client, as a descriptor for the shared subscription flow. */
const OPENAI_CODEX_OAUTH_CLIENT: SubscriptionOAuthClient = {
  label: 'OpenAI',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  redirectUri: OPENAI_CODEX_REDIRECT_URI,
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  extraAuthParams: { id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: 'builderforce' },
  spentHint: CODEX_CLI_ATE_THE_CODE,
};

export function buildOpenAICodexAuthorizeUrl(params: { state: string; challenge: string }): string {
  return subscriptionAuthorizeUrl(OPENAI_CODEX_OAUTH_CLIENT, params);
}

/** OpenAI's token parsing — the ChatGPT account id rides in the access token. */
function toTokens(data: TokenResponse): OpenAICodexOAuthTokens {
  if (!data.refresh_token || typeof data.expires_in !== 'number') throw new Error('OpenAI OAuth token response was incomplete');
  return { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + data.expires_in * 1000 - 300_000, accountId: accountIdFromToken(data.access_token) };
}

export async function exchangeOpenAICodexCode(params: { code: string; verifier: string }): Promise<OpenAICodexOAuthTokens> {
  return toTokens(await exchangeSubscriptionCode(OPENAI_CODEX_OAUTH_CLIENT, params));
}

export async function refreshOpenAICodexToken(refreshToken: string): Promise<OpenAICodexOAuthTokens> {
  return toTokens(await refreshSubscriptionToken(OPENAI_CODEX_OAUTH_CLIENT, refreshToken));
}
