/**
 * The signed envelopes an SSO round trip carries, and nothing else.
 *
 * Two of them, with different lives and different jobs:
 *
 *   · the LOGIN STATE — connection id, nonce and post-login redirect — signed
 *     when a person is sent to their identity provider and read when the
 *     provider sends them back. Ten minutes, because an IdP that shows a consent
 *     screen and an MFA prompt is slow and a person reading it is slower.
 *
 *   · the SESSION EXCHANGE code, re-exported from `sessionExchange.ts` because
 *     it is the same envelope every federated sign-in ends with and must not be
 *     re-implemented per method.
 *
 * ── WHY THE NONCE RIDES THE STATE ────────────────────────────────────────────
 * It has to survive the round trip and there is no session to keep it in. A
 * cookie is the obvious alternative and it is the wrong one: several IdPs
 * perform a cross-site redirect chain on the way back, and a `SameSite=Lax`
 * cookie is dropped by it — producing a login that fails intermittently
 * depending on the provider, which is the worst possible failure mode for an
 * authentication path. Signing it into the state binds it to exactly the login
 * attempt it belongs to, which is the property the nonce was for.
 *
 * ── WHY THIS IS THE APPLICATION LAYER ────────────────────────────────────────
 * `signState`/`verifyState` are infrastructure, and a route may not reach them.
 * This module is the seam: it knows what an SSO login state MEANS, and the route
 * knows only that it has one.
 */

import { signState, verifyState } from '../../infrastructure/auth/oauthState';

export { mintSessionExchangeCode, readSessionExchangeCode, safeRedirectPath } from './sessionExchange';

import { safeRedirectPath } from './sessionExchange';

/** Ten minutes. See the header. */
export const SSO_STATE_TTL_MS = 600_000;

export interface SsoLoginState {
  /** `sso_connections.id` — which institution's provider this attempt belongs to. */
  cid: number;
  /** Must come back inside the id_token. Checking it is what stops a token
   *  captured from another login being replayed into this one. */
  nonce: string;
  redirect: string;
}

export async function signSsoLoginState(jwtSecret: string, state: SsoLoginState): Promise<string> {
  return signState(jwtSecret, {
    cid: state.cid,
    nonce: state.nonce,
    redirect: safeRedirectPath(state.redirect),
  });
}

/** Read one back, or null when it is forged, tampered with, or stale. The
 *  redirect is re-coerced on the way out: a value signed by an older build must
 *  not be honoured just because the signature is valid. */
export async function readSsoLoginState(jwtSecret: string, value: string): Promise<SsoLoginState | null> {
  const parsed = await verifyState<{ cid?: number; nonce?: string; redirect?: string }>(
    jwtSecret,
    value,
    SSO_STATE_TTL_MS,
  );
  if (!parsed?.cid || !parsed.nonce) return null;
  return { cid: parsed.cid, nonce: parsed.nonce, redirect: safeRedirectPath(parsed.redirect) };
}
