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
  /** Aborted when administrative send permission is revoked or the outbox closes. */
  signal?: AbortSignal;
}

/** What a {@link Outbox.drainWith} request is handed alongside the pending items. */
export type OutboxDrainContext = Pick<OutboxSendContext, "idempotencyKey" | "ids" | "scope" | "signal">;

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
  /** Permanent refusal retained for export/repair; dead letters are never sent automatically. */
  deadLetter?: { reason: string; at: string };
  /**
   * Set at enqueue from the work classification. Durable user work is never
   * auto-evicted; best-effort telemetry may be dropped.
   */
  retention?: OutboxRetention;
}

/** Durable user work is retained. Best-effort telemetry may be dropped. */
export type OutboxRetention = "durable" | "best-effort";

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

export interface OutboxSendPermission {
  isAllowed(): boolean;
  subscribe(listener: (allowed: boolean) => void): () => void;
}

export interface OutboxRetryPolicy {
  /** First retry delay in ms. Default 1000. */
  baseMs?: number;
  /** Longest retry delay in ms. Default 5 minutes. */
  maxMs?: number;
  /** A durable refusal becomes a recoverable dead letter; best-effort items are dropped. */
  isPermanent?(error: unknown): boolean;
}

export interface OutboxDrop<K> {
  key: K;
  count: number;
  reason: "overflow" | "rejected" | "failed";
}

export interface OutboxStats {
  /** Entries retained locally, including dead letters but not entries in flight. */
  queued: number;
  inFlight: number;
  dropped: number;
  deadLetters: number;
}

export interface OutboxOptions<T, K> {
  send(key: K, items: T[], ctx: OutboxSendContext): Promise<unknown> | unknown;
  maxItems?: number;
  maxWaitMs?: number;
  coalesce?(items: T[]): T[];
  onError?(error: unknown, key: K): void;
  retry?: OutboxRetryPolicy;
  store?: OutboxStore<T, K>;
  /** Reachability only; this never grants administrative permission. */
  online?: OutboxOnlineSignal;
  /** Absolute gate for automatic, manual, final, probe, and drainWith sends. */
  sendPermission?: OutboxSendPermission;
  /** Best-effort queues evict above this bound; durable queues reject new work instead. */
  maxEntries?: number;
  /**
   * Classifies every enqueue that does not pass its own work kind.
   * `history`, `tickets`, `audits`, and `facts` are durable and never auto-evicted.
   * `telemetry` is best-effort and may drop.
   */
  work?: string;
  onDrop?(drop: OutboxDrop<K>): void;
  onDeadLetter?(key: K, entries: readonly OutboxEntry<T, K>[], error: unknown): void;
  onCapacity?(queued: number, maxEntries: number): void;
  onStoreError?(error: unknown): void;
  newId?(): string;
  scope?(): string | null;
}

export interface Outbox<T, K> {
  /**
   * Queue one item. Pass a work kind to classify the path: history, tickets, audits,
   * and facts are durable; telemetry is best-effort. Unclassified writes follow the
   * outbox mode. Use enqueueDurable before acknowledging durable user work.
   */
  enqueue(key: K, item: T, work?: string): string;
  /** Queue and resolve only after the store acknowledges the write. Always durable unless `work` is telemetry. */
  enqueueDurable(key: K, item: T, work?: string): Promise<string>;
  flush(key?: K, opts?: { final?: boolean }): Promise<void>;
  drainWith<R>(key: K, request: (pending: T[], ctx: OutboxDrainContext) => Promise<R>): Promise<R>;
  /** Explicitly return retained refusals to the send queue after repair. */
  retryDeadLetters(): Promise<void>;
  /** Dead-letter entries, copied. Does not delete or otherwise mutate the queue. */
  exportDeadLetters(): readonly OutboxEntry<T, K>[];
  /**
   * Move one dead letter back onto the durable queue. No-op unless `id` is that
   * entry's id — a missing, blank, or unknown id repairs nothing.
   */
  repairDeadLetter(id: string): Promise<boolean>;
  size(key?: K): number;
  stats(): OutboxStats;
  ready(): Promise<void>;
  close(): void;
}
