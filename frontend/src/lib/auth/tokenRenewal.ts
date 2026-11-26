/**
 * Background renewal of the short-lived web session token.
 *
 * Web tokens live minutes, not a day; the session itself still lasts as long as it
 * always did, because the API swaps a current token for a fresh one
 * (`POST /api/auth/web/renew`) without moving the session's end. This module is the
 * client half, and the only place that decides WHEN to renew:
 *
 *   - on a timer, at 75% of the token's remaining life;
 *   - when the tab comes back to the foreground with the token near its end;
 *   - when a request is answered 401 (`renewAfterUnauthorized`, called once by the
 *     transport before it gives up and redirects).
 *
 * Renewal ROTATES the token — the one that was presented stops working, and presenting
 * it again later ends the whole session (the API only tolerates a repeat within a
 * short window: two tabs at one instant, a lost response retried). Renewal is therefore
 * single-flight across tabs: one tab holds a lock in localStorage while it renews, the
 * others wait for the new token to appear in storage and adopt it. After the web token renews,
 * the workspace token is re-minted through the same `getTenantToken` exchange the
 * sign-in uses.
 *
 * A refused renewal means the session is over and signs out normally. A renewal that
 * simply could not be reached (offline, 5xx) never signs anyone out; it retries.
 */

import {
  getStoredTenant,
  getStoredTenantToken,
  getStoredWebToken,
  handleApiUnauthorized,
  isEmbedMode,
  persistTenantSession,
  persistWebToken,
} from '../auth';
import { getTenantToken, renewWebToken } from './credentials';
import { decodeTokenClaims } from '../tokenClaims';

/** Renew when this fraction of the remaining life has elapsed. */
export const RENEW_AT_FRACTION_OF_REMAINING = 0.75;
/** Never wait less than this between renewals (unless the token ends sooner). */
export const MIN_RENEW_DELAY_MS = 30_000;
/** Retry delay after a renewal that could not be reached. */
export const RENEW_RETRY_MS = 30_000;
/** Fired on `window` in THIS tab after the stored session tokens were replaced. */
export const SESSION_RENEWED_EVENT = 'bf:session-renewed';

const LOCK_KEY = 'bf_renew_lock';
/** A lock this old belongs to a tab that died mid-renewal. */
const LOCK_TTL_MS = 15_000;
const LOCK_POLL_MS = 100;

const TAB_ID = Math.random().toString(36).slice(2);

export type RenewOutcome = 'renewed' | 'adopted' | 'no_session' | 'expired' | 'transient';

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

/** Milliseconds until the token should be renewed, or null for an unreadable token. 0 = now. */
export function renewalDelayMs(token: string | null, nowMs = Date.now()): number | null {
  const { exp } = decodeTokenClaims(token);
  if (typeof exp !== 'number') return null;
  const remaining = exp * 1000 - nowMs;
  if (remaining <= 0) return 0;
  return Math.floor(Math.max(remaining * RENEW_AT_FRACTION_OF_REMAINING, Math.min(remaining, MIN_RENEW_DELAY_MS)));
}

/** Is the token in the last quarter of its life (or past it)? Used when a tab regains focus. */
export function isNearExpiry(token: string | null, nowMs = Date.now()): boolean {
  const { exp, iat } = decodeTokenClaims(token);
  if (typeof exp !== 'number') return false;
  const lifetimeMs = typeof iat === 'number' ? (exp - iat) * 1000 : 0;
  return exp * 1000 - nowMs <= (1 - RENEW_AT_FRACTION_OF_REMAINING) * lifetimeMs;
}

// ---------------------------------------------------------------------------
// Cross-tab lock
// ---------------------------------------------------------------------------

function readLock(): { tab: string; until: number } | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    return raw ? (JSON.parse(raw) as { tab: string; until: number }) : null;
  } catch {
    return null;
  }
}

function heldByAnotherTab(): boolean {
  const lock = readLock();
  return !!lock && lock.tab !== TAB_ID && lock.until > Date.now();
}

function tryAcquire(): boolean {
  if (heldByAnotherTab()) return false;
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({ tab: TAB_ID, until: Date.now() + LOCK_TTL_MS }));
  } catch {
    return true; // no storage to coordinate through — renew anyway
  }
  return readLock()?.tab === TAB_ID;
}

function release(): void {
  try {
    if (readLock()?.tab === TAB_ID) localStorage.removeItem(LOCK_KEY);
  } catch {
    // nothing to release
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

/** Re-mint the workspace token from the web token that was just issued. Best effort. */
async function remintTenantToken(webToken: string): Promise<void> {
  const tenant = getStoredTenant();
  if (!tenant || !getStoredTenantToken()) return;
  try {
    const res = await getTenantToken(webToken, tenant.id);
    persistTenantSession(res.token, tenant);
  } catch (error) {
    // A failed re-mint never fails the renewal (the next 401 renews again), but it is recorded.
    // Loaded lazily: the reporter sends through the API client, which imports this module.
    void import('../reportError').then(({ reportBackgroundFailure }) => reportBackgroundFailure({
      message: `Re-minting the workspace token after a renewal failed: ${error instanceof Error ? error.message : String(error)}`,
      level: 'warning',
    }));
  }
}

async function renewOnce(before: string): Promise<RenewOutcome> {
  // Another tab may already hold the lock: wait for it to finish, then adopt what it stored.
  // Losing the acquire race to a tab that wrote the lock at the same instant is the same
  // situation, so it waits too rather than giving up (a give-up here would turn a 401 into
  // a sign-out). A dead holder's lock lapses after LOCK_TTL_MS.
  const giveUpAt = Date.now() + 2 * LOCK_TTL_MS;
  for (;;) {
    while (heldByAnotherTab()) {
      await sleep(LOCK_POLL_MS);
      if (getStoredWebToken() !== before) return 'adopted';
    }
    if (getStoredWebToken() !== before) return 'adopted';
    if (tryAcquire()) break;
    if (Date.now() > giveUpAt) return 'transient';
    await sleep(LOCK_POLL_MS);
  }
  try {
    // A tab that renewed between our decision and our lock already did the work.
    if (getStoredWebToken() !== before) return 'adopted';
    const res = await renewWebToken(before);
    if (res.kind === 'renewed') {
      persistWebToken(res.token);
      await remintTenantToken(res.token);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_RENEWED_EVENT));
      return 'renewed';
    }
    if (res.kind === 'refused') {
      // Refused for a token that is no longer the stored one means another tab got there first.
      return getStoredWebToken() !== before ? 'adopted' : 'expired';
    }
    return 'transient';
  } finally {
    release();
  }
}

let inflight: Promise<RenewOutcome> | null = null;

/** Renew the web (and workspace) token. Concurrent callers in this tab share one attempt. */
export function renewSession(): Promise<RenewOutcome> {
  const before = getStoredWebToken();
  if (!before || isEmbedMode()) return Promise.resolve('no_session');
  inflight ??= renewOnce(before).finally(() => { inflight = null; });
  return inflight;
}

/**
 * The transport's hook for a 401: was it just a token that lapsed? True when a newer
 * token is now stored and the request is worth sending ONE more time. False means
 * give up — the caller's normal sign-out path takes over.
 */
export async function renewAfterUnauthorized(sentAuthorization: string | undefined): Promise<boolean> {
  if (!getStoredWebToken() || isEmbedMode()) return false;
  const sent = sentAuthorization?.replace(/^Bearer /, '');
  // Another request or tab already replaced the token this one was sent with.
  if (sent && sent !== getStoredWebToken() && sent !== getStoredTenantToken()) return true;
  const outcome = await renewSession();
  return outcome === 'renewed' || outcome === 'adopted';
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;

function signOut(): void {
  try {
    handleApiUnauthorized();
  } catch {
    // handleApiUnauthorized always throws after it has cleared the session and redirected.
  }
}

function arm(delayMs: number | null): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (delayMs === null) return;
  timer = setTimeout(() => { timer = null; void tick(); }, delayMs);
}

function armFromStoredToken(): void {
  arm(renewalDelayMs(getStoredWebToken()));
}

async function tick(): Promise<void> {
  const outcome = await renewSession();
  if (outcome === 'expired') signOut();
  else if (outcome === 'transient') arm(RENEW_RETRY_MS);
  // Nothing to renew (signed out, embed): stop. Re-arming would spin on a lapsed token.
  else if (outcome === 'no_session') arm(null);
  else armFromStoredToken();
}

/**
 * For a transport that cannot resend its request (a stream): after a 401 on a web
 * session, renew in the background so the NEXT request carries a fresh token, and
 * sign out only if the renewal is refused. Returns false when there is no web session
 * to renew (embed, signed out) — the caller's own 401 handling applies then.
 */
export function renewInBackgroundAfterUnauthorized(): boolean {
  if (!getStoredWebToken() || isEmbedMode()) return false;
  void tick();
  return true;
}

/**
 * Keep the stored session renewed for as long as the caller (the auth provider) is
 * mounted. Call again when the stored token changes — it re-arms from the new token.
 * Returns the cleanup.
 */
export function startTokenRenewal(): () => void {
  // An embed runs on its host's token and has no web session of its own to renew.
  if (typeof window === 'undefined' || isEmbedMode()) return () => undefined;
  armFromStoredToken();
  const onForeground = () => {
    if (document.visibilityState === 'hidden') return;
    if (isNearExpiry(getStoredWebToken())) void tick();
  };
  document.addEventListener('visibilitychange', onForeground);
  window.addEventListener('focus', onForeground);
  return () => {
    document.removeEventListener('visibilitychange', onForeground);
    window.removeEventListener('focus', onForeground);
    arm(null);
  };
}
