/**
 * W12 phase 4 exit test: the runtime is killed after a mutating call completes and before the next step. The side effect
 * happened exactly once (counter fixture), the run continues from the next step, and the run store shows one run with one
 * `run.recovered` event. The checkpoint write (run state + the step's tool results) is timed and logged.
 */
import { describe, expect, it } from "vitest";
import { runAgent, type ModelRequest, type PlatformTools, type RunEvent, type RunOutcome, type RunPolicy, type RunPorts, type RunState } from "@builderforce/agent-run";
import { createAgentsParticipant, type InterruptedRun } from "./agentsParticipant.js";
import { catalogToolEffects, createIdempotentTools, createMemoryToolResultLedger, idempotentPlatformTools, type ToolResultLedger } from "./idempotentTools.js";
import { InvalidCheckpointError, resumeFromCheckpoint } from "./resume.js";

const RUN_ID = "run-counter";
const CORRELATION = { environmentId: "env-1", runtimeId: "rt-2", agentId: "developer" };
const TASK = { prompt: "Bump the counter once, then say done.", dispatch: { source: "chat" as const } };
const POLICY: RunPolicy = {
  entryPoint: "vscode",
  toolScope: "chat-work",
  role: "general",
  levers: [],
  budgets: {},
  inference: "hybrid",
  verify: "none",
  approvalGates: [],
  delegation: { requested: false, readsBeforeNudge: 6 },
};

/** What survives a kill: the run store, the tool-result ledger, the environment's side effect and the run's event log. */
function durable() {
  const runs = new Map<string, RunState>();
  const timings: Array<{ write: string; ms: number }> = [];
  const timed = async <T>(write: string, fn: () => Promise<T> | T): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      timings.push({ write, ms: performance.now() - start });
    }
  };
  const memory = createMemoryToolResultLedger();
  const ledger: ToolResultLedger = {
    get: (keys) => memory.get(keys),
    writeAhead: (key, tool) => timed("tool write-ahead", () => memory.writeAhead(key, tool)),
    recordStep: (step, entries) => timed(`tool results, step ${step}`, () => memory.recordStep(step, entries)),
  };
  const store = {
    load: () => runs.get(RUN_ID),
    save: (state: RunState) => timed(`run checkpoint, step ${state.step}`, () => { runs.set(RUN_ID, structuredClone(state)); }),
  };
  return { runs, store, ledger, memory, timings, events: [] as RunEvent[], counter: { value: 0 } };
}

/** One runtime: everything in memory that a kill loses (the gate's buffer, the model call in flight, the ports). */
function runtime(world: ReturnType<typeof durable>) {
  const tools = createIdempotentTools({ ledger: world.ledger, effects: catalogToolEffects(), human: { ask: async () => ({ kind: "paused" }) } });
  const counterTool: PlatformTools = {
    closed: true,
    selection: { query: "", limit: 5, required: new Set<string>() },
    schemas: () => [{ type: "function", function: { name: "env.run", description: "Run a command in the environment.", parameters: { type: "object" } } }],
    execute: async () => ({ data: { ok: true, counter: ++world.counter.value } }),
  };
  // The scripted model reads the transcript, so a reissued call after the kill answers from what the checkpoint holds.
  const complete = async (request: ModelRequest) => request.messages.some((m) => m.role === "tool")
    ? { content: "done" }
    : { content: "", toolCalls: [{ id: "c1", name: "env.run", arguments: '{"command":"bump"}' }] };
  const ports: RunPorts = {
    model: { complete },
    platform: idempotentPlatformTools(counterTool, tools, RUN_ID),
    store: world.store,
    events: { emit: (e) => { world.events.push({ ...e, ...CORRELATION }); } },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
  return { ports };
}

describe("checkpoint, resume, no repeats (W12 phase 4)", () => {
  it("a run killed after a mutating call and before the next step resumes at the next step without repeating it", async () => {
    const world = durable();

    // Step n: the mutating call runs, its result is recorded at the tool-result boundary, and the step checkpoints.
    const first = await runAgent({ task: TASK, policy: POLICY, ports: runtime(world).ports, maxSteps: 1 });
    expect(first.kind).toBe("yielded");
    expect(world.counter.value).toBe(1);
    // The checkpoint's `step` counts the steps taken (the kernel numbers them from 0): the mutating call was step n.
    const n = world.runs.get(RUN_ID)!.step - 1;
    expect(world.events.find((e) => e.kind === "tool.dispatched")?.step).toBe(n);
    // Kill: the first runtime is dropped with no clean stop. Only `world` survives.

    let resumed: RunOutcome | undefined;
    const participant = createAgentsParticipant({
      interrupted: async (): Promise<InterruptedRun[]> => [{ runId: RUN_ID, store: world.store, events: { emit: (e) => { world.events.push(e); } }, correlation: CORRELATION }],
      restart: async (_run, recovered) => {
        resumed = await runAgent({ task: TASK, policy: POLICY, ports: runtime(world).ports, resume: recovered.resume });
      },
      checkpoint: async () => undefined,
    });
    expect(participant).toMatchObject({ id: "agents", stage: "capabilities" });
    expect(await participant.recover()).toEqual({ id: "agents", status: "restored", detail: "1 of 1 runs resumed" });

    expect(resumed?.kind).toBe("finished");
    expect(world.counter.value).toBe(1); // the side effect happened exactly once
    expect(world.runs.size).toBe(1); // one run in the store

    const kinds = world.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "run.started")).toHaveLength(1);
    expect(kinds.filter((k) => k === "run.finished")).toHaveLength(1);
    const recovered = world.events.filter((e) => e.kind === "run.recovered");
    expect(recovered).toEqual([{ kind: "run.recovered", step: n + 1, fromStep: n, ...CORRELATION }]);
    // The run continues at step n + 1: the first turn after the recovery is step n + 1.
    const after = world.events.slice(kinds.indexOf("run.recovered"));
    expect(after.find((e) => e.kind === "turn.started")?.step).toBe(n + 1);
    // The counter call was dispatched once across both runtimes.
    expect(world.events.filter((e) => e.kind === "tool.dispatched")).toHaveLength(1);

    // One tool-results write for the mutating step (batched), one write-ahead, and the timed checkpoint writes.
    expect(world.memory.writes).toEqual({ writeAhead: 1, recordStep: 1 });
    for (const { write, ms } of world.timings) console.info(`[W12 phase 4] ${write}: ${ms.toFixed(3)} ms`);
    expect(world.timings.some((t) => t.write.startsWith("run checkpoint"))).toBe(true);
  });

  it("a run that never checkpointed has nothing to resume and emits nothing", async () => {
    const events: RunEvent[] = [];
    expect(await resumeFromCheckpoint({ store: { load: () => undefined }, events: { emit: (e) => { events.push(e); } } })).toBeUndefined();
    expect(events).toEqual([]);
    const participant = createAgentsParticipant({ interrupted: async () => [], restart: async () => undefined, checkpoint: async () => undefined });
    expect(await participant.recover()).toEqual({ id: "agents", status: "fresh" });
  });

  it("a stored checkpoint that is not a run state fails the participant loudly, naming the run", async () => {
    const bad = { load: () => ({ step: 2 }) as unknown as RunState };
    await expect(resumeFromCheckpoint({ store: bad, events: { emit: () => undefined } })).rejects.toBeInstanceOf(InvalidCheckpointError);
    const participant = createAgentsParticipant({
      interrupted: async () => [{ runId: "r-bad", store: bad, events: { emit: () => undefined } }],
      restart: async () => undefined,
      checkpoint: async () => undefined,
    });
    const result = await participant.recover();
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("r-bad");
  });
});
