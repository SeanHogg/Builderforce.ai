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
 */

/** A pasted authorization code, split from whatever wrapper it arrived in. */
export interface PastedAuthorizationCode {
  /** The authorization code, or `''` when the paste carried none. */
  code: string;
  /** The CSRF `state` when the paste carried one — the KV lookup key. */
  state: string | null;
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
  // A URL is the only shape that can be recognised positively, so try it first
  // and fall through on the parse failure rather than sniffing for "http".
  try {
    const url = new URL(value);
    return { code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') };
  } catch {
    // Not a URL — `code#state` or a bare code. Nothing to report: this is the
    // expected path for two of the three accepted shapes, not a failure.
  }
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

/** An exchange failure carrying the HTTP status and wire code to answer with. */
export type OAuthExchangeError = Error & { status?: number; code?: string };

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
  const error = new Error(hint ? `${base} ${hint}` : base) as OAuthExchangeError;
  error.status = 400;
  error.code = OAUTH_CODE_SPENT;
  return error;
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
  const error = new Error(`${params.label} OAuth token request failed (${params.status}): ${detail}`) as OAuthExchangeError;
  error.status = params.status;
  throw error;
}
