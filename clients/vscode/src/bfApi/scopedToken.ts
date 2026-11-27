import type * as vscode from "vscode";
import { getBaseUrl } from "../gateway/gateway";
import { getTenantJwt, onSessionChange, refreshTenantJwt } from "./session";

/**
 * Audience-scoped tokens (SEC-G017). A sibling extension (Spawn) never receives the
 * tenant JWT or the editor key: it asks the `builderforce` auth provider for a session
 * scoped to `spawn`, whose `accessToken` is a 15-minute token from
 * `POST /api/auth/scoped-token` that the server accepts only on that audience's routes.
 */
export type ScopedAudience = "spawn";

/** A cached token is re-minted once less than this remains, so a caller always gets >= 2 minutes. */
export const SCOPED_TOKEN_MIN_REMAINING_MS = 2 * 60_000;

const MINT_TIMEOUT_MS = 10_000;

interface Cached { token: string; expiresAt: number }

const cache = new Map<ScopedAudience, Cached>();
const inFlight = new Map<ScopedAudience, Promise<Cached | undefined>>();

/** Bumped whenever the identity/workspace moves or the cache is invalidated; a mint begun under an older value is stale. */
let generation = 0;

// The cached token belongs to the identity/workspace that minted it: drop it when either moves.
onSessionChange(() => { invalidateScopedTokens(); });

/** Receives an error a mint swallowed, so it is reported rather than lost (wired to the output channel by the auth provider). */
let errorSink: (error: unknown) => void = () => undefined;
export function setScopedTokenErrorSink(sink: (error: unknown) => void): void {
  errorSink = sink;
}

/** Drops every cached and in-flight token; the next caller mints a fresh one. Exposes no credential. */
export function invalidateScopedTokens(): void {
  generation++;
  cache.clear();
  inFlight.clear();
}

async function requestScoped(audience: ScopedAudience, jwt: string): Promise<Response> {
  return fetch(`${getBaseUrl()}/api/auth/scoped-token`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ audience }),
    signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
  });
}

/**
 * The gateway could not be asked or could not answer (network, 5xx, 429). Distinct from "no
 * session" (signed out / 401 after a refresh), which is `undefined`: callers must not report
 * a transient outage as the user being signed out.
 */
export class ScopedTokenUnavailableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ScopedTokenUnavailableError";
  }
}

async function mint(secrets: vscode.SecretStorage, audience: ScopedAudience): Promise<Cached | undefined> {
  try {
    let jwt = await getTenantJwt(secrets);
    if (!jwt) return undefined;
    let res = await requestScoped(audience, jwt);
    if (res.status === 401) {
      // A stale tenant token: re-mint it once and ask again.
      jwt = await refreshTenantJwt(secrets);
      if (!jwt) return undefined;
      res = await requestScoped(audience, jwt);
    }
    if (!res.ok) {
      const failure = new ScopedTokenUnavailableError(`Scoped token mint answered HTTP ${res.status}`, res.status);
      errorSink(failure);
      // 401 after a refresh (and any other refusal) means no session; 5xx / 429 mean unavailable.
      if (res.status >= 500 || res.status === 429) throw failure;
      return undefined;
    }
    const body = (await res.json()) as { token?: unknown; expiresAt?: unknown };
    const expiresAt = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
    if (typeof body.token !== "string" || !body.token || !Number.isFinite(expiresAt)) return undefined;
    return { token: body.token, expiresAt };
  } catch (e) {
    if (e instanceof ScopedTokenUnavailableError) throw e; // already reported above
    errorSink(e);
    // A network failure / timeout: the gateway is unavailable, not the user signed out.
    throw new ScopedTokenUnavailableError(`Scoped token mint failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const MAX_STALE_RETRIES = 2;

/**
 * A scoped token for `audience` valid for at least {@link SCOPED_TOKEN_MIN_REMAINING_MS},
 * or undefined when there is no session (signed out, or still 401 after a refresh). Throws
 * {@link ScopedTokenUnavailableError} when the gateway is unavailable (network, 5xx, 429).
 * Cached; concurrent callers share one mint.
 */
export async function getScopedToken(
  secrets: vscode.SecretStorage,
  audience: ScopedAudience,
  now: () => number = Date.now,
): Promise<string | undefined> {
  for (let attempt = 0; ; attempt++) {
    const hit = cache.get(audience);
    if (hit && hit.expiresAt - now() >= SCOPED_TOKEN_MIN_REMAINING_MS) return hit.token;
    const startedUnder = generation;
    let pending = inFlight.get(audience);
    if (!pending) {
      const mine: Promise<Cached | undefined> = mint(secrets, audience).finally(() => {
        // Only remove our own entry: an invalidation may have replaced it with a newer mint.
        if (inFlight.get(audience) === mine) inFlight.delete(audience);
      });
      pending = mine;
      inFlight.set(audience, pending);
    }
    const fresh = await pending;
    if (!fresh) return undefined;
    // Minted for an identity/workspace that has since moved (or after an invalidation): never cache it, mint again.
    if (generation !== startedUnder) {
      if (attempt >= MAX_STALE_RETRIES) return undefined;
      continue;
    }
    cache.set(audience, fresh);
    return fresh.expiresAt - now() >= SCOPED_TOKEN_MIN_REMAINING_MS ? fresh.token : undefined;
  }
}

/** Test seam: forget every cached token. */
export function resetScopedTokens(): void {
  invalidateScopedTokens();
}
