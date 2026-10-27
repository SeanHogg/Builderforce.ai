/**
 * The conformance harness (PRD 35 §3.3 "Conformance suite").
 *
 * Runs one scripted task through the one agent TWICE — once continuously, once at
 * `maxSteps: 1` resuming each step from the saved `RunState` — and proves the two
 * produce the SAME `RunEvent` trace and the SAME `RunOutcome`. A cloud tick runs one
 * step per invocation; the trace must read as one run, not one run per tick.
 *
 * The harness supplies only PORTS, exactly as an adapter does:
 *   • a scripted `ModelTransport` (replays a fixed script of completions, no network),
 *   • an in-memory `CapabilityProvider` (no filesystem, no shell, no DOM),
 *   • a memory `RunStore` (a Map),
 *   • a trace-recording `EventSink`,
 *   • a scripted `HumanChannel`, an empty `SteeringSource`, a scripted `ContextSource`.
 *
 * No `node:*` imports, no DOM: the harness runs in the same Worker-/browser-safe
 * environment the package itself targets.
 */

import { describe, expect, it } from "vitest";
import type {
  Capability,
  CapabilityProvider,
} from "@builderforce/agent-tools";

import {
  runAgent,
  type ContextPack,
  type HumanAnswer,
  type ModelCompletion,
  type ModelRequest,
  type ModelTransport,
  type RunEvent,
  type RunOutcome,
  type RunPolicy,
  type RunPorts,
  type RunState,
  type RunTask,
} from "../../src/index.js";

/** One scripted model turn: what the fake model answers on its Nth call. */
interface ScriptedTurn {
  /** Assistant text (may be empty when the turn only calls tools). */
  content?: string;
  /** Tool calls the model makes this turn. */
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  /** The model id the transport reports. */
  model?: string;
}

/**
 * A fake `ModelTransport` that replays a fixed script, one completion per call.
 * Throws when the script is exhausted so a run that asks for more than scripted
 * fails loudly rather than looping on a stale answer.
 */
function scriptedModel(script: ScriptedTurn[]): ModelTransport {
  let index = 0;
  return {
    complete: async (_request: ModelRequest): Promise<ModelCompletion> => {
      const turn = script[index];
      index += 1;
      if (!turn) throw new Error(`scriptedModel: script exhausted after ${index - 1} call(s)`);
      return {
        content: turn.content ?? "",
        ...(turn.toolCalls && turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
        ...(turn.model ? { model: turn.model } : {}),
      };
    },
  };
}

/** An in-memory `CapabilityProvider`. It backs no capability — the scripted run calls
 *  only `finish`, which needs none — so the registry offers just that and the trace
 *  exercises a real dispatch through the real gating path. */
function inMemoryCapabilities(): CapabilityProvider {
  const caps = new Set<Capability>();
  return { capabilities: caps };
}

/** A memory `RunStore`: the last saved state, read back on the next resume. */
function memoryStore() {
  let saved: RunState | undefined;
  return {
    load: () => saved,
    save: (state: RunState) => {
      // Deep-copy through JSON so a resume cannot see the live object by reference —
      // a real cross-process resume receives bytes, not a pointer.
      saved = JSON.parse(JSON.stringify(state)) as RunState;
    },
    get saved(): RunState | undefined {
      return saved;
    },
  };
}

/** A trace-recording `EventSink`. Records every event and the single outcome row. */
function traceSink() {
  const events: RunEvent[] = [];
  const outcomes: unknown[] = [];
  return {
    sink: {
      emit: (event: RunEvent) => {
        events.push(event);
      },
      outcome: (row: unknown) => {
        outcomes.push(row);
      },
    },
    events,
    outcomes,
  };
}

/** A scripted `HumanChannel` that always pauses (the harness never gates on a human). */
function scriptedHuman(): RunPorts["human"] {
  return {
    ask: async (): Promise<HumanAnswer> => ({ kind: "paused" }),
  };
}

/** An empty `SteeringSource` — nothing is steered mid-run. */
function emptySteering(): RunPorts["steering"] {
  return { drain: () => [] };
}

/** A scripted `ContextSource` returning a fixed pack. */
function scriptedContext(pack: ContextPack): RunPorts["context"] {
  return { pack: async () => pack };
}

/** The scripted task: two model turns, then a final answer. */
const TASK: RunTask = {
  prompt: "Say hello, then finish.",
  dispatch: { source: "chat" },
};

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

const CONTEXT_PACK: ContextPack = {
  focus: [{ path: "README.md", content: "# fixture" }],
  facts: [],
  recall: [],
};

/** The model's script for the trivial task: one tool call, then the final answer.
 *  Turn 1 MUST call a tool — a text-only turn finishes the run, so without one the
 *  run ends after a single step and the stepped path never yields (a vacuous test). */
const SCRIPT: ScriptedTurn[] = [
  { content: "", toolCalls: [{ id: "call-1", name: "finish", arguments: '{"summary":"Hello! Done."}' }], model: "fake-model" },
  { content: "Hello! Done.", model: "fake-model" },
];

/** Build the ports for one run. `store` and `sink` are shared so the caller reads them back. */
function buildPorts(store: ReturnType<typeof memoryStore>, sink: ReturnType<typeof traceSink>["sink"]): RunPorts {
  return {
    model: scriptedModel(SCRIPT),
    capabilities: inMemoryCapabilities(),
    store,
    events: sink,
    human: scriptedHuman(),
    steering: emptySteering(),
    context: scriptedContext(CONTEXT_PACK),
  };
}

/** Run the scripted task continuously (no step cap). */
async function runContinuous(): Promise<{ outcome: RunOutcome; events: RunEvent[] }> {
  const store = memoryStore();
  const { sink, events } = traceSink();
  const outcome = await runAgent({ task: TASK, policy: POLICY, ports: buildPorts(store, sink) });
  return { outcome, events };
}

/** Run the scripted task one step per invocation, resuming from the saved state each time. */
async function runStepped(): Promise<{ outcome: RunOutcome; events: RunEvent[] }> {
  const store = memoryStore();
  const { sink, events } = traceSink();

  // A tick-driven runner invokes the agent once per step, feeding the state the prior
  // invocation saved. Each invocation passes maxSteps: 1. The loop continues until the
  // outcome is no longer "yielded" — a real Durable Object would schedule the next tick.
  let outcome = await runAgent({ task: TASK, policy: POLICY, ports: buildPorts(store, sink), maxSteps: 1 });
  let guard = 0;
  while (outcome.kind === "yielded") {
    guard += 1;
    if (guard > 100) throw new Error("runStepped: run never finished after 100 ticks");
    const resume = store.saved;
    if (!resume) throw new Error("runStepped: yielded but the store holds no state");
    outcome = await runAgent({ task: TASK, policy: POLICY, ports: buildPorts(store, sink), resume, maxSteps: 1 });
  }
  return { outcome, events };
}

describe("conformance — continuous vs maxSteps:1", () => {
  it("a stepped run produces the same event trace as a continuous run", async () => {
    const continuous = await runContinuous();
    const stepped = await runStepped();

    // The traces must match exactly: a tick that yields is not a new run, so a stepped
    // run's trace must not be longer than a continuous one (no repeated run.started).
    expect(stepped.events).toEqual(continuous.events);
  });

  it("a stepped run reaches the same outcome as a continuous run", async () => {
    const continuous = await runContinuous();
    const stepped = await runStepped();

    expect(stepped.outcome.kind).toEqual(continuous.outcome.kind);
    expect(stepped.outcome.kind).toEqual("finished");
    if (continuous.outcome.kind === "finished" && stepped.outcome.kind === "finished") {
      expect(stepped.outcome.output).toEqual(continuous.outcome.output);
    }
  });

  it("the trace begins with run.started and ends with run.finished exactly once", async () => {
    const { events } = await runContinuous();
    const kinds = events.map((event) => event.kind);
    expect(kinds[0]).toEqual("run.started");
    expect(kinds[kinds.length - 1]).toEqual("run.finished");
    expect(kinds.filter((kind) => kind === "run.started")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "run.finished")).toHaveLength(1);
  });

  it("the continuous run finishes with the scripted final answer", async () => {
    const { outcome } = await runContinuous();
    expect(outcome.kind).toEqual("finished");
    if (outcome.kind === "finished") {
      expect(outcome.output).toEqual("Hello! Done.");
    }
  });
});
