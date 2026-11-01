/**
 * The ONE scripted task (`src/conformanceTask.ts`) through the agent on in-memory ports: the GOLDEN trace every adapter's
 * conformance case (cloud, canvas, on-prem, channels, web, Rovr, VS Code) compares itself to, each beside the adapter it
 * drives. The golden is the literal `CONFORMANCE_TRACE` in `src/conformanceTask.ts`; this file is what holds it true, for the
 * continuous run and for the stepped one (one step per Durable Object tick).
 */
import { describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import {
  CONFORMANCE_ANSWER,
  CONFORMANCE_PROMPT,
  CONFORMANCE_TRACE,
  CONFORMANCE_SCRIPT,
  conformanceTrace,
  runAgent,
  teeEvents,
  type ModelCompletion,
  type RunEvent,
  type RunOutcome,
  type RunPolicy,
  type RunPorts,
  type RunState,
} from "../../src/index.js";

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

function ports(store: { saved?: RunState }, events: RunEvent[]): RunPorts {
  let turn = 0;
  const script = CONFORMANCE_SCRIPT;
  return {
    model: { complete: async (): Promise<ModelCompletion> => script[Math.min(turn++, script.length - 1)]! },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => store.saved, save: (state) => { store.saved = JSON.parse(JSON.stringify(state)) as RunState; } },
    events: teeEvents(undefined, events),
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
}

async function drive(maxSteps?: number): Promise<{ outcome: RunOutcome; trace: string[] }> {
  const store: { saved?: RunState } = {};
  const events: RunEvent[] = [];
  const task = { prompt: CONFORMANCE_PROMPT, dispatch: { source: "chat" as const } };
  const step = maxSteps !== undefined ? { maxSteps } : {};
  // A tick-driven runner builds new ports each tick, sharing only the store, so the model script is replayed by turn
  // count carried in the saved state: here one model object per drive keeps its own counter.
  const model = ports(store, events).model;
  const build = (): RunPorts => ({ ...ports(store, events), model });
  let outcome = await runAgent({ task, policy: POLICY, ports: build(), ...step });
  for (let tick = 0; outcome.kind === "yielded"; tick += 1) {
    if (tick > 50) throw new Error("never finished");
    outcome = await runAgent({ task, policy: POLICY, ports: build(), resume: store.saved, ...step });
  }
  return { outcome, trace: conformanceTrace(events) };
}

describe("the scripted task on in-memory ports", () => {
  it("emits the golden trace and ends with the scripted answer", async () => {
    const { outcome, trace } = await drive();
    expect(trace).toEqual(CONFORMANCE_TRACE);
    expect(outcome).toMatchObject({ kind: "finished", output: CONFORMANCE_ANSWER });
  });

  it("one step per tick emits the same trace and the same answer", async () => {
    const { outcome, trace } = await drive(1);
    expect(trace).toEqual(CONFORMANCE_TRACE);
    expect(outcome).toMatchObject({ kind: "finished", output: CONFORMANCE_ANSWER });
  });
});
