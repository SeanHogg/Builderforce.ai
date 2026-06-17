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

// The public Claude Code OAuth client id (base64 of the uuid, matching
// agent-runtime's encoding so the two never drift on a copy-paste).
const ANTHROPIC_CLIENT_ID = atob('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl');
/** Where the user authorizes — Claude.ai's OAuth consent page. */
const ANTHROPIC_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
/** Token mint + refresh endpoint (authorization_code and refresh_token grants). */
const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
/** Console "manual code" redirect — the only redirect the public client allows;
 *  the consent page renders the resulting `code#state` for the user to copy. */
const ANTHROPIC_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
/** Scopes Claude Code requests. `user:inference` is the one that lets the token
 *  drive Messages calls under the subscription. */
const ANTHROPIC_SCOPES = 'org:create_api_key user:profile user:inference';

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

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a PKCE verifier + S256 challenge using WebCrypto (available in the
 *  Worker runtime). The verifier is held server-side (KV) keyed by `state`; the
 *  challenge travels in the authorize URL. */
export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64UrlEncode(verifierBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

/** A random `state` value (also CSRF token); echoed back in the pasted code and
 *  re-checked at exchange time. */
export function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));
}

/** Build the Claude.ai authorize URL the user opens to grant access. */
export function buildAuthorizeUrl(params: { state: string; challenge: string }): string {
  const url = new URL(ANTHROPIC_AUTHORIZE_URL);
  url.searchParams.set('code', 'true'); // render the manual code for copy/paste
  url.searchParams.set('client_id', ANTHROPIC_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', ANTHROPIC_REDIRECT_URI);
  url.searchParams.set('scope', ANTHROPIC_SCOPES);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  return url.toString();
}

/** The consent page hands back `code#state` (or sometimes just `code`). Split it
 *  so the caller can both exchange the code and verify state. */
export function parsePastedCode(pasted: string): { code: string; state: string | null } {
  const trimmed = pasted.trim();
  const hash = trimmed.indexOf('#');
  if (hash === -1) return { code: trimmed, state: null };
  return { code: trimmed.slice(0, hash), state: trimmed.slice(hash + 1) || null };
}

function toTokens(data: { access_token: string; refresh_token: string; expires_in: number }): AnthropicOAuthTokens {
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    // 5-minute safety margin so a token never expires mid-call (matches agent-runtime).
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

/** Exchange the authorization code (+ PKCE verifier) for subscription tokens. */
export async function exchangeAnthropicCode(params: {
  code: string;
  state: string;
  verifier: string;
}): Promise<AnthropicOAuthTokens> {
  const resp = await fetch(ANTHROPIC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: params.code,
      state: params.state,
      client_id: ANTHROPIC_CLIENT_ID,
      redirect_uri: ANTHROPIC_REDIRECT_URI,
      code_verifier: params.verifier,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Anthropic OAuth code exchange failed (${resp.status}): ${(await resp.text()).slice(0, 240)}`);
  }
  return toTokens((await resp.json()) as { access_token: string; refresh_token: string; expires_in: number });
}

/** Refresh an expired subscription access token. Returns fresh tokens (the
 *  refresh token may itself rotate, so persist whatever comes back). */
export async function refreshAnthropicToken(refreshToken: string): Promise<AnthropicOAuthTokens> {
  const resp = await fetch(ANTHROPIC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: ANTHROPIC_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Anthropic OAuth token refresh failed (${resp.status}): ${(await resp.text()).slice(0, 240)}`);
  }
  return toTokens((await resp.json()) as { access_token: string; refresh_token: string; expires_in: number });
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
