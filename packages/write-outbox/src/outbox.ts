/**
 * The write outbox — every client write that leaves in the background goes through ONE queue.
 *
 * Run steps, editor activity, portal activity, the visitor journey, QA capture and client
 * error reports each used to hand-roll the same thing: an array, a size cap, an interval,
 * an unload flush. Here, items are queued per KEY (a chat, a project, a stream) and leave
 * in batches:
 *   - when a key's queue reaches `maxItems` (a batch never carries more than that);
 *   - `maxWaitMs` after its first queued item, at the latest (0 = no timer);
 *   - on an explicit {@link Outbox.flush};
 *   - riding along with a caller's own request ({@link Outbox.drainWith}).
 *
 * ORDER: each key has at most ONE send in flight. The next batch for that key waits for
 * it, so batches arrive in the order their items were queued (FIFO per key). Different
 * keys are independent. The one exception is a FINAL flush (page unload, extension
 * deactivate): the host is going away, so it sends immediately rather than queueing
 * behind a request that may never finish.
 *
 * COALESCING: `coalesce` folds a batch before it is sent (adjacent duplicate signals
 * become one row), so buffering also shrinks what is written, not just how often.
 *
 * IDEMPOTENCY: every entry gets an id when it is queued. A batch is SEALED the first time
 * it is taken — its entries are tagged with the batch's key (the first entry's id) and,
 * with a durable store, that tag is persisted — so a retry, even after a restart, re-sends
 * exactly the same entries under exactly the same key. Send `ctx.idempotencyKey` as the
 * `Idempotency-Key` header and the server answers a replay with the original response.
 *
 * TWO MODES, ONE QUEUE:
 *   - best-effort (default, no `retry`): a failed batch is reported to `onError` and
 *     dropped. The work it describes already happened; only its record is lost.
 *   - durable (`retry` set, usually with a `store`): a failed batch goes back to the head
 *     of its key and is retried with exponential backoff; a batch the server REFUSED
 *     (`retry.isPermanent`, default: a 4xx other than 401/408/409/425/429) is dropped and
 *     counted. With a `store`, queued entries survive a restart and are replayed once the
 *     store has loaded. An injected {@link OutboxOnlineSignal} pauses automatic sends while
 *     the host is offline and replays every key the moment it comes back.
 *
 * SCOPED: with `scope` (the identity the host sends as — e.g. the signed-in tenant), each
 * entry remembers the scope it was queued under and is only ever sent under that scope.
 * Entries of another scope are PARKED — kept, not sent — until their scope is current
 * again (or the bound drops them); a write made in one workspace is never replayed into
 * another. Sealing a batch stamps the current scope on any unscoped entry in it.
 *
 * BOUNDED: at most `maxEntries` queued entries across all keys (default 1000 in durable
 * mode); past that the OLDEST are dropped, counted in {@link Outbox.stats} and reported
 * to `onDrop`.
 *
 * A {@link Outbox.drainWith} caller's own request is never best-effort — its failure
 * rejects to that caller (and, in durable mode, its pending items go back to the queue).
 *
 * Host-neutral: no Node builtins and no DOM globals. Storage, connectivity and ids are
 * injected; `crypto.randomUUID` is used for ids only when the host has it.
 */

import { defaultId } from "./idempotency.js";
import {
  isPermanentHttpFailure,
  OUTBOX_MAX_ENTRIES,
  OUTBOX_MAX_ITEMS,
  OUTBOX_MAX_WAIT_MS,
  OUTBOX_RETRY_BASE_MS,
  OUTBOX_RETRY_MAX_MS,
} from "./policy.js";
import { bySeq, drainContext, sendable, sendContext, takeBatch, type Lane } from "./sealedBatch.js";
import type { Outbox, OutboxDrop, OutboxEntry, OutboxOptions, OutboxStore } from "./types.js";

export function createOutbox<T, K = string>(opts: OutboxOptions<T, K>): Outbox<T, K> {
  const maxItems = Math.max(1, opts.maxItems ?? OUTBOX_MAX_ITEMS);
  const maxWaitMs = opts.maxWaitMs ?? OUTBOX_MAX_WAIT_MS;
  const retry = opts.retry
    ? {
        baseMs: opts.retry.baseMs ?? OUTBOX_RETRY_BASE_MS,
        maxMs: opts.retry.maxMs ?? OUTBOX_RETRY_MAX_MS,
        isPermanent: opts.retry.isPermanent ?? isPermanentHttpFailure,
      }
    : null;
  const store = opts.store ?? null;
  // The bound protects a queue that can GROW (durable mode holds failures); a best-effort
  // queue empties itself at `maxItems`, so it stays unbounded unless asked.
  const maxEntries = Math.max(
    maxItems,
    opts.maxEntries ?? (retry || store ? OUTBOX_MAX_ENTRIES : Number.POSITIVE_INFINITY),
  );
  const newId = opts.newId ?? defaultId;
  const lanes = new Map<K, Lane<T, K>>();
  let lastSeq = 0;
  let dropped = 0;
  let closed = false;

  const isOnline = (): boolean => opts.online?.isOnline() ?? true;

  const lane = (key: K): Lane<T, K> => {
    let l = lanes.get(key);
    if (!l) {
      l = { entries: [], timer: null, retryTimer: null, attempt: 0, inFlight: 0, tail: Promise.resolve() };
      lanes.set(key, l);
    }
    return l;
  };

  const nextSeq = (): number => {
    lastSeq = Math.max(lastSeq + 1, Date.now() * 1000);
    return lastSeq;
  };

  // ── Store: load once, then every write in order, never before the load settled ──
  const loaded: Promise<void> = store
    ? Promise.resolve()
        .then(() => store.load())
        .then(
          (entries) => {
            for (const e of entries) {
              lane(e.key).entries.push(e);
              lastSeq = Math.max(lastSeq, e.seq);
            }
            for (const l of lanes.values()) l.entries.sort(bySeq);
          },
          (error) => opts.onStoreError?.(error),
        )
    : Promise.resolve();
  let writes: Promise<void> = loaded;
  const persist = (op: (s: OutboxStore<T, K>) => Promise<void> | void): void => {
    if (!store) return;
    writes = writes.then(() => op(store)).catch((error) => opts.onStoreError?.(error));
  };

  const drop = (key: K, entries: OutboxEntry<T, K>[], reason: OutboxDrop<K>["reason"]): void => {
    if (entries.length === 0) return;
    dropped += entries.length;
    const ids = entries.map((e) => e.id);
    persist((s) => s.remove(ids));
    opts.onDrop?.({ key, count: entries.length, reason });
  };

  /** Drop the globally oldest queued entries until the bound holds. */
  const enforceBound = (): void => {
    let total = 0;
    for (const l of lanes.values()) total += l.entries.length;
    while (total > maxEntries) {
      let oldestKey: K | undefined;
      let oldest: Lane<T, K> | undefined;
      for (const [k, l] of lanes) {
        const head = l.entries[0];
        if (head && (!oldest || head.seq < oldest.entries[0]!.seq)) {
          oldest = l;
          oldestKey = k;
        }
      }
      if (!oldest) return;
      drop(oldestKey as K, oldest.entries.splice(0, 1), "overflow");
      total -= 1;
    }
  };

  /** The scope sends go out under now; `undefined` = the outbox is not scoped. */
  const currentScope = (): string | null | undefined => (opts.scope ? opts.scope() : undefined);

  /** Take (and, the first time, seal and persist) the lane's next batch — see `./sealedBatch.ts`. */
  const take = (l: Lane<T, K>, scope: string | undefined, upTo: number): OutboxEntry<T, K>[] | null => {
    const next = takeBatch(l, scope, upTo, maxItems);
    if (!next) return null;
    if (next.sealed) persist((s) => s.put(next.batch));
    return next.batch;
  };

  const clearTimer = (l: Lane<T, K>): void => {
    if (l.timer !== null) clearTimeout(l.timer);
    l.timer = null;
  };

  const clearRetry = (l: Lane<T, K>): void => {
    if (l.retryTimer !== null) clearTimeout(l.retryTimer);
    l.retryTimer = null;
  };

  const scheduleRetry = (key: K, l: Lane<T, K>): void => {
    if (!retry || closed || l.retryTimer !== null) return;
    l.attempt += 1;
    const delay = Math.min(retry.maxMs, retry.baseMs * 2 ** (l.attempt - 1));
    // ±20% jitter so every client that lost the same outage does not return in step.
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    l.retryTimer = setTimeout(() => {
      l.retryTimer = null;
      void flushKey(key, { final: false, probe: true });
    }, jittered);
  };

  /** Start the lane's max-wait timer if it has none. */
  const armTimer = (key: K, l: Lane<T, K>): void => {
    if (l.timer !== null || maxWaitMs <= 0) return;
    l.timer = setTimeout(() => {
      l.timer = null;
      void flushKey(key, { final: false, auto: true });
    }, maxWaitMs);
  };

  const requeue = (l: Lane<T, K>, entries: OutboxEntry<T, K>[]): void => {
    l.entries.unshift(...entries);
    l.entries.sort(bySeq);
  };

  /** Send one batch. `true` = the lane may continue; `false` = it is parked for retry. */
  const sendBatch = async (key: K, l: Lane<T, K>, batch: OutboxEntry<T, K>[], final: boolean): Promise<boolean> => {
    const items = batch.map((e) => e.item);
    const ctx = sendContext(batch);
    const ids = ctx.ids as string[];
    l.inFlight += batch.length;
    try {
      await opts.send(key, opts.coalesce ? opts.coalesce(items) : items, { final, ...ctx });
      l.inFlight -= batch.length;
      l.attempt = 0;
      persist((s) => s.remove(ids));
      return true;
    } catch (error) {
      l.inFlight -= batch.length;
      opts.onError?.(error, key);
      if (retry && !retry.isPermanent(error)) {
        requeue(l, batch);
        scheduleRetry(key, l);
        return false;
      }
      drop(key, batch, retry ? "rejected" : "failed");
      return true;
    }
  };

  /**
   * Send a lane. `auto` = an enqueue cap or wait timer asked (respects backoff and
   * connectivity); `probe` = the retry timer fired (sends even when the host says
   * offline, so a missed "back online" can never strand the queue); neither = an
   * explicit flush (overrides backoff).
   */
  const flushKey = (key: K, mode: { final: boolean; auto?: boolean; probe?: boolean }): Promise<void> => {
    const l = lanes.get(key);
    if (!l) return Promise.resolve();
    // What this flush covers: everything queued by now. A probe (retry) covers whatever
    // is queued when it runs — it is the lane's catch-all.
    const upTo = mode.probe ? Number.POSITIVE_INFINITY : lastSeq;
    if (mode.final) {
      const scope = currentScope();
      if (!isOnline() || scope === null) return Promise.resolve();
      clearTimer(l);
      // Every batch starts NOW — the host may not live to see a second round trip.
      const batches: OutboxEntry<T, K>[][] = [];
      for (let b = take(l, scope, upTo); b; b = take(l, scope, upTo)) batches.push(b);
      return Promise.all(batches.map((b) => sendBatch(key, l, b, true))).then(() => undefined);
    }
    const run = l.tail.then(async () => {
      await loaded;
      if (mode.auto && l.retryTimer !== null) return;
      if (mode.auto && !isOnline()) {
        // Offline: hold the queue, but keep one probe scheduled so it cannot strand.
        scheduleRetry(key, l);
        return;
      }
      if (!mode.auto && l.retryTimer !== null) {
        // An explicit flush (or the probe itself) supersedes the pending backoff.
        clearRetry(l);
      }
      const scope = currentScope();
      if (scope === null) {
        // No identity to send as yet: hold, and look again later.
        scheduleRetry(key, l);
        return;
      }
      clearTimer(l);
      for (let batch = take(l, scope, upTo); batch; batch = take(l, scope, upTo)) {
        if (!(await sendBatch(key, l, batch, false))) return;
      }
      // Entries queued while this flush was sending wait for their own ride.
      if (l.entries.length > 0) armTimer(key, l);
    });
    l.tail = run;
    return run;
  };

  const flushAll = (final: boolean): Promise<void> =>
    Promise.all([...lanes.keys()].map((k) => flushKey(k, { final }))).then(() => undefined);

  const unsubscribe = opts.online?.subscribe((online) => {
    if (!online || closed) return;
    for (const l of lanes.values()) {
      clearRetry(l);
      l.attempt = 0;
    }
    void flushAll(false);
  });

  // A stored backlog leaves as soon as it has loaded.
  if (store) {
    void loaded.then(() => {
      enforceBound();
      for (const [k, l] of lanes) if (l.entries.length > 0) void flushKey(k, { final: false, auto: true });
    });
  }

  return {
    enqueue(key, item) {
      const l = lane(key);
      const scope = currentScope();
      const entry: OutboxEntry<T, K> = { id: newId(), key, item, seq: nextSeq(), ...(scope ? { scope } : {}) };
      l.entries.push(entry);
      persist((s) => s.put([entry]));
      enforceBound();
      const unsealed = l.entries.reduce((n, e) => (e.batch ? n : n + 1), 0);
      if (unsealed >= maxItems) {
        void flushKey(key, { final: false, auto: true });
      } else {
        armTimer(key, l);
      }
      return entry.id;
    },
    async flush(key, flushOpts) {
      const final = flushOpts?.final ?? false;
      if (key === undefined) return flushAll(final);
      return flushKey(key, { final });
    },
    drainWith(key, request) {
      const l = lane(key);
      const run = l.tail.then(async () => {
        await loaded;
        clearTimer(l);
        const scope = currentScope();
        // Only this scope's entries ride along; another scope's stay parked.
        const taken: OutboxEntry<T, K>[] = [];
        if (scope !== null) {
          const parked: OutboxEntry<T, K>[] = [];
          for (const e of l.entries) (sendable(e, scope) ? taken : parked).push(e);
          l.entries = parked;
        }
        const items = taken.map((e) => e.item);
        const ctx = drainContext(taken, scope, newId);
        const ids = ctx.ids as string[];
        l.inFlight += taken.length;
        try {
          const result = await request(opts.coalesce && items.length ? opts.coalesce(items) : items, ctx);
          l.inFlight -= taken.length;
          if (taken.length) persist((s) => s.remove(ids));
          return result;
        } catch (error) {
          l.inFlight -= taken.length;
          if (retry) requeue(l, taken);
          else drop(key, taken, "failed");
          throw error;
        }
      });
      // The lane continues after this request whether it succeeded or not.
      l.tail = run.catch(() => undefined);
      return run;
    },
    size(key) {
      if (key !== undefined) return lanes.get(key)?.entries.length ?? 0;
      let n = 0;
      for (const l of lanes.values()) n += l.entries.length;
      return n;
    },
    stats() {
      let queued = 0;
      let inFlight = 0;
      for (const l of lanes.values()) {
        queued += l.entries.length;
        inFlight += l.inFlight;
      }
      return { queued, inFlight, dropped };
    },
    ready: () => loaded.then(() => writes),
    close() {
      closed = true;
      unsubscribe?.();
      for (const l of lanes.values()) {
        clearTimer(l);
        clearRetry(l);
      }
    },
  };
}
