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
 */

import {
  classifyCredential,
  loadCredential,
  saveCredential,
  type KimiCredentialFs,
  type KimiCredentialRecord,
} from "./kimiCodeCredentials";

/**
 * Kimi Code's own OAuth constants, read from the shipped client.
 *
 * The client id is a PUBLIC OAuth client identifier — the kind every distributed native
 * client embeds, and not a secret (a public client cannot hold one). It identifies the
 * application, while the refresh token that authorizes the grant is the user's own and
 * never leaves their machine. The host honours the same env overrides Kimi Code does, so
 * a self-hosted or staging deployment keeps working.
 */
export const KIMI_OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
export const KIMI_OAUTH_DEFAULT_HOST = "https://auth.kimi.com";
const TOKEN_PATH = "/api/oauth/token";

export function kimiOAuthHost(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.KIMI_CODE_OAUTH_HOST ?? env.KIMI_OAUTH_HOST;
  const host = override?.trim();
  return (host && host.length > 0 ? host : KIMI_OAUTH_DEFAULT_HOST).replace(/\/+$/, "");
}

/** Statuses worth another attempt, matching Kimi Code's own retry set. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Why a refresh could not produce a token. `unauthorized` is terminal for this
 *  credential — only a fresh sign-in inside Kimi Code clears it. */
export type KimiRefreshFailure =
  | { kind: "unauthorized"; detail: string }
  | { kind: "unavailable"; detail: string };

export type KimiRefreshResult = { kind: "refreshed"; record: KimiCredentialRecord } | KimiRefreshFailure;

/** The subset of `fetch` this module needs, injected so the grant is testable. */
export type KimiFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Perform one `refresh_token` grant.
 *
 * Form-encoded, exactly as Kimi Code sends it. Device headers are deliberately omitted:
 * they are optional in Kimi Code's own client (`this.deviceHeaders?.()`), and sending a
 * fabricated device identity would be a claim about the machine we have no business
 * making.
 */
export async function refreshKimiAccessToken(
  refreshToken: string,
  deps: { fetchImpl?: KimiFetch; env?: NodeJS.ProcessEnv; nowMs?: number } = {},
): Promise<KimiRefreshResult> {
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${kimiOAuthHost(deps.env)}${TOKEN_PATH}`;
  const body = new URLSearchParams({
    client_id: KIMI_OAUTH_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
  } catch (error) {
    return { kind: "unavailable", detail: `Could not reach ${url}: ${(error as Error).message}` };
  }

  let data: Record<string, unknown> = {};
  try {
    const parsed = (await response.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // A non-JSON body is handled by the status checks below.
  }

  if (response.status === 200 && typeof data.access_token === "string" && data.access_token.length > 0) {
    const expiresIn = Number(data.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      return { kind: "unavailable", detail: "Kimi's token response carried no usable expires_in." };
    }
    const nowMs = deps.nowMs ?? Date.now();
    return {
      kind: "refreshed",
      record: {
        accessToken: data.access_token,
        // Rotation: keep the NEW refresh token when one is returned, and fall back to the
        // presented one when it is not, so a server that does not rotate still works.
        refreshToken: typeof data.refresh_token === "string" && data.refresh_token.length > 0
          ? data.refresh_token
          : refreshToken,
        expiresAt: Math.floor(nowMs / 1000) + expiresIn,
        scope: typeof data.scope === "string" ? data.scope : "",
        tokenType: typeof data.token_type === "string" ? data.token_type : "Bearer",
        expiresIn,
      },
    };
  }

  const errorCode = typeof data.error === "string" ? data.error : "";
  const detail = typeof data.error_description === "string" ? data.error_description : errorCode;
  if (response.status === 401 || response.status === 403 || errorCode === "invalid_grant") {
    return { kind: "unauthorized", detail: detail || `Refresh rejected (HTTP ${response.status}).` };
  }
  return {
    kind: RETRYABLE_STATUSES.has(response.status) ? "unavailable" : "unavailable",
    detail: detail || `Refresh failed (HTTP ${response.status}).`,
  };
}

/** What the caller gets back: a token it may send, or why it cannot have one. */
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
