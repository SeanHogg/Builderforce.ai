import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { currentRequestScope, deferPastResponse } from '../../application/shared/requestScope';
import { cacheL2Kv } from './readThroughCache';

/**
 * A write buffer for approximate hit counters, held in memory and flushed to KV.
 *
 * WHY: a counter bumped inline (`downloads = downloads + 1` on a public GET) is a
 * Postgres write per view — it wakes the autosuspended Neon compute and spends WAL on
 * a number nobody needs to the unit. Deltas accumulate here instead and ONE sweep
 * applies them per kind in a single statement (see `application/counters/hitCounters`).
 *
 * Contract:
 *  - A bump only adds to a per-isolate Map (`kind|key` → { n, t }); no KV traffic.
 *  - The Map is flushed at most every {@link FLUSH_INTERVAL_MS} (on the bump that crosses
 *    the interval, or by a deferred tail timer so the last hits of a burst are not
 *    stranded). Each (kind, key) is written ONCE to a key THIS isolate owns —
 *    `ctr:<kind>|<key>|<isolateId>|<flushSeq>` — with the count in KV metadata `{ n, t }`.
 *    Nobody ever re-reads or overwrites a key, so there is no read-modify-write to race
 *    across isolates or against the drain, and KV's 1-write/s/key limit cannot bite.
 *  - The drain `list`s the prefix (metadata comes back with the listing: no `get`s),
 *    sums per (kind, key), applies the sums, and only THEN deletes the listed keys. A
 *    failed apply leaves the keys for the next tick (nothing lost); a failed delete after
 *    a successful apply re-applies that delta once next tick (a slight over-count on a
 *    display counter, accepted over ever losing a hit).
 *  - A hit still in an isolate's Map when the isolate is evicted is lost. These are
 *    display counters, not ledgers — never route a counter that gates billing, quota or
 *    money (including campaign conversions) through here.
 *
 * KV WRITE QUOTA. Buffer writes go through the SAME {@link cacheL2Kv} gate as the
 * read-through cache: with `CACHE_L2_KV=false` (set to protect Workers KV Free's
 * 1,000 writes/day) nothing is buffered and {@link bufferCounter} returns false, so
 * the caller writes the hit straight to the database. A `put` that FAILS falls back
 * to the caller's direct database write instead of re-queueing in memory — a
 * re-queued delta would just retry the same exhausted quota and then die with the
 * isolate. The drain still lists/deletes the raw namespace so keys flushed before
 * the dial was turned are applied, not stranded.
 *
 * Reads do NOT include pending deltas: a displayed count lags by the flush interval plus
 * the sweep cadence, which is invisible against a counter shown rounded or compared in
 * order of magnitude.
 */
const PREFIX = 'ctr:';
const STATE_TTL_SECONDS = 7 * 24 * 60 * 60;
const FLUSH_INTERVAL_MS = 10_000;
/** Distinct keys that force an early flush, so the Map stays bounded. */
const MAX_PENDING_KEYS = 500;
/** One KV list page; the drain is a single list plus at most this many deletes. */
const DRAIN_LIMIT = 100;

export interface CounterDelta {
  kind: string;
  key: string;
  /** Pending increments. */
  n: number;
  /** Epoch-ms of the latest hit — for `last_used_at` style columns. */
  t: number;
}

/** A summed delta plus the KV keys that made it up — delete them once it is applied. */
export interface DrainedCounter extends CounterDelta {
  names: string[];
}

export interface DrainedPage {
  counters: DrainedCounter[];
  /** Keys that could not be parsed — deleted by the caller so they cannot clog the page. */
  strayNames: string[];
  /** False when more keys remain than one page returned. */
  complete: boolean;
}

export interface CounterKv {
  AUTH_CACHE_KV?: KVNamespace;
  /** The L2-off dial shared with the read-through cache (see {@link cacheL2Kv}). */
  CACHE_L2_KV?: string;
}

/** Applies deltas straight to the database — the path taken when a KV write fails. */
export type CounterFallback = (deltas: CounterDelta[]) => Promise<void>;

// Minted on first use, never at import: Workers reject random values in global scope
// (deploy fails with code 10021). The first flush always runs inside a handler.
let isolateIdValue: string | undefined;
const isolateId = (): string => (isolateIdValue ??= crypto.randomUUID());
let flushSeq = 0;
let lastFlushAt = 0;
let tailScheduled = false;
const pending = new Map<string, { kind: string; key: string; n: number; t: number }>();

const mapKey = (kind: string, key: string): string => `${kind}|${key}`;
const kvName = (kind: string, key: string, seq: number): string =>
  `${PREFIX}${kind}|${encodeURIComponent(key)}|${isolateId()}|${seq}`;

function parseKvName(name: string): { kind: string; key: string } | null {
  if (!name.startsWith(PREFIX)) return null;
  const parts = name.slice(PREFIX.length).split('|');
  if (parts.length !== 4) return null;
  try {
    return { kind: parts[0]!, key: decodeURIComponent(parts[1]!) };
  } catch {
    return null;
  }
}

function parseMeta(meta: unknown): { n: number; t: number } | null {
  const v = meta as { n?: unknown; t?: unknown } | null | undefined;
  return v && typeof v.n === 'number' && typeof v.t === 'number' ? { n: v.n, t: v.t } : null;
}

/**
 * Write every pending delta once, each to its own key. A failed write is handed to
 * `fallback` (the direct database write) rather than re-queued in memory; without a
 * fallback it is re-queued as before, so nothing is dropped.
 */
export async function flushCounterBuffer(env: CounterKv, fallback?: CounterFallback): Promise<void> {
  const kv = cacheL2Kv(env);
  lastFlushAt = Date.now();
  if (pending.size === 0) return;
  const batch = [...pending.values()];
  pending.clear();
  if (!kv) {
    // KV writes were turned off after these were buffered: apply them directly.
    await applyFallback(batch, fallback);
    return;
  }
  const seq = ++flushSeq;
  const results = await Promise.allSettled(batch.map((d) =>
    kv.put(kvName(d.kind, d.key, seq), String(d.n), { expirationTtl: STATE_TTL_SECONDS, metadata: { n: d.n, t: d.t } })));
  const failed: CounterDelta[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') return;
    failed.push(batch[i]!);
    reportCaughtError(r.reason, { source: 'infrastructure/cache/counterBuffer.ts', operation: 'flushCounterBuffer', level: 'warning' });
  });
  if (failed.length > 0) await applyFallback(failed, fallback);
}

async function applyFallback(deltas: CounterDelta[], fallback: CounterFallback | undefined): Promise<void> {
  if (fallback) {
    await fallback(deltas);
    return;
  }
  for (const d of deltas) {
    const cur = pending.get(mapKey(d.kind, d.key));
    pending.set(mapKey(d.kind, d.key), { ...d, n: d.n + (cur?.n ?? 0), t: Math.max(d.t, cur?.t ?? 0) });
  }
}

/** Make sure the tail of a burst is flushed even if no further hit arrives. Without an
 *  invocation to attach the timer to it could be cancelled with the response, so it is
 *  only treated as scheduled when the runtime accepted it; the next bump's interval check
 *  still flushes either way. */
function scheduleTail(env: CounterKv, fallback?: CounterFallback): void {
  if (tailScheduled || !currentRequestScope()?.waitUntil) return;
  const wait = Math.max(0, lastFlushAt + FLUSH_INTERVAL_MS - Date.now());
  const task = new Promise<void>((resolve) => setTimeout(resolve, wait))
    .then(() => { tailScheduled = false; return flushCounterBuffer(env, fallback); })
    .catch((error) => {
      tailScheduled = false;
      reportCaughtError(error, { source: 'infrastructure/cache/counterBuffer.ts', operation: 'scheduleTail', level: 'warning' });
    });
  tailScheduled = deferPastResponse(task);
}

/** Add `n` to the isolate's pending delta. Returns false when KV writes are unavailable
 *  (namespace unbound, or `CACHE_L2_KV` off) so the caller can apply the write directly
 *  instead of dropping it. `fallback` is that same direct write, used for any delta
 *  whose KV `put` fails at flush time. */
export async function bufferCounter(
  env: CounterKv,
  kind: string,
  key: string,
  n: number,
  atMs: number,
  fallback?: CounterFallback,
): Promise<boolean> {
  if (!cacheL2Kv(env)) return false;
  const k = mapKey(kind, key);
  const cur = pending.get(k);
  pending.set(k, { kind, key, n: (cur?.n ?? 0) + n, t: Math.max(cur?.t ?? 0, atMs) });
  try {
    if (Date.now() - lastFlushAt >= FLUSH_INTERVAL_MS || pending.size >= MAX_PENDING_KEYS) await flushCounterBuffer(env, fallback);
    else scheduleTail(env, fallback);
  } catch (error) {
    reportCaughtError(error, { source: 'infrastructure/cache/counterBuffer.ts', operation: 'bufferCounter', level: 'warning' });
  }
  return true;
}

/**
 * List one page of flushed counters and sum them per (kind, key). Nothing is deleted
 * here: the caller applies the sums and then calls {@link ackCounters} for the ones that
 * landed.
 */
export async function drainCounters(env: CounterKv, limit = DRAIN_LIMIT): Promise<DrainedPage> {
  const kv = env.AUTH_CACHE_KV;
  const empty: DrainedPage = { counters: [], strayNames: [], complete: true };
  if (!kv) return empty;
  try {
    const listed = await kv.list<unknown>({ prefix: PREFIX, limit });
    const sums = new Map<string, DrainedCounter>();
    const strayNames: string[] = [];
    for (const { name, metadata } of listed.keys) {
      const id = parseKvName(name);
      const m = parseMeta(metadata);
      if (!id || !m) { strayNames.push(name); continue; }
      const k = mapKey(id.kind, id.key);
      const cur = sums.get(k);
      if (cur) { cur.n += m.n; cur.t = Math.max(cur.t, m.t); cur.names.push(name); }
      else sums.set(k, { ...id, n: m.n, t: m.t, names: [name] });
    }
    return { counters: [...sums.values()], strayNames, complete: listed.list_complete };
  } catch (error) {
    reportCaughtError(error, { source: 'infrastructure/cache/counterBuffer.ts', operation: 'drainCounters', level: 'warning' });
    return empty;
  }
}

/** Delete applied (or unparseable) counter keys. A failed delete is reported, not thrown. */
export async function ackCounters(env: CounterKv, names: readonly string[]): Promise<void> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv || names.length === 0) return;
  const results = await Promise.allSettled(names.map((n) => kv.delete(n)));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) reportCaughtError(failed.reason, { source: 'infrastructure/cache/counterBuffer.ts', operation: 'ackCounters', level: 'warning' });
}

/** Test seam: forget this isolate's in-memory state. */
export function resetCounterBufferForTests(): void {
  pending.clear();
  flushSeq = 0;
  lastFlushAt = 0;
  tailScheduled = false;
}
