import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox } from "./outbox.js";
import { createMemoryOutboxStore, createOnlineSignal } from "./stores.js";

type Sent = { key: string; items: number[]; final: boolean; idempotencyKey?: string };

/** A transport whose sends stay in flight until released, in the order they arrived. */
function heldTransport() {
  const sent: Sent[] = [];
  const pending: Array<() => void> = [];
  const send = (key: string, items: number[], ctx: { final: boolean; idempotencyKey: string }) =>
    new Promise<void>((resolve) => {
      sent.push({ key, items, final: ctx.final, idempotencyKey: ctx.idempotencyKey });
      pending.push(resolve);
    });
  const releaseAll = async () => {
    while (pending.length) {
      pending.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  /** Release sends one at a time until nothing is left in flight. */
  const settle = async () => {
    for (let i = 0; i < 100; i += 1) {
      await vi.advanceTimersByTimeAsync(0);
      if (pending.length === 0) return;
      pending.shift()!();
    }
  };
  return { sent, send, releaseAll, settle };
}

describe("createOutbox", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("batches items and sends them once the wait elapses", async () => {
    const sent: Sent[] = [];
    const box = createOutbox<number>({ maxWaitMs: 1000, send: (key, items, ctx) => { sent.push({ key, items, final: ctx.final }); } });
    box.enqueue("a", 1);
    box.enqueue("a", 2);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([{ key: "a", items: [1, 2], final: false }]);
  });

  it("sends at the size cap without waiting", async () => {
    const sent: Sent[] = [];
    const box = createOutbox<number>({ maxItems: 2, maxWaitMs: 60_000, send: (key, items, ctx) => { sent.push({ key, items, final: ctx.final }); } });
    box.enqueue("a", 1);
    box.enqueue("a", 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((s) => s.items)).toEqual([[1, 2]]);
  });

  it("keeps ONE send in flight per key, so batches land in queue order", async () => {
    const t = heldTransport();
    const box = createOutbox<number>({ maxItems: 2, maxWaitMs: 0, send: t.send });
    box.enqueue("a", 1);
    box.enqueue("a", 2); // batch 1 leaves, held in flight
    await vi.advanceTimersByTimeAsync(0);
    box.enqueue("a", 3);
    box.enqueue("a", 4); // batch 2 must wait for batch 1
    box.enqueue("a", 5);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sent.map((s) => s.items)).toEqual([[1, 2]]);
    await t.settle();
    // Items queued while batch 1 was in flight leave after it, in order, never more
    // than `maxItems` to a request.
    expect(t.sent.map((s) => s.items)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("keeps keys independent", async () => {
    const t = heldTransport();
    const box = createOutbox<number>({ maxItems: 1, maxWaitMs: 0, send: t.send });
    box.enqueue("a", 1);
    box.enqueue("b", 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sent.map((s) => s.key).sort()).toEqual(["a", "b"]);
  });

  it("coalesces a batch before sending it", async () => {
    const sent: number[][] = [];
    const box = createOutbox<number>({
      maxWaitMs: 0,
      coalesce: (items) => items.filter((n, i) => n !== items[i - 1]),
      send: (_key, items) => { sent.push(items); },
    });
    for (const n of [1, 1, 2, 2, 2, 3]) box.enqueue("a", n);
    await box.flush();
    expect(sent).toEqual([[1, 2, 3]]);
  });

  it("drainWith hands the queue to the caller's request, in order, and returns its result", async () => {
    const t = heldTransport();
    const box = createOutbox<number>({ maxItems: 2, maxWaitMs: 0, send: t.send });
    box.enqueue("a", 1);
    box.enqueue("a", 2); // in flight
    await vi.advanceTimersByTimeAsync(0);
    box.enqueue("a", 3);
    const seen: number[][] = [];
    const result = box.drainWith("a", async (pending) => { seen.push(pending); return "ok"; });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([]); // waits for the in-flight batch
    await t.releaseAll();
    await expect(result).resolves.toBe("ok");
    expect(seen).toEqual([[3]]);
    expect(box.size("a")).toBe(0);
  });

  it("rejects a failed drainWith to its caller and keeps the lane moving", async () => {
    const sent: number[][] = [];
    const box = createOutbox<number>({ maxWaitMs: 0, send: (_k, items) => { sent.push(items); } });
    await expect(box.drainWith("a", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    box.enqueue("a", 1);
    await box.flush("a");
    expect(sent).toEqual([[1]]);
  });

  it("reports and drops a failed batch, never throws", async () => {
    const onError = vi.fn();
    const box = createOutbox<number>({ maxWaitMs: 0, onError, send: () => { throw new Error("offline"); } });
    box.enqueue("a", 1);
    await expect(box.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "a");
    expect(box.size()).toBe(0);
  });

  it("a final flush sends at once, flagged final, without waiting on the lane", async () => {
    const t = heldTransport();
    const box = createOutbox<number>({ maxItems: 1, maxWaitMs: 0, send: t.send });
    box.enqueue("a", 1); // in flight, never released
    await vi.advanceTimersByTimeAsync(0);
    box.enqueue("a", 2); // queued behind it… but the page is closing
    void box.flush("a", { final: true });
    expect(t.sent.map((s) => [s.items, s.final])).toContainEqual([[2], true]);
  });

  it("returns each entry's idempotency key and sends the batch under its first entry's key", async () => {
    const sent: Array<{ items: number[]; key: string; ids: readonly string[] }> = [];
    let n = 0;
    const box = createOutbox<number>({
      maxWaitMs: 0,
      newId: () => `id-${++n}`,
      send: (_k, items, ctx) => { sent.push({ items, key: ctx.idempotencyKey, ids: ctx.ids }); },
    });
    expect(box.enqueue("a", 1)).toBe("id-1");
    expect(box.enqueue("a", 2)).toBe("id-2");
    await box.flush();
    expect(sent).toEqual([{ items: [1, 2], key: "id-1", ids: ["id-1", "id-2"] }]);
  });

  it("drops the oldest entries past maxEntries and counts them", async () => {
    const onDrop = vi.fn();
    const sent: number[][] = [];
    const box = createOutbox<number>({ maxEntries: 2, maxItems: 1, maxWaitMs: 0, onDrop, send: (_k, items) => { sent.push(items); } });
    box.enqueue("a", 1);
    box.enqueue("b", 2);
    box.enqueue("a", 3);
    expect(onDrop).toHaveBeenCalledWith({ key: "a", count: 1, reason: "overflow" });
    expect(box.stats()).toMatchObject({ queued: 2, dropped: 1 });
    await box.flush();
    expect(sent.flat().sort()).toEqual([2, 3]);
  });
});

describe("createOutbox — durable mode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const offline = () => Object.assign(new Error("fetch failed"), {});
  const refused = () => Object.assign(new Error("HTTP 400"), { status: 400 });

  it("keeps a failed batch and retries it with backoff under the SAME idempotency key", async () => {
    const keys: string[] = [];
    let fail = 2;
    const box = createOutbox<number>({
      maxWaitMs: 0,
      retry: { baseMs: 1000, maxMs: 8000 },
      send: (_k, _items, ctx) => {
        keys.push(ctx.idempotencyKey);
        if (fail-- > 0) throw offline();
      },
    });
    box.enqueue("a", 1);
    box.enqueue("a", 2);
    await box.flush();
    expect(keys).toHaveLength(1);
    expect(box.size("a")).toBe(2); // parked, not dropped
    box.enqueue("a", 3); // queued behind the sealed batch — must not join it
    await vi.advanceTimersByTimeAsync(1300); // first backoff (1s ±20%)
    expect(keys).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2500); // second backoff (2s ±20%)
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(new Set(keys.slice(0, 3)).size).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(box.size()).toBe(0);
    expect(box.stats().dropped).toBe(0);
  });

  it("drops and counts a batch the server refused", async () => {
    const onDrop = vi.fn();
    const box = createOutbox<number>({ maxWaitMs: 0, retry: {}, onDrop, send: () => { throw refused(); } });
    box.enqueue("a", 1);
    await box.flush();
    expect(onDrop).toHaveBeenCalledWith({ key: "a", count: 1, reason: "rejected" });
    expect(box.size()).toBe(0);
  });

  it("replays a stored backlog after a restart, sealed batches under their original key", async () => {
    const store = createMemoryOutboxStore<number, string>();
    const first = createOutbox<number>({ maxWaitMs: 0, retry: {}, store, send: () => { throw offline(); } });
    const minted = [first.enqueue("a", 1), first.enqueue("a", 2)];
    await first.flush(); // seals [1, 2] and parks it
    first.enqueue("a", 3);
    await first.ready();
    first.close();

    const sent: Array<{ items: number[]; key: string }> = [];
    const second = createOutbox<number>({
      maxWaitMs: 0,
      retry: {},
      store,
      send: (_k, items, ctx) => { sent.push({ items, key: ctx.idempotencyKey }); },
    });
    await second.ready();
    await vi.advanceTimersByTimeAsync(0);
    await second.flush();
    expect(sent).toEqual([
      { items: [1, 2], key: minted[0] },
      { items: [3], key: expect.any(String) },
    ]);
    await second.ready();
    expect(await store.load()).toEqual([]);
  });

  it("holds sends while offline and replays every key on reconnect", async () => {
    const online = createOnlineSignal(false);
    const sent: string[] = [];
    const box = createOutbox<number>({
      maxItems: 1,
      maxWaitMs: 0,
      retry: { baseMs: 60_000 },
      online,
      send: (key) => { sent.push(key); },
    });
    box.enqueue("a", 1);
    box.enqueue("b", 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);
    online.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.sort()).toEqual(["a", "b"]);
  });

  it("puts a failed drainWith's pending items back at the head", async () => {
    const sent: number[][] = [];
    const box = createOutbox<number>({ maxWaitMs: 0, retry: {}, send: (_k, items) => { sent.push(items); } });
    box.enqueue("a", 1);
    await expect(box.drainWith("a", async () => { throw offline(); })).rejects.toThrow("fetch failed");
    box.enqueue("a", 2);
    await box.flush("a");
    expect(sent).toEqual([[1, 2]]);
  });

  it("sends an entry only under the scope it was queued in, parking the rest", async () => {
    let tenant: string | null = "t1";
    const sent: Array<{ scope: string | null; items: number[] }> = [];
    const box = createOutbox<number>({
      maxWaitMs: 0,
      retry: { baseMs: 60_000 },
      scope: () => tenant,
      // The batch's own scope rides on the send context — the identity to send AS.
      send: (_k, items, ctx) => { sent.push({ scope: ctx.scope ?? null, items }); },
    });
    box.enqueue("a", 1);
    tenant = "t2";
    box.enqueue("a", 2);
    await box.flush();
    expect(sent).toEqual([{ scope: "t2", items: [2] }]);
    expect(box.size()).toBe(1); // t1's entry is parked, not replayed into t2
    tenant = null;
    box.enqueue("a", 3); // no identity yet: queued unscoped
    await box.flush();
    expect(sent).toHaveLength(1);
    tenant = "t1";
    await box.flush();
    expect(sent[1]).toEqual({ scope: "t1", items: [1, 3] });
  });
});

