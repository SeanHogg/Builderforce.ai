/**
 * The write outbox's public contract — the options a host passes, what a send is handed,
 * and what a {@link OutboxStore} persists. Behaviour lives in `./outbox.ts`; batch sealing
 * and the idempotency key in `./sealedBatch.ts` and `./idempotency.ts`.
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
