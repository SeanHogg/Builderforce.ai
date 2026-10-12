/**
 * The write outbox — every fire-and-forget client write goes through ONE queue.
 *
 * Run steps, editor activity, portal activity, the visitor journey and QA capture each
 * used to hand-roll the same thing: an array, a size cap, an interval, an unload flush.
 * Five copies, five sets of edge cases, and none of them ordered — a flush fired while
 * the previous one was still in flight could land first.
 *
 * Here, items are queued per KEY (a chat, a project, a stream) and leave in batches:
 *   - when a key's queue reaches `maxItems`;
 *   - `maxWaitMs` after its first queued item, at the latest (0 = no timer);
 *   - on an explicit {@link Outbox.flush};
 *   - riding along with a caller's own request ({@link Outbox.drainWith}).
 *
 * ORDER: each key has at most ONE send in flight. The next batch for that key waits
 * for it, so batches arrive in the order their items were queued. Different keys are
 * independent. The one exception is a FINAL flush (page unload): the page is going
 * away, so it sends immediately rather than queueing behind a request that may never
 * finish.
 *
 * COALESCING: `coalesce` folds a batch before it is sent (adjacent duplicate signals
 * become one row), so buffering also shrinks what is written, not just how often.
 *
 * Best-effort by contract: a failed batch is reported to `onError` and dropped, exactly
 * as each copy dropped it. The work it describes already happened; only its record is
 * lost. A {@link Outbox.drainWith} caller's own request is NOT best-effort — its
 * failure rejects to that caller.
 */

export interface OutboxSendContext {
  /** The page / process is going away: use a transport that survives that
   *  (`keepalive`, `sendBeacon`). */
  final: boolean;
}

export interface OutboxOptions<T, K> {
  /** Send one batch for one key. A throw or rejection is reported, never rethrown. */
  send(key: K, items: T[], ctx: OutboxSendContext): Promise<unknown> | unknown;
  /** Items per key before the batch leaves without waiting. Default 25. */
  maxItems?: number;
  /** Longest an item waits for a ride, in ms. Default 5000; 0 disables the timer. */
  maxWaitMs?: number;
  /** Fold a batch before it is sent. Must preserve order. */
  coalesce?(items: T[]): T[];
  /** A dropped batch. Default: ignored. */
  onError?(error: unknown, key: K): void;
}

export interface Outbox<T, K> {
  /** Queue one item. */
  enqueue(key: K, item: T): void;
  /** Send `key`'s queue now — or every key's when omitted. Resolves once sent. */
  flush(key?: K, opts?: Partial<OutboxSendContext>): Promise<void>;
  /**
   * Run `request` in `key`'s order, handing it the queued items so they ride in the
   * same request. Waits for any batch already in flight for `key` first. The
   * request's result (or rejection) is returned to the caller.
   */
  drainWith<R>(key: K, request: (pending: T[]) => Promise<R>): Promise<R>;
  /** Items currently queued for `key` (or in total). */
  size(key?: K): number;
}

export const OUTBOX_MAX_ITEMS = 25;
export const OUTBOX_MAX_WAIT_MS = 5_000;

interface Lane<T> {
  items: T[];
  timer: ReturnType<typeof setTimeout> | null;
  /** The last send for this key — the next one starts after it settles. */
  tail: Promise<unknown>;
}

export function createOutbox<T, K = string>(opts: OutboxOptions<T, K>): Outbox<T, K> {
  const maxItems = opts.maxItems ?? OUTBOX_MAX_ITEMS;
  const maxWaitMs = opts.maxWaitMs ?? OUTBOX_MAX_WAIT_MS;
  const lanes = new Map<K, Lane<T>>();

  const lane = (key: K): Lane<T> => {
    let l = lanes.get(key);
    if (!l) {
      l = { items: [], timer: null, tail: Promise.resolve() };
      lanes.set(key, l);
    }
    return l;
  };

  /** Take a lane's queued items (coalesced) and cancel its timer. */
  const take = (l: Lane<T>): T[] => {
    if (l.timer !== null) clearTimeout(l.timer);
    l.timer = null;
    const items = l.items;
    l.items = [];
    if (items.length === 0) return items;
    return opts.coalesce ? opts.coalesce(items) : items;
  };

  const sendNow = async (key: K, items: T[], final: boolean): Promise<void> => {
    try {
      await opts.send(key, items, { final });
    } catch (error) {
      opts.onError?.(error, key);
    }
  };

  const flushKey = (key: K, final: boolean): Promise<void> => {
    const l = lanes.get(key);
    if (!l) return Promise.resolve();
    if (final) {
      const items = take(l);
      return items.length ? sendNow(key, items, true) : Promise.resolve();
    }
    // Taken when this lane's turn comes, so items queued while the previous batch was
    // in flight leave together in this one.
    const run = l.tail.then(() => {
      const items = take(l);
      return items.length ? sendNow(key, items, false) : undefined;
    });
    l.tail = run;
    return run;
  };

  return {
    enqueue(key, item) {
      const l = lane(key);
      l.items.push(item);
      if (l.items.length >= maxItems) {
        void flushKey(key, false);
      } else if (l.timer === null && maxWaitMs > 0) {
        l.timer = setTimeout(() => {
          l.timer = null;
          void flushKey(key, false);
        }, maxWaitMs);
      }
    },
    async flush(key, flushOpts) {
      const final = flushOpts?.final ?? false;
      const keys = key === undefined ? [...lanes.keys()] : [key];
      await Promise.all(keys.map((k) => flushKey(k, final)));
    },
    drainWith(key, request) {
      const l = lane(key);
      const run = l.tail.then(() => request(take(l)));
      // The lane continues after this request whether it succeeded or not.
      l.tail = run.catch(() => undefined);
      return run;
    },
    size(key) {
      if (key !== undefined) return lanes.get(key)?.items.length ?? 0;
      let n = 0;
      for (const l of lanes.values()) n += l.items.length;
      return n;
    },
  };
}
