/** Phase 2 of the run delta (PRD 41 §6): pending → final revision, the hold, failure never leaves a card pending; the L3 queue. */

import { describe, expect, it, vi } from "vitest";
import type { RunDelta } from "@builderforce/run-delta";
import { pendingL3Tasks, queueL3Task, registerL3Runner, takeL3Task } from "../../knowledge/l3Tasks";
import type { PreparedDelta } from "../preparedPorts";
import type { StoredRunDelta } from "../runDeltaRecords";
import { blockingNow, failedTier, runL3Phase, waitsForL3 } from "./l3Phase";

const delta = (over: Partial<RunDelta>): RunDelta => ({ digest: "d", blocking: [], dimensions: [], ...over } as unknown as RunDelta);
const stored = (d: RunDelta): StoredRunDelta => ({
  value: { runId: "r", repository: "repo", changeSetId: "changeset:r:k", chatId: 1, mode: "autonomous", delta: d, computedMs: 10 },
  local: { kind: "local", runId: "r", chatId: 1, root: "/repo", repo: "/repo" },
} as unknown as StoredRunDelta);
const prepared = { input: { runId: "r" } } as unknown as PreparedDelta;
const hold = () => ({ begin: vi.fn(), block: vi.fn(() => true), unmeasured: vi.fn(), settled: vi.fn() });

describe("runL3Phase", () => {
  it("recomputes with the analyzers' results, revises the record with the new digest, re-posts, and gives the hold the final codes", async () => {
    const h = hold();
    const revised: StoredRunDelta[] = [];
    const posted: StoredRunDelta[] = [];
    const compute = vi.fn(async (p: PreparedDelta) => delta({ digest: "final", blocking: p.options?.analyzers === "run" ? ["secret-leak"] : [] }));
    await runL3Phase({ root: "/repo", prepared, stored: stored(delta({ digest: "phase1", blocking: ["analyzer-pending:gitleaks"] })), hold: h }, {
      analyze: async () => ({ before: [], after: [] }), compute, revise: async (s) => { revised.push(s); return true; }, repost: (s) => posted.push(s), onError: () => undefined,
      today: () => "2026-11-10",
    }, new AbortController().signal);
    expect(compute.mock.calls[0]![0].options).toEqual({ analyzers: "run", asOf: "2026-11-10" });
    expect(revised[0]!.value.delta.digest).toBe("final");
    expect(posted).toHaveLength(1);
    expect(h.block).toHaveBeenCalledWith(["secret-leak"]);
    expect(h.settled).toHaveBeenCalledTimes(1);
  });

  it("a failed analyzer pass still lands a final delta (every tool failed), and the hold fails closed", async () => {
    const h = hold();
    const computed: PreparedDelta[] = [];
    await runL3Phase({ root: "/repo", prepared, stored: stored(delta({})), hold: h }, {
      analyze: async () => { throw new Error("boom"); },
      compute: async (p) => { computed.push(p); return delta({ digest: "final" }); },
      revise: async () => true, repost: () => undefined, onError: () => undefined,
    }, new AbortController().signal);
    expect(computed[0]!.analyzers!.after.every((r) => r.status === "failed" && r.reason === "analyzer-threw")).toBe(true);
    expect(h.unmeasured).toHaveBeenCalled();
    expect(h.settled).toHaveBeenCalled();
  });

  it("phase-1 codes: an analyzer still measuring waits; the others hold now", () => {
    expect(blockingNow(["guard-removed", "analyzer-pending:gitleaks"])).toEqual(["guard-removed"]);
    expect(waitsForL3(delta({ blocking: ["analyzer-pending:gitleaks"] }))).toBe(true);
    expect(failedTier("timeout").after.length).toBeGreaterThan(failedTier("timeout").before.length);
  });
});

describe("the L3 task queue (the indexer's L3 gate)", () => {
  it("runs at once when no indexer holds the repository, else waits for that root's gate", async () => {
    const ran: string[] = [];
    queueL3Task({ root: "/elsewhere", run: async () => { ran.push("now"); } });
    expect(ran).toEqual(["now"]);
    const stop = registerL3Runner(() => ["/ws"]);
    queueL3Task({ root: "/ws/repo", run: async () => { ran.push("gated"); } });
    expect(ran).toEqual(["now"]);
    expect(pendingL3Tasks()).toBe(1);
    expect(takeL3Task("/other")).toBeUndefined();
    const task = takeL3Task("/ws")!;
    await task.run(new AbortController().signal);
    expect(ran).toEqual(["now", "gated"]);
    queueL3Task({ root: "/ws/repo", run: async () => { ran.push("released"); } });
    stop(); // the last indexer stopped: nothing is lost
    await Promise.resolve();
    expect(ran).toContain("released");
    expect(pendingL3Tasks()).toBe(0);
  });
});
