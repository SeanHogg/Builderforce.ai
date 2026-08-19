/**
 * The single-use envelope that turns "this person authenticated" into a session,
 * without ever putting a session token in a URL.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * Every federated sign-in ends with a redirect back to the browser, and the
 * obvious thing to put in that redirect is the session JWT. That is the mistake
 * the OAuth callback documents at length: analytics capture `page_location` and
 * ship it to third parties, the value leaks through `Referer` to whatever the
 * landing page links to, and it stays in browser history for as long as the
 * profile does.
 *
 * So the redirect carries a 60-second, single-purpose HMAC envelope instead —
 * NOT a JWT, so it is useless as an API bearer — and the callback page swaps it
 * for the real token through `POST /api/auth/oauth/exchange`, which returns the
 * session in a RESPONSE BODY.
 *
 * ── WHY IT IS SHARED ─────────────────────────────────────────────────────────
 * Three sign-in paths now end this way: OAuth (Google/GitHub/LinkedIn/Microsoft),
 * an LTI 1.3 launch from an LMS, and enterprise SSO. Written three times, the
 * freshness window and the redirect guard would be three slightly different
 * numbers, and the one that drifted would be the one nobody tested.
 *
 * ── THE REDIRECT GUARD IS PART OF THE ENVELOPE ───────────────────────────────
 * `redirect` is coerced to a same-origin relative path at MINT time and again at
 * READ time. Twice on purpose: the mint side stops a bad value being signed, and
 * the read side stops one that was signed by an older build from being honoured.
 */

import { signState, verifyState } from '../../infrastructure/auth/oauthState';

/** How long a code is redeemable. Long enough for a redirect chain and a page
 *  load; short enough that a leaked URL is not a standing invitation. */
export const EXCHANGE_TTL_MS = 60_000;

export interface SessionExchangePayload {
  /** users.id */
  uid: string;
  /** Which method authenticated them — recorded on the session's `amr` claim so
   *  an audit can tell an SSO sign-in from a password one. */
  amr: string;
  /** Where to land afterwards. Always a same-origin relative path. */
  redirect: string;
}

/**
 * Coerce an untrusted redirect to a safe same-origin path.
 *
 * Rejects absolute URLs, protocol-relative `//evil.com`, scheme URLs
 * (`javascript:`) and the backslash trick browsers normalise to `/`. Mirrors
 * `frontend/src/lib/safeRedirect.ts` — the check has to exist on BOTH sides of
 * the package boundary, because either side alone is bypassable.
 */
export function safeRedirectPath(path: string | null | undefined): string {
  return typeof path === 'string'
    && path.startsWith('/')
    && !path.startsWith('//')
    && !path.includes('://')
    && !path.includes('\\')
    ? path
    : '/dashboard';
}

/** Mint the code that rides the post-login redirect. */
export async function mintSessionExchangeCode(
  jwtSecret: string,
  payload: SessionExchangePayload,
): Promise<string> {
  return signState(jwtSecret, {
    uid: payload.uid,
    amr: payload.amr,
    redirect: safeRedirectPath(payload.redirect),
  });
}

/** Read one back, or null when it is forged, tampered with or older than
 *  {@link EXCHANGE_TTL_MS}. */
export async function readSessionExchangeCode(
  jwtSecret: string,
  code: string,
): Promise<SessionExchangePayload | null> {
  const parsed = await verifyState<{ uid?: string; amr?: string; redirect?: string }>(
    jwtSecret,
    code,
    EXCHANGE_TTL_MS,
  );
  if (!parsed?.uid) return null;
  return {
    uid: parsed.uid,
    amr: parsed.amr ?? 'oauth',
    redirect: safeRedirectPath(parsed.redirect),
  };
}
