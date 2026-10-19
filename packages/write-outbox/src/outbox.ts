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
 *     (`retry.isPermanent`, default: a 4xx other than 401/408/409/425/429) is retained as
 *     a dead letter, not dropped. With a `store`, queued entries survive a restart and are
 *     replayed once the store has loaded. An injected {@link OutboxOnlineSignal} pauses
 *     automatic sends while the host is offline and replays every key the moment it comes back.
 *
 * SCOPED: with `scope` (the identity the host sends as — e.g. the signed-in tenant), each
 * entry remembers the scope it was queued under and is only ever sent under that scope.
 * Entries of another scope are PARKED — kept, not sent — until their scope is current
 * again (or the bound drops them); a write made in one workspace is never replayed into
 * another. Sealing a batch stamps the current scope on any unscoped entry in it.
 *
 * BOUNDED: at most `maxEntries` queued entries across all keys when the host sets one.
 * Best-effort telemetry may drop the oldest past that bound. Durable user work —
 * history, tickets, audits, facts, or a queue with `retry`/`store` — is never
 * auto-evicted; a further durable enqueue is refused (`outbox_capacity`) and reported
 * to `onCapacity`. Drops are counted in {@link Outbox.stats} and reported to `onDrop`.
 *
 * A {@link Outbox.drainWith} caller's own request is never best-effort — its failure
 * rejects to that caller (and, in durable mode, its pending items go back to the queue).
 *
 * Host-neutral: no Node builtins and no DOM globals. Storage, connectivity and ids are
 * injected; `crypto.randomUUID` is used for ids only when the host has it.
 */

import { classifyQueue } from "./classifyQueue.js";
import { exportDeadLetters as listDeadLetters, repairDeadLetter as repairOneDeadLetter } from "./deadLetter.js";
import { defaultId } from "./idempotency.js";
import {
  isPermanentHttpFailure,
  OUTBOX_MAX_ITEMS,
  OUTBOX_MAX_WAIT_MS,
  OUTBOX_RETRY_BASE_MS,
  OUTBOX_RETRY_MAX_MS,
} from "./policy.js";
import { bySeq, drainContext, sendable, sendContext, takeBatch, type Lane } from "./sealedBatch.js";
import type { Outbox, OutboxDrop, OutboxEntry, OutboxOptions, OutboxRetention, OutboxStore } from "./types.js";

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
  const retryPolicy = retry ?? {
    baseMs: OUTBOX_RETRY_BASE_MS,
    maxMs: OUTBOX_RETRY_MAX_MS,
    isPermanent: isPermanentHttpFailure,
  };
  const store = opts.store ?? null;
  const durable = Boolean(retry || store);
  const maxEntries = Math.max(maxItems, opts.maxEntries ?? Number.POSITIVE_INFINITY);
  const newId = opts.newId ?? defaultId;
  const lanes = new Map<K, Lane<T, K>>();
  const inFlightControllers = new Set<AbortController>();
  let lastSeq = 0;
  let dropped = 0;
  let closed = false;
  let storeFailure: unknown;

  const isOnline = (): boolean => opts.online?.isOnline() ?? true;
  const maySend = (): boolean => !closed && (opts.sendPermission?.isAllowed() ?? true);

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
          (error) => {
            storeFailure ??= error;
            opts.onStoreError?.(error);
          },
        )
    : Promise.resolve();
  let writes: Promise<void> = loaded;
  const persist = (op: (s: OutboxStore<T, K>) => Promise<void> | void): Promise<void> => {
    if (!store) return Promise.resolve();
    writes = writes.then(() => op(store)).catch((error) => {
      storeFailure ??= error;
      opts.onStoreError?.(error);
    });
    return writes;
  };

  const drop = (key: K, entries: OutboxEntry<T, K>[], reason: OutboxDrop<K>["reason"]): void => {
    if (entries.length === 0) return;
    dropped += entries.length;
    const ids = entries.map((e) => e.id);
    void persist((s) => s.remove(ids));
    opts.onDrop?.({ key, count: entries.length, reason });
  };

  const retentionOf = (entry: OutboxEntry<T, K>): OutboxRetention => {
    if (entry.retention) return entry.retention;
    return durable ? "durable" : "best-effort";
  };

  /**
   * Per-call work wins, then the queue's work, then the enqueue path / outbox mode.
   * A known queue name is authoritative: telemetry stays best-effort and user work
   * stays durable even when the constructor also set retry or a store.
   */
  const resolveRetention = (work: string | undefined, path: "enqueue" | "enqueueDurable"): OutboxRetention => {
    const classified = classifyQueue(work) ?? classifyQueue(opts.work);
    if (classified) return classified.retention;
    if (path === "enqueueDurable" || durable) return "durable";
    return "best-effort";
  };

  const totalQueued = (): number => {
    let total = 0;
    for (const l of lanes.values()) total += l.entries.length;
    return total;
  };

  const durableQueued = (): number => {
    let n = 0;
    for (const l of lanes.values()) for (const entry of l.entries) if (retentionOf(entry) === "durable") n += 1;
    return n;
  };

  /** Drop oldest best-effort entries until `limit`. Durable user work is never removed. */
  const evictBestEffortWhileOver = (limit: number): void => {
    let total = totalQueued();
    while (total > limit) {
      let oldestKey: K | undefined;
      let oldestLane: Lane<T, K> | undefined;
      let oldestIndex = -1;
      let oldestSeq = Number.POSITIVE_INFINITY;
      for (const [k, l] of lanes) {
        for (let i = 0; i < l.entries.length; i += 1) {
          const entry = l.entries[i]!;
          if (retentionOf(entry) !== "best-effort" || entry.seq >= oldestSeq) continue;
          oldestSeq = entry.seq;
          oldestKey = k;
          oldestLane = l;
          oldestIndex = i;
        }
      }
      if (!oldestLane || oldestIndex < 0) {
        if (total > maxEntries) opts.onCapacity?.(total, maxEntries);
        return;
      }
      drop(oldestKey as K, oldestLane.entries.splice(oldestIndex, 1), "overflow");
      total -= 1;
    }
  };

  const enforceBound = (): void => {
    evictBestEffortWhileOver(maxEntries);
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

  const scheduleRetry = (key: K, l: Lane<T, K>, force = false): void => {
    if ((!retry && !force) || !maySend() || l.retryTimer !== null) return;
    const policy = retry ?? retryPolicy;
    l.attempt += 1;
    const delay = Math.min(policy.maxMs, policy.baseMs * 2 ** (l.attempt - 1));
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    l.retryTimer = setTimeout(() => {
      l.retryTimer = null;
      void flushKey(key, { final: false, probe: true });
    }, jittered);
  };

  const armTimer = (key: K, l: Lane<T, K>): void => {
    if (l.timer !== null || maxWaitMs <= 0 || !maySend()) return;
    l.timer = setTimeout(() => {
      l.timer = null;
      void flushKey(key, { final: false, auto: true });
    }, maxWaitMs);
  };

  const requeue = (l: Lane<T, K>, entries: OutboxEntry<T, K>[]): void => {
    l.entries.unshift(...entries);
    l.entries.sort(bySeq);
  };

  const sendBatch = async (key: K, l: Lane<T, K>, batch: OutboxEntry<T, K>[], final: boolean): Promise<boolean> => {
    if (!maySend()) {
      requeue(l, batch);
      return false;
    }
    const items = batch.map((e) => e.item);
    const ctx = sendContext(batch);
    const ids = ctx.ids as string[];
    const controller = new AbortController();
    inFlightControllers.add(controller);
    l.inFlight += batch.length;
    try {
      await opts.send(key, opts.coalesce ? opts.coalesce(items) : items, { final, ...ctx, signal: controller.signal });
      l.inFlight -= batch.length;
      // A revoke aborts this signal. A sender that ignores it can still resolve; do not
      // acknowledge that completion, or the durable row is gone and will not be retried.
      if (controller.signal.aborted || !maySend()) {
        requeue(l, batch);
        return false;
      }
      l.attempt = 0;
      void persist((s) => s.remove(ids));
      return true;
    } catch (error) {
      l.inFlight -= batch.length;
      opts.onError?.(error, key);
      const settled = settleFailure(key, l, batch, error);
      return settled;
    } finally {
      inFlightControllers.delete(controller);
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
    if (!l || !maySend()) return Promise.resolve();
    const upTo = mode.probe ? Number.POSITIVE_INFINITY : lastSeq;
    if (mode.final) {
      const scope = currentScope();
      if (!isOnline() || scope === null) return Promise.resolve();
      clearTimer(l);
      const batches: OutboxEntry<T, K>[][] = [];
      for (let b = take(l, scope, upTo); b; b = take(l, scope, upTo)) batches.push(b);
      return Promise.all(batches.map((b) => sendBatch(key, l, b, true))).then(() => undefined);
    }
    const run = l.tail.then(async () => {
      await loaded;
      if (!maySend()) {
        clearTimer(l);
        clearRetry(l);
        return;
      }
      if (mode.auto && l.retryTimer !== null) return;
      if (mode.auto && !isOnline()) {
        scheduleRetry(key, l);
        return;
      }
      if (!mode.auto && l.retryTimer !== null) clearRetry(l);
      const scope = currentScope();
      if (scope === null) {
        scheduleRetry(key, l);
        return;
      }
      clearTimer(l);
      for (let batch = take(l, scope, upTo); batch; batch = take(l, scope, upTo)) {
        if (!(await sendBatch(key, l, batch, false))) return;
      }
      if (l.entries.some((entry) => !entry.deadLetter)) armTimer(key, l);
    });
    l.tail = run;
    return run;
  };

  const flushAll = (final: boolean): Promise<void> =>
    Promise.all([...lanes.keys()].map((k) => flushKey(k, { final }))).then(() => undefined);

  const unsubscribeOnline = opts.online?.subscribe((online) => {
    if (!online || !maySend()) return;
    for (const l of lanes.values()) {
      clearRetry(l);
      l.attempt = 0;
    }
    void flushAll(false);
  });
  const unsubscribePermission = opts.sendPermission?.subscribe((allowed) => {
    if (!allowed) {
      for (const l of lanes.values()) {
        clearTimer(l);
        clearRetry(l);
      }
      for (const controller of inFlightControllers) controller.abort();
      return;
    }
    for (const l of lanes.values()) l.attempt = 0;
    void flushAll(false);
  });

  // A stored backlog leaves as soon as it has loaded.
  if (store) {
    void loaded.then(() => {
      enforceBound();
      for (const [k, l] of lanes) if (l.entries.length > 0) void flushKey(k, { final: false, auto: true });
    });
  }

  /**
   * Permanent 4xx on durable user work becomes a dead letter. Transient failure is
   * retried. Best-effort telemetry may be dropped. Returns false when a retry was
   * scheduled (the caller should stop), true when the batch was fully settled.
   */
  const settleFailure = (key: K, l: Lane<T, K>, batch: OutboxEntry<T, K>[], error: unknown): boolean => {
    const permanent = retryPolicy.isPermanent(error);
    const dead: OutboxEntry<T, K>[] = [];
    const keep: OutboxEntry<T, K>[] = [];
    const discarded: OutboxEntry<T, K>[] = [];
    for (const entry of batch) {
      const userWork = retentionOf(entry) === "durable";
      if (permanent && userWork) dead.push(entry);
      else if (!permanent && (userWork || retry)) keep.push(entry);
      else discarded.push(entry);
    }
    if (dead.length) {
      const at = new Date().toISOString();
      const reason = error instanceof Error ? error.message : String(error);
      for (const entry of dead) {
        entry.deadLetter = { reason, at };
        entry.retention = "durable";
      }
      requeue(l, dead);
      void persist((s) => s.put(dead));
      opts.onDeadLetter?.(key, dead, error);
    }
    if (keep.length) {
      requeue(l, keep);
      scheduleRetry(key, l, !retry && keep.some((entry) => retentionOf(entry) === "durable"));
    }
    if (discarded.length) drop(key, discarded, permanent ? "rejected" : "failed");
    return keep.length === 0;
  };

  const enqueueEntry = (key: K, item: T, work: string | undefined, path: "enqueue" | "enqueueDurable"): { id: string; persisted: Promise<void> } => {
    const retention = resolveRetention(work, path);
    if (retention === "durable") {
      evictBestEffortWhileOver(Math.max(0, maxEntries - 1));
      if (durableQueued() >= maxEntries) {
        opts.onCapacity?.(durableQueued(), maxEntries);
        throw Object.assign(new Error("outbox_capacity"), { code: "OUTBOX_CAPACITY" });
      }
    }
    const l = lane(key);
    const scope = currentScope();
    const entry: OutboxEntry<T, K> = {
      id: newId(),
      key,
      item,
      seq: nextSeq(),
      retention,
      ...(scope ? { scope } : {}),
    };
    l.entries.push(entry);
    const persisted = persist((s) => s.put([entry]));
    if (retention === "best-effort") enforceBound();
    const unsealed = l.entries.reduce((n, e) => (e.batch || e.deadLetter ? n : n + 1), 0);
    if (unsealed >= maxItems) void flushKey(key, { final: false, auto: true });
    else armTimer(key, l);
    return { id: entry.id, persisted };
  };

  return {
    enqueue(key, item, work) {
      return enqueueEntry(key, item, work, "enqueue").id;
    },
    async enqueueDurable(key, item, work) {
      const enqueued = enqueueEntry(key, item, work, "enqueueDurable");
      await enqueued.persisted;
      if (storeFailure) throw storeFailure;
      return enqueued.id;
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
        if (!maySend()) throw Object.assign(new Error("platform_send_disabled"), { code: "PLATFORM_SEND_DISABLED" });
        clearTimer(l);
        const scope = currentScope();
        const taken: OutboxEntry<T, K>[] = [];
        if (scope !== null) {
          const parked: OutboxEntry<T, K>[] = [];
          for (const e of l.entries) (sendable(e, scope) ? taken : parked).push(e);
          l.entries = parked;
        }
        const items = taken.map((e) => e.item);
        const controller = new AbortController();
        inFlightControllers.add(controller);
        const ctx = { ...drainContext(taken, scope, newId), signal: controller.signal };
        const ids = ctx.ids as string[];
        l.inFlight += taken.length;
        try {
          if (!maySend()) throw Object.assign(new Error("platform_send_disabled"), { code: "PLATFORM_SEND_DISABLED" });
          const result = await request(opts.coalesce && items.length ? opts.coalesce(items) : items, ctx);
          l.inFlight -= taken.length;
          if (taken.length) void persist((s) => s.remove(ids));
          return result;
        } catch (error) {
          l.inFlight -= taken.length;
          settleFailure(key, l, taken, error);
          throw error;
        } finally {
          inFlightControllers.delete(controller);
        }
      });
      l.tail = run.catch(() => undefined);
      return run;
    },
    async retryDeadLetters() {
      const retained: OutboxEntry<T, K>[] = [];
      for (const l of lanes.values()) {
        for (const entry of l.entries) {
          if (!entry.deadLetter) continue;
          delete entry.deadLetter;
          retained.push(entry);
        }
      }
      if (retained.length) await persist((s) => s.put(retained));
      await flushAll(false);
    },
    exportDeadLetters() {
      const all: OutboxEntry<T, K>[] = [];
      for (const l of lanes.values()) all.push(...l.entries);
      return listDeadLetters(all);
    },
    async repairDeadLetter(id) {
      if (typeof id !== "string" || id.trim() === "") return false;
      let target: OutboxEntry<T, K> | undefined;
      for (const l of lanes.values()) {
        target = l.entries.find((entry) => entry.id === id && entry.deadLetter);
        if (target) break;
      }
      if (!target?.deadLetter) return false;
      const previousLetter = target.deadLetter;
      const previousBatch = target.batch;
      const repaired = repairOneDeadLetter([target], id);
      if (!repaired) return false;
      const failureBefore = storeFailure;
      await persist((s) => s.put([repaired]));
      if (storeFailure !== failureBefore) {
        repaired.deadLetter = previousLetter;
        if (previousBatch !== undefined) repaired.batch = previousBatch;
        else delete repaired.batch;
        throw storeFailure;
      }
      return true;
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
      let deadLetters = 0;
      for (const l of lanes.values()) {
        queued += l.entries.length;
        inFlight += l.inFlight;
        deadLetters += l.entries.filter((entry) => entry.deadLetter).length;
      }
      return { queued, inFlight, dropped, deadLetters };
    },
    async ready() {
      await loaded;
      await writes;
      if (storeFailure) throw storeFailure;
    },
    close() {
      closed = true;
      unsubscribeOnline?.();
      unsubscribePermission?.();
      for (const controller of inFlightControllers) controller.abort();
      for (const l of lanes.values()) {
        clearTimer(l);
        clearRetry(l);
      }
    },
  };
}
