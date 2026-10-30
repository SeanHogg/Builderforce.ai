/**
 * Conformance — the CLOUD adapter's shape (PRD 35 WS3 / §3.3).
 *
 * The cloud drives the agent one step per Durable Object tick (`maxSteps: 1`), resuming from the
 * state the cursor saved, with a board-dispatched policy: a required sign-off, dispatch
 * provenance, a persona opening the transcript, and a surface-supplied platform tool. The same
 * scripted task, run continuously and one step per tick, must give the SAME trace, the SAME
 * requests and the SAME outcome — and a finish must be refused until the sign-off is recorded.
 */
import { describe, expect, it } from "vitest";
import type { Capability, CapabilityProvider, ToolSchema } from "@builderforce/agent-tools";
import {
  runAgent,
  type ModelCompletion,
  type ModelRequest,
  type RunEvent,
  type RunOutcome,
  type RunPolicy,
  type RunPorts,
  type RunState,
  type RunTask,
  type ToolExtension,
} from "../../src/index.js";

const SIGNOFF = "builtin_kanban_signoff";

const TASK: RunTask = {
  prompt: "Review the change and sign off.",
  persona: "You are the reviewer.",
  ticketId: 7,
  dispatch: { source: "lane-entry", approvalId: "appr-1" },
};

const POLICY: RunPolicy = {
  entryPoint: "cloud",
  toolScope: "ticket",
  role: "code",
  levers: [],
  budgets: {},
  pinnedModel: "fake-model",
  inference: "hybrid",
  verify: "branch-ci",
  signoff: { roleKey: "qa-tester" },
  approvalGates: [],
  delegation: { requested: false, readsBeforeNudge: 6 },
  modelStart: { strict: false },
};

const SCRIPT: Array<{ content?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }> = [
  // The agent tries to finish without the verdict: refused.
  { toolCalls: [{ id: "c1", name: "finish", arguments: '{"summary":"Looks fine."}' }] },
  // It records the verdict through the surface's own tool.
  { toolCalls: [{ id: "c2", name: SIGNOFF, arguments: '{"roleKey":"qa-tester","verdict":"approved"}' }] },
  { toolCalls: [{ id: "c3", name: "finish", arguments: '{"summary":"Approved."}' }] },
  { content: "Approved." },
];

const SIGNOFF_SCHEMA: ToolSchema = { type: "function", function: { name: SIGNOFF, description: "Record the verdict.", parameters: { type: "object", properties: {} } } };

const extension: ToolExtension = {
  schemas: () => [SIGNOFF_SCHEMA],
  handles: (name) => name === SIGNOFF,
  dispatch: async () => ({ data: { ok: true } }),
};

function memoryStore() {
  let saved: RunState | undefined;
  return {
    load: () => saved,
    save: (state: RunState) => { saved = JSON.parse(JSON.stringify(state)) as RunState; },
    get saved() { return saved; },
  };
}

function build(store: ReturnType<typeof memoryStore>, events: RunEvent[], requests: ModelRequest[], model: { next(): ModelCompletion }): RunPorts {
  const caps: CapabilityProvider = { capabilities: new Set<Capability>() };
  return {
    model: { complete: async (request) => { requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest); return model.next(); } },
    capabilities: caps,
    store,
    events: { emit: (event) => { events.push(event); } },
    human: { ask: async () => ({ kind: "paused" }) },
    steering: { drain: async () => [] },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }), turnSections: () => ["## affect\ncalm"] },
    extensions: extension,
  };
}

function scripted(): { next(): ModelCompletion } {
  let index = 0;
  return {
    next() {
      const turn = SCRIPT[index];
      index += 1;
      if (!turn) throw new Error("script exhausted");
      return { content: turn.content ?? "", ...(turn.toolCalls ? { toolCalls: turn.toolCalls } : {}), model: "fake-model" };
    },
  };
}

async function drive(maxSteps?: number): Promise<{ outcome: RunOutcome; events: RunEvent[]; requests: ModelRequest[] }> {
  const store = memoryStore();
  const events: RunEvent[] = [];
  const requests: ModelRequest[] = [];
  const model = scripted();
  const step = maxSteps !== undefined ? { maxSteps } : {};
  let outcome = await runAgent({ task: TASK, policy: POLICY, ports: build(store, events, requests, model), ...step });
  for (let tick = 0; outcome.kind === "yielded"; tick += 1) {
    if (tick > 50) throw new Error("never finished");
    outcome = await runAgent({ task: TASK, policy: POLICY, ports: build(store, events, requests, model), resume: store.saved, ...step });
  }
  return { outcome, events, requests };
}

describe("conformance — the cloud tick (maxSteps: 1) vs a continuous run", () => {
  it("gives the same trace, the same requests and the same outcome", async () => {
    const continuous = await drive();
    const stepped = await drive(1);
    expect(stepped.events).toEqual(continuous.events);
    expect(stepped.requests).toEqual(continuous.requests);
    expect(stepped.outcome.kind).toBe("finished");
    expect(continuous.outcome.kind).toBe("finished");
    if (stepped.outcome.kind === "finished" && continuous.outcome.kind === "finished") expect(stepped.outcome.output).toEqual(continuous.outcome.output);
  });

  it("refuses the finish until the sign-off is recorded, then finishes", async () => {
    const { outcome, events } = await drive(1);
    expect(outcome.kind).toBe("finished");
    if (outcome.kind === "finished") expect(outcome.state.finish.reviewVerdictRecorded).toBe(true);
    const dispatched = events.filter((e): e is Extract<RunEvent, { kind: "tool.dispatched" }> => e.kind === "tool.dispatched");
    const signed = dispatched.find((e) => e.tool === SIGNOFF);
    expect(signed?.callId).toBe("c2");
    expect(signed?.args).toEqual({ roleKey: "qa-tester", verdict: "approved" });
    // The first finish (before the verdict) never ended the run: three model turns preceded the answer.
    expect(events.filter((e) => e.kind === "model.completed").length).toBeGreaterThanOrEqual(3);
  });

  it("opens with the persona as system and the task as the first user turn, with the surface's tail last", async () => {
    const { requests } = await drive(1);
    for (const request of requests) {
      expect(request.messages[0]).toEqual({ role: "system", content: "You are the reviewer." });
      expect(request.messages[1]).toEqual({ role: "user", content: TASK.prompt });
      const tail = request.messages[request.messages.length - 1];
      expect(tail?.content.startsWith("<run-state>")).toBe(true);
      expect(tail?.content).toContain("## affect");
    }
  });
});
