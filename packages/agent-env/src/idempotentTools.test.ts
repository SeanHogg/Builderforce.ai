import { describe, expect, it, vi } from "vitest";
import type { HumanChannel, PlatformTools } from "@builderforce/agent-run";
import {
  catalogToolEffects,
  createIdempotentTools,
  createMemoryToolResultLedger,
  idempotencyKeyString,
  idempotentPlatformTools,
  type IdempotencyKey,
  type RecordedToolResult,
} from "./idempotentTools.js";

const RUN = "run-1";
const key = (step: number, toolCallId: string): IdempotencyKey => ({ runId: RUN, step, toolCallId });
const noHuman: HumanChannel = { ask: async () => { throw new Error("no person should be asked"); } };

/** A counter tool: every invocation is one side effect. */
function counter() {
  let count = 0;
  const invoke = vi.fn(async (): Promise<RecordedToolResult> => ({ data: { ok: true, count: ++count } }));
  return { invoke, count: () => count };
}

describe("idempotencyKeyString", () => {
  it("is the core contract's `${runId}:${step}:${toolCallId}`", () => {
    expect(idempotencyKeyString(key(3, "call_a"))).toBe("run-1:3:call_a");
  });
});

describe("replay", () => {
  it("a recorded mutating call is answered from the ledger and never invoked again", async () => {
    const ledger = createMemoryToolResultLedger();
    const fixture = counter();
    const first = createIdempotentTools({ ledger, effects: catalogToolEffects(), human: noHuman });
    expect(await first.call(key(1, "c1"), "env.run", fixture.invoke)).toEqual({ data: { ok: true, count: 1 } });
    await first.endStep(1);

    // A resumed runtime: a new gate over the same ledger.
    const resumed = createIdempotentTools({ ledger, effects: catalogToolEffects(), human: noHuman });
    expect(await resumed.call(key(1, "c1"), "env.run", fixture.invoke)).toEqual({ data: { ok: true, count: 1 }, replayed: true });
    expect(fixture.count()).toBe(1);
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
  });

  it("a read is never keyed: it runs every time and touches no ledger", async () => {
    const ledger = createMemoryToolResultLedger();
    const tools = createIdempotentTools({ ledger, effects: catalogToolEffects(), human: noHuman });
    const fixture = counter();
    await tools.call(key(1, "r1"), "env.fs.read", fixture.invoke);
    await tools.call(key(1, "r1"), "env.fs.read", fixture.invoke);
    await tools.endStep(1);
    expect(fixture.count()).toBe(2);
    expect(ledger.writes).toEqual({ writeAhead: 0, recordStep: 0 });
  });

  it("an own env.* call written ahead but unrecorded is re-invoked WITH its key (the tool dedupes on it)", async () => {
    const ledger = createMemoryToolResultLedger();
    await ledger.writeAhead(idempotencyKeyString(key(2, "w1")), "env.fs.write");
    const tools = createIdempotentTools({ ledger, effects: catalogToolEffects(), human: noHuman });
    const invoke = vi.fn(async (k: IdempotencyKey) => ({ data: { ok: true, key: idempotencyKeyString(k) } }));
    expect(await tools.call(key(2, "w1"), "env.fs.write", invoke)).toEqual({ data: { ok: true, key: "run-1:2:w1" } });
    expect(invoke).toHaveBeenCalledWith(key(2, "w1"));
  });

  it("a tool failure records nothing, so the written-ahead key still reads as may-have-run", async () => {
    const ledger = createMemoryToolResultLedger();
    const tools = createIdempotentTools({ ledger, effects: catalogToolEffects(), human: noHuman });
    await expect(tools.call(key(1, "c1"), "env.run", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await tools.endStep(1);
    expect(ledger.writes.recordStep).toBe(0);
    expect((await ledger.get(["run-1:1:c1"])).get("run-1:1:c1")).toEqual({ state: "pending", tool: "env.run" });
  });
});

describe("batching per step", () => {
  it("a step's results are written in ONE ledger write, whatever the number of calls", async () => {
    const ledger = createMemoryToolResultLedger();
    const tools = createIdempotentTools({ ledger, effects: catalogToolEffects(), human: noHuman });
    const fixture = counter();
    const recordStep = vi.spyOn(ledger, "recordStep");
    for (const id of ["a", "b", "c"]) await tools.call(key(1, id), "env.run", fixture.invoke);
    expect(recordStep).not.toHaveBeenCalled();
    await tools.endStep(1);
    await tools.call(key(2, "d"), "env.fs.write", fixture.invoke);
    await tools.endStep(2);
    await tools.endStep(3); // nothing ran: nothing is written

    expect(recordStep).toHaveBeenCalledTimes(2);
    expect(recordStep.mock.calls[0]![0]).toBe(1);
    expect(recordStep.mock.calls[0]![1].map((r) => r.key)).toEqual(["run-1:1:a", "run-1:1:b", "run-1:1:c"]);
    expect(recordStep.mock.calls[1]![1].map((r) => r.key)).toEqual(["run-1:2:d"]);
  });

  it("the PlatformTools adapter keys each call by (run, step, call id) and writes at turnEnded", async () => {
    const ledger = createMemoryToolResultLedger();
    const fixture = counter();
    const platform = {
      selection: { query: "", limit: 5, required: new Set<string>() },
      schemas: () => [],
      execute: (_name: string) => fixture.invoke(),
      turnEnded: vi.fn(),
    } satisfies PlatformTools;
    const tools = createIdempotentTools({ ledger, effects: catalogToolEffects(), human: noHuman });
    const gated = idempotentPlatformTools(platform, tools, RUN);
    const env = (callId: string) => ({ callId, step: 4, progress: { rungs: {} } });
    await gated.execute("env.run", {}, env("x"));
    await gated.execute("env.run", {}, env("y"));
    expect(ledger.writes.recordStep).toBe(0);
    await gated.turnEnded!({ step: 4 });
    expect(platform.turnEnded).toHaveBeenCalledWith({ step: 4 });
    expect(ledger.writes.recordStep).toBe(1);
    expect([...(await ledger.get(["run-1:4:x", "run-1:4:y"])).keys()]).toEqual(["run-1:4:x", "run-1:4:y"]);
    // The same call again replays: the counter does not move, and the model reads the same answer.
    expect(await gated.execute("env.run", {}, env("x"))).toEqual({ data: { ok: true, count: 1 } });
    expect(fixture.count()).toBe(2);
    // A mutating call with no call id cannot be keyed: refused, not run.
    expect((await gated.execute("env.run", {}, { step: 4, progress: { rungs: {} } })).isError).toBe(true);
    expect(fixture.count()).toBe(2);
  });
});

describe("unsafe-to-replay → the human port", () => {
  const external = catalogToolEffects({ "stripe.charge": { mutates: true }, "github.create_issue": { mutates: true, idempotency: true } });

  async function pendingCharge() {
    const ledger = createMemoryToolResultLedger();
    await ledger.writeAhead(idempotencyKeyString(key(5, "pay")), "stripe.charge");
    return ledger;
  }

  it("an external tool without idempotency support, written ahead but unrecorded, asks a person; 'skip' does not run it", async () => {
    const ledger = await pendingCharge();
    const ask = vi.fn<HumanChannel["ask"]>(async () => ({ kind: "answered" as const, answer: "skip" }));
    const tools = createIdempotentTools({ ledger, effects: external, human: { ask } });
    const fixture = counter();
    const result = await tools.call(key(5, "pay"), "stripe.charge", fixture.invoke);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toContain("stripe.charge");
    expect(ask.mock.calls[0]![1]).toEqual(["re-run", "skip"]);
    expect(result.isError).toBe(true);
    expect((result.data as { unsafeToReplay?: boolean }).unsafeToReplay).toBe(true);
    expect(fixture.count()).toBe(0);
    // The decision is recorded with the step: a later resume does not ask again.
    await tools.endStep(5);
    const again = createIdempotentTools({ ledger, effects: external, human: noHuman });
    expect((await again.call(key(5, "pay"), "stripe.charge", fixture.invoke)).isError).toBe(true);
    expect(fixture.count()).toBe(0);
  });

  it("'re-run' runs it once and records it", async () => {
    const ledger = await pendingCharge();
    const tools = createIdempotentTools({ ledger, effects: external, human: { ask: async () => ({ kind: "answered", answer: "re-run" }) } });
    const fixture = counter();
    expect(await tools.call(key(5, "pay"), "stripe.charge", fixture.invoke)).toEqual({ data: { ok: true, count: 1 } });
    await tools.endStep(5);
    expect((await ledger.get(["run-1:5:pay"])).get("run-1:5:pay")?.state).toBe("recorded");
  });

  it("a parked ask runs nothing and records nothing, so the next resume asks again", async () => {
    const ledger = await pendingCharge();
    const tools = createIdempotentTools({ ledger, effects: external, human: { ask: async () => ({ kind: "paused" }) } });
    const fixture = counter();
    expect((await tools.call(key(5, "pay"), "stripe.charge", fixture.invoke)).isError).toBe(true);
    await tools.endStep(5);
    expect(fixture.count()).toBe(0);
    expect(ledger.writes.recordStep).toBe(0);
  });

  it("an external tool that honours keys, and an unclassified tool, are judged by the catalog", async () => {
    const ledger = createMemoryToolResultLedger();
    await ledger.writeAhead(idempotencyKeyString(key(6, "i")), "github.create_issue");
    const tools = createIdempotentTools({ ledger, effects: external, human: noHuman });
    const fixture = counter();
    await tools.call(key(6, "i"), "github.create_issue", fixture.invoke); // idempotent: re-invoked, no person asked
    expect(fixture.count()).toBe(1);
    expect(external.effect("unknown.tool")).toEqual({ mutates: true, idempotent: false }); // fail closed
  });
});

describe("catalogToolEffects", () => {
  it("classifies an env tool by its advertised function name as well as its key", () => {
    const effects = catalogToolEffects();
    expect(effects.effect("env_fs_read")).toEqual({ mutates: false, idempotent: true });
    expect(effects.effect("env_run")).toEqual({ mutates: true, idempotent: true });
    expect(effects.effect("env.fs.write")).toEqual({ mutates: true, idempotent: true });
    expect(effects.effect("unknown_tool")).toEqual({ mutates: true, idempotent: false });
  });
});
