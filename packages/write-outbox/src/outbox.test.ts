import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox } from "./outbox.js";

type Sent = { key: string; items: number[]; final: boolean };

/** A transport whose sends stay in flight until released, in the order they arrived. */
function heldTransport() {
  const sent: Sent[] = [];
  const pending: Array<() => void> = [];
  const send = (key: string, items: number[], ctx: { final: boolean }) =>
    new Promise<void>((resolve) => {
      sent.push({ key, items, final: ctx.final });
      pending.push(resolve);
    });
  const releaseAll = async () => {
    while (pending.length) {
      pending.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { sent, send, releaseAll };
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
    await t.releaseAll();
    // `flush` resolves once its batch is sent, so release that send while it waits.
    const flushed = box.flush("a");
    await vi.advanceTimersByTimeAsync(0);
    await t.releaseAll();
    await flushed;
    // Items queued while batch 1 was in flight leave together, after it.
    expect(t.sent.map((s) => s.items)).toEqual([[1, 2], [3, 4, 5]]);
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
});
