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

export interface OutboxSendContext {
  /** The host is going away: use a transport that survives that (`keepalive`, `sendBeacon`). */
  final: boolean;
  /** Stable for this batch across every retry and restart — send it as `Idempotency-Key`. */
  idempotencyKey: string;
  /** Each entry's own id, in queue order, BEFORE coalescing. Aligned with `items` only
   *  when the outbox has no `coalesce`. */
  ids: readonly string[];
  /** The scope this batch was sealed under (see {@link OutboxOptions.scope}); send it AS
   *  that identity, or fail the send — never as another. Absent when unscoped. */
  scope?: string;
}

/** What a {@link Outbox.drainWith} request is handed alongside the pending items. */
export type OutboxDrainContext = Pick<OutboxSendContext, "idempotencyKey" | "ids" | "scope">;

/** One queued item, as a {@link OutboxStore} persists it. JSON-serialisable when `T` and `K` are. */
export interface OutboxEntry<T, K> {
  /** The entry's idempotency key — unique, minted when it was queued. */
  id: string;
  key: K;
  item: T;
  /** Monotonic queue position; FIFO order across restarts. */
  seq: number;
  /** Set once the entry has been sealed into a batch: that batch's idempotency key. */
  batch?: string;
  /** The scope (e.g. tenant id) it was queued under; absent = sendable under any scope. */
  scope?: string;
}

/**
 * Where queued entries live between being queued and being acknowledged. Calls are
 * serialised by the outbox (never two at once, always in order), and `put`/`remove`
 * never run before `load` has settled.
 */
export interface OutboxStore<T, K> {
  load(): Promise<OutboxEntry<T, K>[]> | OutboxEntry<T, K>[];
  /** Insert or replace by `id`. */
  put(entries: OutboxEntry<T, K>[]): Promise<void> | void;
  remove(ids: string[]): Promise<void> | void;
}

/** The host's connectivity. `subscribe` returns an unsubscribe. */
export interface OutboxOnlineSignal {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface OutboxRetryPolicy {
  /** First retry delay in ms. Default 1000. */
  baseMs?: number;
  /** Longest retry delay in ms. Default 5 minutes. */
  maxMs?: number;
  /** A failure retrying cannot fix: the batch is dropped and counted. */
  isPermanent?(error: unknown): boolean;
}

export interface OutboxDrop<K> {
  key: K;
  count: number;
  /** `overflow` = past `maxEntries`; `rejected` = a permanent failure in durable mode;
   *  `failed` = any failure in best-effort mode. */
  reason: "overflow" | "rejected" | "failed";
}

export interface OutboxStats {
  /** Entries waiting (not in flight). */
  queued: number;
  /** Entries in a request right now. */
  inFlight: number;
  /** Entries dropped since this outbox was created. */
  dropped: number;
}

export interface OutboxOptions<T, K> {
  /** Send one batch for one key. A throw or rejection is reported, never rethrown. */
  send(key: K, items: T[], ctx: OutboxSendContext): Promise<unknown> | unknown;
  /** Items per key before the batch leaves without waiting; also the most a batch carries. Default 25. */
  maxItems?: number;
  /** Longest an item waits for a ride, in ms. Default 5000; 0 disables the timer. */
  maxWaitMs?: number;
  /** Fold a batch before it is sent. Must preserve order and be deterministic. */
  coalesce?(items: T[]): T[];
  /** A failed batch (best-effort: dropped; durable: retried unless permanent). */
  onError?(error: unknown, key: K): void;
  /** Durable mode: retry failed batches with backoff instead of dropping them. */
  retry?: OutboxRetryPolicy;
  /** Persist queued entries (default: none — the queue lives and dies with the process). */
  store?: OutboxStore<T, K>;
  /** The host's connectivity (default: always online). */
  online?: OutboxOnlineSignal;
  /** Queued entries across all keys before the oldest are dropped. Default 1000 with a
   *  `retry` or `store`, unbounded otherwise; never below `maxItems`. */
  maxEntries?: number;
  /** Entries were dropped (counted in {@link Outbox.stats}). */
  onDrop?(drop: OutboxDrop<K>): void;
  /** The store failed to load / write. Default: ignored. */
  onStoreError?(error: unknown): void;
  /** Mint an entry id. Default `crypto.randomUUID()` where available. */
  newId?(): string;
  /**
   * The scope the host sends as right now (e.g. the signed-in tenant id). Entries are only
   * sent under the scope they were queued under; others are parked. `null` = no identity:
   * nothing is sent (a probe is kept scheduled in durable mode) and new entries are queued
   * unscoped. Omitted = no scoping.
   */
  scope?(): string | null;
}

export interface Outbox<T, K> {
  /** Queue one item; returns its idempotency key. */
  enqueue(key: K, item: T): string;
  /** Send `key`'s queue now — or every key's when omitted. Resolves once sent (or parked
   *  for retry). Overrides a pending backoff; a final flush skips the per-key order. */
  flush(key?: K, opts?: { final?: boolean }): Promise<void>;
  /**
   * Run `request` in `key`'s order, handing it the queued items so they ride in the same
   * request. Waits for any batch already in flight for `key` first. The request's result
   * (or rejection) is returned to the caller.
   */
  drainWith<R>(key: K, request: (pending: T[], ctx: OutboxDrainContext) => Promise<R>): Promise<R>;
  /** Entries currently queued for `key` (or in total), not counting those in flight. */
  size(key?: K): number;
  stats(): OutboxStats;
  /** Resolves once the store has loaded (immediately without a store). */
  ready(): Promise<void>;
  /** Stop timers and the online subscription. Queued entries stay in the store. */
  close(): void;
}

export const OUTBOX_MAX_ITEMS = 25;
export const OUTBOX_MAX_WAIT_MS = 5_000;
export const OUTBOX_MAX_ENTRIES = 1_000;
export const OUTBOX_RETRY_BASE_MS = 1_000;
export const OUTBOX_RETRY_MAX_MS = 5 * 60_000;

/**
 * The default {@link OutboxRetryPolicy.isPermanent}: the server read the request and
 * refused it, so repeating it verbatim changes nothing. 401 (credential may be renewed),
 * 408, 409 (a concurrent duplicate), 425 and 429 are worth another try; so is any failure
 * without a numeric `status` (the request never got an answer).
 */
export function isPermanentHttpFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return false;
  return status >= 400 && status < 500 && ![401, 408, 409, 425, 429].includes(status);
}

interface Lane<T, K> {
  entries: OutboxEntry<T, K>[];
  timer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  inFlight: number;
  /** The last send for this key — the next one starts after it settles. */
  tail: Promise<unknown>;
}

let fallbackCounter = 0;
function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  fallbackCounter += 1;
  return `ob-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const bySeq = (a: { seq: number }, b: { seq: number }): number => a.seq - b.seq;

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

  /** May `e` be sent under `scope`? Unscoped entries go under any scope. */
  const sendable = (e: OutboxEntry<T, K>, scope: string | undefined): boolean =>
    scope === undefined || e.scope === undefined || e.scope === scope;

  /**
   * Take the next batch of `scope`'s entries off a lane (first in, first out), sealing it
   * if it is not sealed yet. Entries of another scope stay where they are, parked. Only
   * entries queued up to `upTo` (a `seq` watermark) are taken: a flush sends what was
   * queued when it was ASKED for, and anything queued later waits for its own trigger —
   * or rides along with a {@link Outbox.drainWith}.
   */
  const takeBatch = (l: Lane<T, K>, scope: string | undefined, upTo: number): OutboxEntry<T, K>[] | null => {
    const due = (e: OutboxEntry<T, K>): boolean => e.seq <= upTo && sendable(e, scope);
    const start = l.entries.findIndex(due);
    if (start < 0) return null;
    const head = l.entries[start]!;
    let n = 0;
    const at = (i: number) => l.entries[start + i];
    if (head.batch) {
      while (at(n) && at(n)!.batch === head.batch) n += 1;
    } else {
      while (at(n) && n < maxItems && !at(n)!.batch && due(at(n)!)) n += 1;
    }
    const taken = l.entries.splice(start, n);
    if (!head.batch) {
      for (const e of taken) {
        e.batch = head.id;
        if (scope !== undefined) e.scope = scope;
      }
      persist((s) => s.put(taken));
    }
    return taken;
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
    const ids = batch.map((e) => e.id);
    l.inFlight += batch.length;
    try {
      await opts.send(key, opts.coalesce ? opts.coalesce(items) : items, {
        final,
        idempotencyKey: batch[0]!.batch ?? batch[0]!.id,
        ids,
        ...(batch[0]!.scope !== undefined ? { scope: batch[0]!.scope } : {}),
      });
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
      for (let b = takeBatch(l, scope, upTo); b; b = takeBatch(l, scope, upTo)) batches.push(b);
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
      for (let batch = takeBatch(l, scope, upTo); batch; batch = takeBatch(l, scope, upTo)) {
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
        const ids = taken.map((e) => e.id);
        l.inFlight += taken.length;
        try {
          const result = await request(opts.coalesce && items.length ? opts.coalesce(items) : items, {
            idempotencyKey: taken[0]?.batch ?? taken[0]?.id ?? newId(),
            ids,
            ...(scope ? { scope } : {}),
          });
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
