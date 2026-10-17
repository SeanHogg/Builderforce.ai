/**
 * The reconnect rules, written once — the socket twin of `pollPolicy`.
 *
 * Every relay socket in the product needs the same decisions when it drops, and the
 * hand-rolled copies each made their own (a fixed 2 s, 3 s or 5 s loop with no cap,
 * no backoff and no visibility check — so a tab left open on a dead relay retried
 * forever, and each retry that reached the API could keep the database awake):
 *
 *   • wait, doubling per consecutive failure up to a ceiling, and reset to the short
 *     wait only after a connection that HELD (a server that accepts and drops at
 *     once must not earn a tight loop);
 *   • never retry a close code that means "not allowed";
 *   • give up after a run of attempts that never opened — a browser never exposes
 *     the upgrade's HTTP status, so a 401/403 looks exactly like a network blip
 *     (close 1006 before `open`), and a room that never opens is treated as refused;
 *   • a hidden tab does not reconnect; it waits for visibility, and coming back
 *     grants one fresh round from the short wait.
 *
 * The caller owns the socket and its frames; this owns only WHEN to call
 * `connect` again. Report each attempt's fate through `opened()` / `closed()`.
 */
import { backoffDelay, isDocumentHidden } from './pollPolicy';

/** First reconnect wait; doubles per consecutive failure up to {@link RECONNECT_MAX_MS}. */
export const RECONNECT_BASE_MS = 2_000;
export const RECONNECT_MAX_MS = 60_000;
/** Consecutive attempts that closed WITHOUT ever opening before giving up (~4 min backed off). */
export const MAX_UNOPENED_ATTEMPTS = 8;
/** A socket must stay open this long before its close resets the backoff. */
export const STABLE_OPEN_MS = 10_000;
/** Close codes a server sends to say "not allowed" — never retried. */
export const AUTH_CLOSE_CODES: ReadonlySet<number> = new Set([1008, 4001, 4003, 4401, 4403]);

/** Why the reconnector stopped trying: refused by the server, never opened, or the caller said retrying is pointless. */
export type ReconnectGiveUp = 'auth' | 'unopened' | 'stale';

/** `new WebSocket(url)`, or null when the constructor throws (a malformed URL, a blocked scheme). */
export function openSocket(url: string): WebSocket | null {
  try { return new WebSocket(url); } catch { return null; }
}

export interface ReconnectOptions {
  /** Open ONE connection, then report it through `opened()` / `closed()` (call `closed()` at once when no socket could be made). */
  connect: () => void;
  /** False when a retry can only fail the same way (signed out, switched workspace). Checked before every retry. */
  canRetry?: () => boolean;
  /** A retry was scheduled after `delayMs` — the moment a surface says "reconnecting". */
  onRetryScheduled?: (delayMs: number) => void;
  /** The reconnector stopped trying. */
  onGiveUp?: (reason: ReconnectGiveUp) => void;
  baseMs?: number;
  maxMs?: number;
  maxUnopenedAttempts?: number;
  stableOpenMs?: number;
}

export interface Reconnector {
  /** Make the first attempt and start watching visibility. */
  start(): void;
  /** The current attempt's socket opened. */
  opened(): void;
  /** The current attempt ended (pass the close code when there is one). Repeat calls are ignored. */
  closed(code?: number): void;
  /** No more attempts; drops the pending retry and the visibility listener. */
  stop(): void;
}

export function createReconnector(options: ReconnectOptions): Reconnector {
  const base = options.baseMs ?? RECONNECT_BASE_MS;
  const max = options.maxMs ?? RECONNECT_MAX_MS;
  const maxUnopened = options.maxUnopenedAttempts ?? MAX_UNOPENED_ATTEMPTS;
  const stableMs = options.stableOpenMs ?? STABLE_OPEN_MS;

  let started = false;
  let stopped = false;
  let refused = false;
  /** An attempt is outstanding (connecting or open) — `closed()` has not reported it yet. */
  let live = false;
  let openedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = base;
  let unopened = 0;

  const canRetry = () => !options.canRetry || options.canRetry();

  const attempt = () => {
    if (stopped) return;
    live = true;
    openedAt = null;
    options.connect();
  };

  const schedule = () => {
    if (stopped) return;
    if (!canRetry()) { options.onGiveUp?.('stale'); return; }
    if (unopened >= maxUnopened) { options.onGiveUp?.('unopened'); return; }
    const wait = delay;
    delay = backoffDelay(delay, base, max);
    options.onRetryScheduled?.(wait);
    timer = setTimeout(() => {
      timer = null;
      // A hidden tab waits for visibility rather than holding a socket nobody is looking at.
      if (isDocumentHidden()) return;
      attempt();
    }, wait);
  };

  const onVisibility = () => {
    if (stopped || refused || live || timer || isDocumentHidden() || !canRetry()) return;
    // Back in view with no socket (paused while hidden, or gave up after never opening):
    // one fresh round from the short wait.
    unopened = 0;
    delay = base;
    attempt();
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      attempt();
    },
    opened() {
      if (!stopped && live) openedAt = Date.now();
    },
    closed(code) {
      if (stopped || !live) return;
      live = false;
      const heldSince = openedAt;
      openedAt = null;
      if (code != null && AUTH_CLOSE_CODES.has(code)) {
        refused = true;
        options.onGiveUp?.('auth');
        return;
      }
      if (heldSince != null && Date.now() - heldSince >= stableMs) {
        unopened = 0;
        delay = base;
      } else if (heldSince == null) {
        unopened += 1;
      }
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
