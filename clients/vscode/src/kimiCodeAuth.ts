/**
 * Keeping the local Kimi Code credential usable — the OAuth refresh grant, and the one
 * rule for turning "what is on disk" into "a token I may send right now".
 *
 * ONE reason to change: Kimi's OAuth protocol. The file format is
 * `kimiCodeCredentials.ts`; the endpoint/model catalog is `kimiCodeInstall.ts`.
 *
 * Why this exists: Kimi issues access tokens with `expires_in: 900`. Fifteen minutes.
 * Reading the file alone therefore produces a usable token only if Kimi Code itself
 * happened to run recently, which turns "use your Kimi subscription here" into "go poke
 * another app first". The record carries a `refresh_token`, so the honest fix is to
 * perform the same refresh grant Kimi Code performs, against the same endpoint, with the
 * same public client id — the credential, the account and the machine are all the user's.
 *
 * ROTATION is the hazard, and the reason this module writes as well as reads. Every grant
 * returns a NEW refresh token and retires the old one. Taking an access token without
 * persisting the rotated refresh token would leave Kimi Code holding a dead one — this
 * extension would work and their actual Kimi Code install would break.
 *
 * Kimi guards that with a cross-process lock — but only on POSIX: its own
 * `resolveLockTarget` returns undefined on win32, so on Windows two refreshers already
 * race by design. Rather than reimplement `proper-lockfile`, the race is resolved by its
 * OWN outcome: a rotation lost to another process comes back as `invalid_grant`, and the
 * winner has by then written a fresh credential to the very file we read. So on that
 * error we RE-READ instead of failing, and the loser of the race succeeds anyway.
 *
 * The PROTOCOL — client id, host, endpoints, grant types, error vocabulary — lives in
 * `@builderforce/kimi-oauth`, shared with the API Worker's web device-connect flow. What
 * stays here is this surface's own concerns: Kimi's on-disk record shape, persisting the
 * rotation, and the file-level race above.
 */

import {
  kimiExpiresInSeconds,
  kimiRefreshTokenRequest,
  parseKimiResponseBody,
  parseKimiTokenResponse,
  type KimiOAuthEnv,
} from "@builderforce/kimi-oauth";

import {
  classifyCredential,
  loadCredential,
  saveCredential,
  type KimiCredentialFs,
  type KimiCredentialRecord,
} from "./kimiCodeCredentials";

/** Why a refresh could not produce a token. `unauthorized` is terminal for this
 *  credential — only a fresh sign-in inside Kimi Code clears it. */
export type KimiRefreshFailure =
  | { kind: "unauthorized"; detail: string }
  | { kind: "unavailable"; detail: string };

export type KimiRefreshResult = { kind: "refreshed"; record: KimiCredentialRecord } | KimiRefreshFailure;

/** The subset of `fetch` this module needs, injected so the grant is testable. */
export type KimiFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Perform one `refresh_token` grant against the user's own Kimi account.
 *
 * The request is shaped by the shared protocol module, so it is byte-identical to the one
 * the web connect flow sends.
 */
export async function refreshKimiAccessToken(
  refreshToken: string,
  deps: { fetchImpl?: KimiFetch; env?: NodeJS.ProcessEnv; nowMs?: number } = {},
): Promise<KimiRefreshResult> {
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const request = kimiRefreshTokenRequest(refreshToken, (deps.env ?? process.env) as KimiOAuthEnv);

  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  } catch (error) {
    return { kind: "unavailable", detail: `Could not reach ${request.url}: ${(error as Error).message}` };
  }

  // Read as TEXT, then parse. A body that is not JSON is itself the diagnosis — an HTML
  // page means something in front of Kimi answered, not Kimi — and `response.json()`
  // would discard exactly that.
  const outcome = parseKimiTokenResponse(
    response.status,
    parseKimiResponseBody(await response.text()),
    refreshToken,
  );
  if (outcome.kind === "tokens") {
    const expiresIn = kimiExpiresInSeconds(outcome.tokens.expiresInSeconds);
    const nowMs = deps.nowMs ?? Date.now();
    return {
      kind: "refreshed",
      record: {
        accessToken: outcome.tokens.accessToken,
        // Rotation: the shared parser already keeps the NEW refresh token when one is
        // returned and falls back to the presented one when it is not.
        refreshToken: outcome.tokens.refreshToken,
        expiresAt: Math.floor(nowMs / 1000) + expiresIn,
        scope: outcome.tokens.scope,
        tokenType: outcome.tokens.tokenType,
        expiresIn,
      },
    };
  }
  if (outcome.kind === "unauthorized") return { kind: "unauthorized", detail: outcome.detail };
  if (outcome.kind === "failed") return { kind: "unavailable", detail: outcome.detail };
  // The device-flow waiting states cannot arise from a refresh grant, but naming the
  // outcome beats reporting an empty detail if Kimi ever returns one.
  return { kind: "unavailable", detail: `Kimi returned an unexpected ${outcome.kind} response to a refresh.` };
}

/** What the caller gets back/** What the caller gets back: a token it may send, or why it cannot have one. */
export type KimiTokenResult =
  | { kind: "token"; accessToken: string }
  | { kind: "signed_out"; detail: string }
  | { kind: "unavailable"; detail: string };

/** Collapses concurrent callers onto ONE in-flight grant.
 *
 *  Two turns starting together must not both spend the refresh token: the second grant
 *  would present a token the first had already rotated away, and one of them would fail.
 *  A single module-level promise is the right scope here — the extension host is one
 *  process, so there is no cross-isolate concern to push this into a shared cache. */
let inFlight: Promise<KimiTokenResult> | null = null;

/**
 * A Kimi access token that is safe to send right now, refreshing and persisting first if
 * the stored one is inside its refresh window.
 *
 * A `fresh` credential short-circuits with no network call and no write, so the common
 * path costs one small file read.
 */
export async function ensureFreshKimiToken(
  fs: KimiCredentialFs,
  home: string,
  deps: { fetchImpl?: KimiFetch; env?: NodeJS.ProcessEnv; nowMs?: () => number } = {},
): Promise<KimiTokenResult> {
  if (inFlight) return inFlight;
  const run = resolveToken(fs, home, deps).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/** Test seam — drop any in-flight grant between cases. */
export function resetKimiTokenRefreshState(): void {
  inFlight = null;
}

async function resolveToken(
  fs: KimiCredentialFs,
  home: string,
  deps: { fetchImpl?: KimiFetch; env?: NodeJS.ProcessEnv; nowMs?: () => number },
): Promise<KimiTokenResult> {
  const now = deps.nowMs ?? Date.now;
  const state = loadCredential(fs, home, now());
  if (state.kind === "fresh") return { kind: "token", accessToken: state.record.accessToken };
  if (state.kind === "revoked") {
    return { kind: "signed_out", detail: "You are signed out of Kimi Code. Sign in there to use it here." };
  }
  if (state.kind === "unreadable") return { kind: "unavailable", detail: state.detail };
  if (state.record.refreshToken.length === 0) {
    return { kind: "signed_out", detail: "The Kimi Code credential has no refresh token. Sign in again in Kimi Code." };
  }

  const refreshed = await refreshKimiAccessToken(state.record.refreshToken, {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.env ? { env: deps.env } : {}),
    nowMs: now(),
  });

  if (refreshed.kind === "refreshed") {
    try {
      saveCredential(fs, home, refreshed.record);
    } catch (error) {
      // The token in hand is valid and usable; failing the turn because the WRITE failed
      // would trade a working request for a bookkeeping problem. The cost is that the
      // next call refreshes again, which is correct behaviour, just not free.
      void error;
    }
    return { kind: "token", accessToken: refreshed.record.accessToken };
  }

  if (refreshed.kind === "unauthorized") {
    // Either the login really is finished, or another process (Kimi Code, or a second
    // window) rotated the token between our read and our grant — indistinguishable from
    // here, and on Windows there is no lock to prevent the second. Re-read: if a winner
    // wrote a usable credential, the race resolves itself and the user sees nothing.
    const after = loadCredential(fs, home, now());
    if (after.kind === "fresh" || after.kind === "stale") {
      const rechecked = classifyCredential(after.record, now());
      if (rechecked.kind === "fresh") return { kind: "token", accessToken: rechecked.record.accessToken };
    }
    return {
      kind: "signed_out",
      detail: `Kimi Code's saved login is no longer valid (${refreshed.detail}). Sign in again in Kimi Code.`,
    };
  }
  return { kind: "unavailable", detail: refreshed.detail };
}
