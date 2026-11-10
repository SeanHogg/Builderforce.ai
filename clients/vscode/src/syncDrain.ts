/**
 * Drain a sync partition: one `coordinator.synchronize` pushes ONE batch — the server takes at
 * most 100 events per push (`api/src/application/sync/syncEnvelope.ts` `MAX_PUSH_EVENTS`; more is
 * a 400 `batch_too_large`), so a long queue needs many rounds. A long-offline history is tens of
 * thousands of imports: a fixed cap of 20 rounds a pass left it to a 5-minute heartbeat, ~44
 * passes for 88k events.
 *
 * So rounds run while there is work and the pass has budget:
 *   - TIME: a pass stops after `maxMs` and reports `more`, so the host schedules the next one
 *     right away instead of holding the lease (and the editor's attention) indefinitely;
 *   - RATE: every request spends from the tenant's limiter bucket, which the person's own tabs
 *     share (`api/src/presentation/middleware/rateLimitMiddleware.ts`, 300–3000 requests/minute
 *     by plan). The drain stops once the bucket's remaining share falls below `reserve` of its
 *     limit, and on a 429 it stops and reports the server's `Retry-After`;
 *   - PROGRESS: a round that moved nothing (events held as `dependency_pending`, dead letters)
 *     ends the pass — those wait for the next trigger or the heartbeat.
 * Only the first round of a drain pulls (a pass that continues one does not); the rest push only,
 * and one pull closes the drain — not two pulls per batch.
 */

/** The part of a coordinator's round summary the drain reads. */
export interface DrainRound {
  pushed: number;
  duplicates: number;
}

/** How long one pass may keep sending before it yields to the next. */
export const DRAIN_PASS_MS = 60_000;
/** The share of the tenant's request bucket a drain leaves for the person's own work. */
export const DRAIN_RATE_RESERVE = 0.5;
/** When the server rate-limited without saying how long: wait this long. */
const DEFAULT_RETRY_MS = 60_000;

/** The tenant's request budget as last reported (`SyncRateLimit`). */
export interface DrainRateLimit {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt?: string;
}

export interface DrainPorts {
  /** One `coordinator.synchronize(destination)`; `pull: false` pushes only. */
  round(options: { pull: boolean }): Promise<DrainRound | undefined>;
  /** Events still pending for the destination (an O(1) count in the store). */
  pending(): Promise<number>;
  /** The limiter's state from the last response, when the transport saw one. */
  rateLimit?(): DrainRateLimit | undefined;
  /** The host is shutting down: stop before the next round. Checked every round. */
  cancelled?(): boolean;
}

export interface DrainOptions {
  readonly maxMs?: number;
  readonly reserve?: number;
  readonly now?: () => number;
  /**
   * Pull on the first round (default). A pass that CONTINUES a drain the previous pass stopped
   * short of (budget, rate limit) skips it: that drain already pulled, and every request spends
   * from the bucket it is waiting on. The closing pull still reads back what was sent.
   */
  readonly pullFirst?: boolean;
  /**
   * When this drain last pulled (ms epoch; a continuing pass passes the previous result's). A
   * drain never goes longer than `DRAIN_PULL_EVERY_MS` without a pull, so a long queue still
   * hears the server's changes while it sends.
   */
  readonly lastPullAt?: number;
}

/** The shortest pause a rate-limited pass takes, so the next one starts with room for a burst. */
const MIN_RATE_PAUSE_MS = 10_000;
/** A drain pulls at least this often, however many continuing passes it spans. */
export const DRAIN_PULL_EVERY_MS = 5 * 60_000;

export interface DrainResult {
  readonly rounds: number;
  /** When this drain last pulled (pass it to a continuing pass). */
  readonly lastPullAt?: number;
  /** Work is left that this pass stopped short of (budget, rate limit): schedule the next pass. */
  readonly more: boolean;
  /** Do not start the next pass before this many ms (a 429, or a spent bucket until its reset). */
  readonly resumeAfterMs?: number;
}

/** A transport error that is the server's 429. */
function rateLimited(error: unknown): { retryAfterMs?: number } | undefined {
  if (!error || typeof error !== "object" || (error as { status?: unknown }).status !== 429) return undefined;
  const retry = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof retry === "number" ? { retryAfterMs: retry } : {};
}

/** Run rounds while there is work and budget (see the module comment). */
export async function drainSync(ports: DrainPorts, options: DrainOptions = {}): Promise<DrainResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.maxMs ?? DRAIN_PASS_MS);
  const reserve = options.reserve ?? DRAIN_RATE_RESERVE;
  const pullFirst = options.pullFirst ?? true;
  let rounds = 0;
  let pushedOnly = !pullFirst;
  let lastPull = options.lastPullAt;
  let before = await ports.pending();
  const result = (more: boolean, resumeAfterMs?: number): DrainResult => ({
    rounds, more,
    ...(lastPull !== undefined ? { lastPullAt: lastPull } : {}),
    ...(resumeAfterMs !== undefined ? { resumeAfterMs } : {}),
  });
  const stale = (): boolean => lastPull === undefined || now() - lastPull >= DRAIN_PULL_EVERY_MS;
  for (;;) {
    // Shutting down: the round in flight finished; start no other.
    if (ports.cancelled?.()) return result(false);
    let summary: DrainRound | undefined;
    // The first round pulls (conflicts surface before anything is sent); the rest push only —
    // unless the last pull is `DRAIN_PULL_EVERY_MS` old.
    const pull = rounds === 0 ? pullFirst || stale() : stale();
    try {
      summary = await ports.round({ pull });
      if (pull) lastPull = now();
    } catch (error) {
      const limited = rateLimited(error);
      if (!limited) throw error;
      return result(true, limited.retryAfterMs ?? DEFAULT_RETRY_MS);
    }
    rounds += 1;
    if (!summary) return result(false); // the lease is held elsewhere: that holder drains
    if (rounds > 1) pushedOnly = true;
    const after = await ports.pending();
    const progressed = summary.pushed + summary.duplicates > 0 || after < before;
    if (after === 0 || !progressed) {
      // One pull closes a drain that pushed without pulling: it reads back what it sent.
      if (pushedOnly) {
        await closingPull(ports);
        lastPull = now();
      }
      return result(false);
    }
    before = after;
    const spent = bucketSpent(ports.rateLimit?.(), reserve, now());
    if (spent !== undefined) return result(true, spent);
    if (now() >= deadline) return result(true);
  }
}

async function closingPull(ports: DrainPorts): Promise<void> {
  try {
    await ports.round({ pull: true });
  } catch (error) {
    if (!rateLimited(error)) throw error;
  }
}

/**
 * The bucket is down to its reserve: how long until it resets (or a minute, unsaid) — never less
 * than `MIN_RATE_PAUSE_MS`, so a sliding window that frees a request at a time does not turn the
 * drain into one push per pass.
 */
function bucketSpent(limit: DrainRateLimit | undefined, reserve: number, at: number): number | undefined {
  if (!limit || limit.remaining >= limit.limit * reserve) return undefined;
  const reset = limit.resetAt ? Date.parse(limit.resetAt) : NaN;
  return Number.isFinite(reset) ? Math.max(MIN_RATE_PAUSE_MS, reset - at) : DEFAULT_RETRY_MS;
}
