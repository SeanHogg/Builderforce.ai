/**
 * The ONE window-sized result cap (§6.10) and the read-coverage binding over
 * `RunState.reads.served` — what every dispatched call goes through.
 */
import { describe, expect, it } from "vitest";
import { toolOutputCap, windowedCap } from "@builderforce/tool-output-policy";
import { capToolResult, coveredReadAnswer, recordServedRead, resultCapFor } from "../../src/policy/tools/index.js";
import { policyCtx } from "../support/policyContext.js";

describe("resultCapFor", () => {
  it("is the table cap when the transport knows no window", () => {
    expect(resultCapFor("search_code", {}, "m")).toBe(toolOutputCap("search_code"));
    expect(resultCapFor("search_code", { window: () => undefined }, "m")).toBe(toolOutputCap("search_code"));
    expect(resultCapFor("search_code", { window: () => 200_000 }, undefined)).toBe(toolOutputCap("search_code"));
  });

  it("sizes the cap to the serving model's window", () => {
    expect(resultCapFor("read_file", { window: () => 200_000 }, "m")).toBe(windowedCap("read_file", toolOutputCap("read_file"), 200_000));
    expect(resultCapFor("search_code", { window: () => 8_000 }, "m")).toBe(windowedCap("search_code", toolOutputCap("search_code"), 8_000));
  });
});

describe("capToolResult", () => {
  it("returns a result that fits as-is", () => {
    const small = { ok: true, matches: ["a"] };
    expect(capToolResult("search_code", small, 6_000)).toBe(small);
  });

  it("cuts a result over the cap to fit it", () => {
    const big = { ok: true, output: "x".repeat(50_000) };
    const capped = capToolResult("search_code", big, 6_000);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(6_000);
  });
});

describe("read coverage over RunState.reads", () => {
  const read = { id: "r1", name: "read_file", args: { path: "f.ts" } };
  const served = { ok: true, content: "1\n2\n3\n4", totalLines: 4 };

  it("stubs an exact repeat while its row is in the transcript, replays it once compacted away", () => {
    const ctx = policyCtx();
    recordServedRead(ctx, read, served, false);
    expect(Object.keys(ctx.state.reads.served)).toHaveLength(1);
    // The serving row is still above: a stub, no disk.
    const live = { ...ctx, messages: [{ role: "tool" as const, toolCallId: "r1", content: JSON.stringify(served) }] };
    expect(String((coveredReadAnswer(live, { ...read, id: "r2" })?.data as { note?: string }).note)).toContain("Duplicate read_file");
    // Compaction dropped it: the served copy is replayed.
    const replay = coveredReadAnswer(ctx, { ...read, id: "r3" })?.data as { content?: string; note?: string };
    expect(replay.content).toBe("1\n2\n3\n4");
    expect(replay.note).toContain("Replayed");
  });

  it("a write to the file forgets its coverage, in the guard and in the state", () => {
    const ctx = policyCtx();
    recordServedRead(ctx, read, served, false);
    recordServedRead(ctx, { id: "w1", name: "write_file", args: { path: "f.ts", content: "x" } }, { ok: true }, false);
    expect(ctx.state.reads.served).toEqual({});
    expect(coveredReadAnswer(ctx, { ...read, id: "r4" })).toBeUndefined();
  });

  it("a resumed state keeps the coverage a continuous run holds", () => {
    const first = policyCtx();
    recordServedRead(first, read, served, false);
    const resumed = policyCtx();
    resumed.state.reads = JSON.parse(JSON.stringify(first.state.reads));
    expect(coveredReadAnswer(resumed, { ...read, id: "r5" })).toBeDefined();
  });

  it("never records a failed read", () => {
    const ctx = policyCtx();
    recordServedRead(ctx, read, { ok: false, error: "missing" }, false);
    expect(ctx.state.reads.served).toEqual({});
  });
});
