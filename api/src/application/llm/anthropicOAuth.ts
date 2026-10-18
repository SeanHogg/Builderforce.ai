/**
 * Anthropic (Claude Pro/Max subscription) OAuth — the gateway-side port of the
 * Claude Code login flow, so a tenant can connect their OWN Claude subscription
 * and have BuilderForce run their agents on it (no per-token API-key billing).
 *
 * This uses Anthropic's PUBLIC Claude Code OAuth client (the same `client_id`
 * Claude Code itself uses), so we cannot register a custom redirect — we use the
 * console "manual code" redirect (`REDIRECT_URI`). The authorize page shows the
 * user a `code#state` string they paste back into our UI; we exchange it (with
 * the PKCE verifier) for `{access, refresh, expires}` tokens here.
 *
 * Mirrors `agent-runtime`'s `oauth/index.ts#refreshAnthropicToken` (same client
 * id + token endpoint) so the on-prem and cloud paths agree on the contract.
 *
 * POLICY: an OAuth token is a personal subscription credential. Each tenant must
 * connect THEIR OWN subscription — it is never resold or shared across tenants.
 */
import { createPkcePair } from '../../infrastructure/crypto/pkce';
import { randomBase64Url } from '../../domain/shared/bytes';
import {
  exchangeSubscriptionCode,
  refreshSubscriptionToken,
  subscriptionAuthorizeUrl,
  type SubscriptionOAuthClient,
} from './subscriptionOAuthCode';

/** The Claude Code public client, as a descriptor for the shared subscription flow. */
const ANTHROPIC_OAUTH_CLIENT: SubscriptionOAuthClient = {
  label: 'Anthropic',
  // The public Claude Code OAuth client id (base64 of the uuid, matching
  // agent-runtime's encoding so the two never drift on a copy-paste).
  clientId: atob('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl'),
  /** Where the user authorizes — Claude.ai's OAuth consent page. */
  authUrl: 'https://claude.ai/oauth/authorize',
  /** Token mint + refresh endpoint (authorization_code and refresh_token grants). */
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  /** Console "manual code" redirect — the only redirect the public client allows;
   *  the consent page renders the resulting `code#state` for the user to copy. */
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  /** `user:inference` is the scope that lets the token drive Messages calls. */
  scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
  // `code=true` makes the consent page render the manual code for copy/paste.
  extraAuthParams: { code: 'true' },
  // The console token endpoint takes JSON, not RFC 6749 form encoding.
  tokenBodyEncoding: 'json',
};

/** Beta header REQUIRED on every Messages call made with a subscription OAuth
 *  token (an API key uses `x-api-key` and must NOT send this). */
export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';

/** First system block REQUIRED for subscription OAuth tokens — Anthropic rejects
 *  (401/403) an OAuth Messages call whose system prompt does not lead with the
 *  Claude Code identity. Injected by the gateway on every BYO-subscription call. */
export const CLAUDE_CODE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

export interface AnthropicOAuthTokens {
  access: string;
  refresh: string;
  /** Absolute expiry, ms since epoch (already includes a safety margin). */
  expires: number;
}

/** Safety margin baked into {@link AnthropicOAuthTokens.expires}: the stored value is
 *  the real expiry MINUS this, so a token is treated as expired 5 min early and never
 *  dies mid-call. The REAL expiry is `expires + OAUTH_SAFETY_MARGIN_MS` — used to decide
 *  whether a still-valid access token can be reused when a refresh transiently fails. */
export const OAUTH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

/** Generate a PKCE verifier + S256 challenge using WebCrypto (available in the
 *  Worker runtime). The verifier is held server-side (KV) keyed by `state`; the
 *  challenge travels in the authorize URL. */
export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const pair = await createPkcePair();
  return { verifier: pair.codeVerifier, challenge: pair.codeChallenge };
}

/** A random `state` value (also CSRF token); echoed back in the pasted code and
 *  re-checked at exchange time. */
export function generateState(): string {
  return randomBase64Url(24);
}

/** Build the Claude.ai authorize URL the user opens to grant access. */
export function buildAuthorizeUrl(params: { state: string; challenge: string }): string {
  return subscriptionAuthorizeUrl(ANTHROPIC_OAUTH_CLIENT, params);
}

/**
 * Anthropic's token parsing — the one per-provider part of the exchange.
 * `previousRefresh` is kept when a refresh response does not rotate the token,
 * so a non-rotating reply can never strand the grant without one.
 */
function toTokens(
  data: { access_token: string; refresh_token?: string; expires_in?: number },
  previousRefresh?: string,
): AnthropicOAuthTokens {
  const refresh = data.refresh_token ?? previousRefresh;
  if (!refresh || typeof data.expires_in !== 'number') {
    throw new Error('Anthropic OAuth token response was incomplete');
  }
  return {
    access: data.access_token,
    refresh,
    // 5-minute safety margin so a token never expires mid-call (matches agent-runtime).
    expires: Date.now() + data.expires_in * 1000 - OAUTH_SAFETY_MARGIN_MS,
  };
}

/**
 * Exchange the authorization code (+ PKCE verifier) for subscription tokens.
 *
 * A dead code is the ordinary failure here, not an outage: the consent page is on
 * a domain we do not own, so there is always a gap between approving and pasting.
 * The shared exchange gives it a 400 and an instruction instead of a 502 with
 * Anthropic's raw JSON. Anthropic also wants the `state` echoed in the body.
 */
export async function exchangeAnthropicCode(params: {
  code: string;
  state: string;
  verifier: string;
}): Promise<AnthropicOAuthTokens> {
  return toTokens(await exchangeSubscriptionCode(ANTHROPIC_OAUTH_CLIENT, {
    code: params.code,
    verifier: params.verifier,
    extra: { state: params.state },
  }));
}

/**
 * Refresh an expired subscription access token. Returns fresh tokens (the
 * refresh token may itself rotate, so persist whatever comes back). A refusal
 * carries the upstream HTTP `status` so the resolver can tell a REVOKED refresh
 * token (401/403) from a transient failure (5xx/429).
 */
export async function refreshAnthropicToken(refreshToken: string): Promise<AnthropicOAuthTokens> {
  return toTokens(await refreshSubscriptionToken(ANTHROPIC_OAUTH_CLIENT, refreshToken), refreshToken);
}

/**
 * Ensure an Anthropic Messages request body leads with the Claude Code identity
 * system block (required for subscription OAuth tokens). No-ops when the body's
 * system prompt already starts with the identity, so we never double-inject for
 * callers (e.g. the V2 Claude Agent SDK) that already send it.
 *
 * `system` may be a string, an array of content blocks, or absent — all three
 * are normalised to an array with the identity block first.
 */
export function withClaudeCodeSystemPrompt(body: Record<string, unknown>): Record<string, unknown> {
  const system = body['system'];
  const alreadyHasIdentity =
    (typeof system === 'string' && system.trimStart().startsWith(CLAUDE_CODE_SYSTEM_PROMPT)) ||
    (Array.isArray(system) &&
      typeof (system[0] as { text?: unknown } | undefined)?.text === 'string' &&
      ((system[0] as { text: string }).text).trimStart().startsWith(CLAUDE_CODE_SYSTEM_PROMPT));
  if (alreadyHasIdentity) return body;

  const identityBlock = { type: 'text', text: CLAUDE_CODE_SYSTEM_PROMPT };
  const existing: unknown[] =
    typeof system === 'string'
      ? (system.trim() ? [{ type: 'text', text: system }] : [])
      : Array.isArray(system)
        ? system
        : [];
  return { ...body, system: [identityBlock, ...existing] };
}
