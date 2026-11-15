import { describe, expect, it } from "vitest";
import {
  assembleBounded, estimatedBytes, isOverBudget, isTransferPart, PART_BYTES, PartsReceiver, postBounded, RESULT_OVER_BUDGET, sendParts,
  splitBounded, TRANSFER_BUDGET_BYTES, TRANSFER_SENDER_SOURCE, type TransferPart,
} from "./boundedTransfer";

const item = (i: number, pad = 0) => ({ ref: `src:r::f${i}.ts`, pad: "x".repeat(pad) });

function thrown(run: () => unknown): unknown {
  try { run(); } catch (error) { return error; }
  return undefined;
}

describe("bounded worker transfer", () => {
  it("round-trips every array, in order, through parts no larger than the cap (estimated)", () => {
    const a = Array.from({ length: 1_000 }, (_, i) => item(i, 50));
    const b = ["x", "y"];
    const posted: TransferPart[] = [];
    const total = sendParts((p) => posted.push(p), [["a", a], ["b", b], ["empty", []]], { partBytes: 4_096 });
    expect(total).toBe(a.reduce((n, x) => n + estimatedBytes(x), 0) + estimatedBytes("x") + estimatedBytes("y"));
    expect(posted.length).toBeGreaterThan(10);
    for (const part of posted) {
      expect(isTransferPart(part)).toBe(true);
      expect(part.items.reduce((n: number, x) => n + estimatedBytes(x), 0)).toBeLessThanOrEqual(4_096);
    }
    expect(posted.some((p) => p.key === "empty")).toBe(false); // nothing to send, nothing sent
    const receiver = new PartsReceiver();
    for (const part of structuredClone(posted)) expect(receiver.accept(part)).toBe(true);
    expect(receiver.accept({ type: "done" })).toBe(false);
    expect(receiver.take("a")).toEqual(a);
    expect(receiver.take("b")).toEqual(b);
    expect(receiver.take("a")).toEqual([]); // taken once
  });

  it("estimates twice the JSON length, so a string cloned as UTF-16 never passes its estimate", () => {
    expect(estimatedBytes("é漢")).toBe(2 * JSON.stringify("é漢").length);
    expect(estimatedBytes(undefined)).toBe(0);
  });

  it("an item larger than one part is refused — never sent alone as a giant message", () => {
    const posted: TransferPart[] = [];
    const error = thrown(() => sendParts((p) => posted.push(p), [["a", [item(0, 10), item(1, 500), item(2, 10)]]], { partBytes: 200 }));
    expect(isOverBudget(error)).toBe(true);
    expect((error as Error).message).toMatch(/one item of a passed the part size/);
    expect(posted.flatMap((p) => p.items)).toHaveLength(0); // the batch before it was not flushed either
  });

  it("stops with a stable code once the running estimate passes the budget — nothing past it is sent", () => {
    const a = Array.from({ length: 100 }, (_, i) => item(i, 100));
    const posted: TransferPart[] = [];
    const error = thrown(() => sendParts((p) => posted.push(p), [["a", a]], { partBytes: 1_000, budgetBytes: 4_000 }));
    expect(isOverBudget(error)).toBe(true);
    expect((error as { code: string }).code).toBe(RESULT_OVER_BUDGET);
    const sent = posted.flatMap((p) => p.items).reduce((n: number, x) => n + estimatedBytes(x), 0);
    expect(sent).toBeLessThanOrEqual(4_000);
    // the completing message's own size counts too
    expect(isOverBudget(thrown(() => sendParts(() => undefined, [], { budgetBytes: 10 }, 11)))).toBe(true);
  });

  it("recognises the over-budget code with any prefix, and in a message whose code was lost", () => {
    expect(isOverBudget({ code: `l3_${RESULT_OVER_BUDGET}` })).toBe(true);
    expect(isOverBudget(new Error(`l3_${RESULT_OVER_BUDGET}: too big`))).toBe(true);
    expect(isOverBudget(new Error("Worker terminated"))).toBe(false);
  });

  it("the sender's source is self-contained: an eval'd worker runs the same sender", () => {
    const send = (0, eval)(TRANSFER_SENDER_SOURCE) as (post: (p: TransferPart) => void, arrays: Array<[string, unknown[]]>, part: number, budget: number, spent: number) => number;
    const viaSource: TransferPart[] = [];
    const viaModule: TransferPart[] = [];
    const arrays: Array<[string, unknown[]]> = [["a", Array.from({ length: 50 }, (_, i) => item(i, 20))]];
    expect(send((p) => viaSource.push(p), arrays, 500, 1e9, 0)).toBe(sendParts((p) => viaModule.push(p), arrays, { partBytes: 500, budgetBytes: 1e9 }));
    expect(viaSource).toEqual(viaModule);
    expect(isOverBudget(thrown(() => send(() => undefined, arrays, 500, 100, 0)))).toBe(true);
  });

  it("splits a value along its array paths (with `*` over array elements) and reassembles it; absent paths are left alone", () => {
    const value = { id: "v", list: [1, 2, 3], nested: { deep: ["a"] }, groups: [{ name: "g0", paths: ["p", "q"] }, { name: "g1", paths: [] }] };
    const paths = ["list", "nested.deep", "groups.*.paths", "missing.array"];
    const { head, arrays } = splitBounded(value, paths);
    expect(head).toEqual({ id: "v", list: [], nested: { deep: [] }, groups: [{ name: "g0", paths: [] }, { name: "g1", paths: [] }] });
    expect(arrays.map(([key]) => key)).toEqual(["list", "nested.deep", "groups.0.paths", "groups.1.paths"]);
    expect(value.list).toEqual([1, 2, 3]); // the input is never changed
    const posted: TransferPart[] = [];
    const sentHead = postBounded((p) => posted.push(p), value, paths);
    const receiver = new PartsReceiver();
    for (const p of structuredClone(posted)) receiver.accept(p);
    expect(assembleBounded(structuredClone(sentHead), receiver, paths)).toEqual(value);
  });

  it("the defaults: 8 MB parts, a 256 MB whole — far below the ~1.2 GB message that killed the host", () => {
    expect(PART_BYTES).toBe(8 * 1024 * 1024);
    expect(TRANSFER_BUDGET_BYTES).toBe(256 * 1024 * 1024);
  });
});
