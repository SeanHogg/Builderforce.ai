/**
 * The canvas conformance case (PRD 35 §3.3, WS4): a surface with its OWN tools and its OWN
 * deliverables runs on the one agent.
 *
 * The Creation Canvas supplies a `PlatformTools` (its board's tools — a capability
 * provider on the same run) and a `DeliveryLedger` (what the task still owes when a turn
 * ends in prose), and nothing else about behaviour. These cases drive a fake model through
 * the SAME ports the canvas adapter builds and prove what the agent — not the adapter —
 * does with them:
 *
 *   • the board's tools are advertised and dispatched; the shared registry's are not;
 *   • the first call that begins the work hands the run from analysis to code;
 *   • a stepped run (`maxSteps: 1`) produces the same trace as a continuous one;
 *   • a prose answer to an imperative request climbs the ladder: re-state, re-state
 *     harder, then settle on the rung's answer;
 *   • a call whose arguments never parsed is declined, and the round says how to stop it;
 *   • a provider that broke is routed around, with the broken model left out.
 */

import { describe, expect, it } from "vitest";
import type { Capability, ToolSchema } from "@builderforce/agent-tools";

import {
  runAgent,
  type DeliveryLedger,
  type LadderRung,
  type ModelCompletion,
  type ModelRequest,
  type PlatformTools,
  type RunEvent,
  type RunOutcome,
  type RunPolicy,
  type RunPorts,
  type RunState,
  type RunTask,
} from "../../src/index.js";
import { resetRungs } from "../../src/policy/stall/ladder.js";

const POLICY: RunPolicy = {
  entryPoint: "canvas",
  toolScope: "canvas",
  role: "canvas",
  levers: [],
  budgets: {},
  inference: "hybrid",
  verify: "none",
  approvalGates: [],
  delegation: { requested: false, readsBeforeNudge: 6 },
  modelOptions: { lockAfterFirstSuccess: true, preferProvenFailover: true, strictFailover: true },
};

const TASK: RunTask = {
  prompt: "Add a note to the board",
  dispatch: { source: "chat" },
  transcript: [
    { role: "system", content: "You operate the board." },
    { role: "user", content: "Add a note to the board" },
  ],
};

const schema = (name: string): ToolSchema => ({ type: "function", function: { name, description: `The ${name} tool`, parameters: { type: "object" } } });

/** A fake model replaying a script; an entry that is an Error is thrown. Records every request. */
function scripted(script: Array<ModelCompletion | Error>, requests: ModelRequest[]): RunPorts["model"] {
  let index = 0;
  return {
    complete: async (request) => {
      requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
      const turn = script[index];
      index += 1;
      if (!turn) throw new Error(`script exhausted after ${index - 1} call(s)`);
      if (turn instanceof Error) throw turn;
      return turn;
    },
  };
}

function toolCall(name: string, args: string, id = "c1"): ModelCompletion {
  return { content: "", toolCalls: [{ id, name, arguments: args }], model: "m1" };
}

interface Board {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  changed: boolean;
  refused: Array<{ name: string; truncated: boolean }>;
}

/** The canvas's tools as a capability provider: two tools, one of which begins the work. */
function platformFor(board: Board): PlatformTools {
  return {
    closed: true,
    schemas: () => [schema("canvas_add_object"), schema("canvas_note")],
    selection: { query: "add a note", limit: 96, required: new Set<string>() },
    handsOff: (name) => name === "canvas_add_object",
    malformed: {
      retryHint: "Send one object per response.",
      roundDirective: (truncated) => (truncated ? "SEND LESS" : "RE-ENCODE"),
      refused: (call, truncated) => board.refused.push({ name: call.name, truncated }),
    },
    execute: async (name, args) => {
      board.calls.push({ name, args });
      if (name === "canvas_add_object") board.changed = true;
      return { data: { ok: true, proposed: true } };
    },
  };
}

/** What the task still owes: a board change, re-stated twice, then settled on a notice. */
function ledgerFor(board: Board, over: Partial<LadderRung> = {}): DeliveryLedger {
  const owed = (): LadderRung => ({
    id: "canvas.mutation",
    applies: !board.changed,
    restate: ["ACT NOW", "PROSE IS NOT AN ARTIFACT"],
    handoff: (to) => `HAND OFF Continue on ${to}`,
    quote: true,
    spent: { settle: "Nothing was put on the board." },
    ...over,
  });
  return {
    rungs: () => [owed()],
    owns: { narration: true, settle: true, synthesis: true },
    accept: (content) => content.trim(),
    providerFailure: { handoff: (to) => `PROVIDER HAND OFF ${to}`, reroute: "REROUTE" },
  };
}

function portsFor(model: RunPorts["model"], board: Board, events: RunEvent[], store: { saved?: RunState } = {}, delivery: DeliveryLedger = ledgerFor(board)): RunPorts {
  const caps = new Set<Capability>();
  return {
    model,
    capabilities: { capabilities: caps },
    platform: platformFor(board),
    delivery,
    store: {
      load: () => store.saved,
      save: (state) => { store.saved = JSON.parse(JSON.stringify(state)) as RunState; },
    },
    events: { emit: (event) => { events.push(event); } },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
  };
}

const freshBoard = (): Board => ({ calls: [], changed: false, refused: [] });
const namesOf = (request: ModelRequest | undefined): string[] => (request?.tools ?? []).map((tool) => tool.function.name);

describe("conformance — canvas: the board's tools on the same run", () => {
  it("advertises and dispatches the surface's tools, never the shared registry's", async () => {
    const board = freshBoard();
    const requests: ModelRequest[] = [];
    const events: RunEvent[] = [];
    const model = scripted([toolCall("canvas_add_object", '{"kind":"note"}'), { content: "Added the note.", model: "m1" }], requests);

    const outcome = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, events) });

    expect(outcome).toMatchObject({ kind: "finished", output: "Added the note." });
    expect(board.calls).toEqual([{ name: "canvas_add_object", args: { kind: "note" } }]);
    expect(namesOf(requests[0])).toEqual(["canvas_add_object", "canvas_note"]);
    // The surface's tool ran through the surface (the board saw it), and the merged event contract carries the call's id, arguments and result.
    expect(events.filter((event) => event.kind === "tool.dispatched")).toEqual([
      { kind: "tool.dispatched", step: 0, tool: "canvas_add_object", ok: true, callId: "c1", args: { kind: "note" }, result: { ok: true, proposed: true } },
    ]);
  });

  it("opens with the surface's own transcript, and hands analysis to code on the first working call", async () => {
    const board = freshBoard();
    const requests: ModelRequest[] = [];
    const model = scripted([toolCall("canvas_add_object", "{}"), { content: "Done.", model: "m1" }], requests);

    await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, []) });

    expect(requests[0]?.messages).toEqual(TASK.transcript);
    expect(requests[0]).toMatchObject({ role: "plan" });
    expect(requests[0]?.model).toBeUndefined();
    // The model that answered the first turn is kept (a lock, not a pin), and the coder takes over.
    expect(requests[1]).toMatchObject({ role: "code", model: "m1", strict: false });
  });

  it("a stepped run produces the same trace and outcome as a continuous one", async () => {
    const script = (): Array<ModelCompletion | Error> => [toolCall("canvas_add_object", "{}"), { content: "Done.", model: "m1" }];

    const continuousEvents: RunEvent[] = [];
    const continuous = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(scripted(script(), []), freshBoard(), continuousEvents) });

    // A tick-driven runner invokes the agent once per step, feeding back the state the last tick saved.
    const steppedEvents: RunEvent[] = [];
    const board = freshBoard();
    const store: { saved?: RunState } = {};
    const model = scripted(script(), []);
    let stepped: RunOutcome = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, steppedEvents, store), maxSteps: 1 });
    for (let tick = 0; stepped.kind === "yielded"; tick += 1) {
      if (tick > 20) throw new Error("the stepped run never finished");
      stepped = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, steppedEvents, store), resume: store.saved, maxSteps: 1 });
    }

    expect(steppedEvents).toEqual(continuousEvents);
    expect(stepped.kind).toEqual(continuous.kind);
    expect(stepped.kind).toEqual("finished");
  });
});

describe("conformance — canvas: what the task still owes", () => {
  it("re-states a prose answer to an imperative request, harder, then settles on the rung's answer", async () => {
    const board = freshBoard();
    const requests: ModelRequest[] = [];
    const model = scripted([
      { content: "I will create it.", model: "weak" },
      { content: "Tell me what to create.", model: "weak" },
      { content: "Here is what the note would say.", model: "weak" },
    ], requests);

    const outcome = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, []) });

    expect(requests).toHaveLength(3);
    const systemRows = (request: ModelRequest | undefined) => (request?.messages ?? []).filter((m) => m.role === "system").map((m) => m.content);
    expect(systemRows(requests[1])).toContain("ACT NOW");
    expect(systemRows(requests[2])).toContain("PROSE IS NOT AN ARTIFACT");
    // What the model said is quoted back before the directive that answers it.
    expect(requests[1]?.messages.at(-2)).toEqual({ role: "assistant", content: "I will create it." });
    expect(outcome).toMatchObject({ kind: "finished", output: "Nothing was put on the board." });
    expect(board.calls).toEqual([]);
  });

  it("hands the turn to a model that already acted, strictly, and starts the ladder again", async () => {
    const board = freshBoard();
    const requests: ModelRequest[] = [];
    // The proven model acts on something else first (a read), then the weaker one stalls twice.
    const model = scripted([
      toolCall("canvas_note", "{}"),
      { content: "I will create it.", model: "weak" },
      { content: "I still need to create it.", model: "weak" },
      toolCall("canvas_add_object", "{}"),
      { content: "Created.", model: "m1" },
    ], requests);

    const outcome = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, []) });

    expect(outcome).toMatchObject({ kind: "finished", output: "Created." });
    // The second stall tries a hand-off before a second re-statement: m1 acted, so it takes over.
    expect(requests[3]).toMatchObject({ model: "m1", strict: true });
    expect((requests[3]?.messages ?? []).some((m) => m.role === "system" && m.content.startsWith("HAND OFF Continue on m1"))).toBe(true);
  });
});

describe("conformance — canvas: how the ladder ends", () => {
  it("fails the run, naming the rung, when a rung is spent with `fail`", async () => {
    const board = freshBoard();
    const model = scripted([{ content: "I will.", model: "weak" }, { content: "Still will.", model: "weak" }], []);
    const delivery = ledgerFor(board, { restate: ["ACT NOW"], spent: "fail" });

    const outcome = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, [], {}, delivery) });

    expect(outcome).toMatchObject({ kind: "failed", reason: "canvas.mutation" });
  });

  it("a hand-off clears every rung's counter except the ones the ledger names sticky", () => {
    const state = { stall: { recoveriesUsed: 0, rungs: { a: 2, b: 1 } } } as unknown as RunState;

    resetRungs(state, ["b"]);

    expect(state.stall?.rungs).toEqual({ b: 1 });
  });
});

describe("conformance — canvas: a call that never parsed", () => {
  it("is declined, not run, and the round says once how to stop it recurring", async () => {
    const board = { ...freshBoard(), changed: true };
    const requests: ModelRequest[] = [];
    const model = scripted([
      { content: "", toolCalls: [{ id: "c1", name: "canvas_add_object", arguments: '{"kind":"no' }], model: "m1", interrupted: "truncated" },
      { content: "Retried.", model: "m1" },
    ], requests);

    await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, []) });

    expect(board.calls).toEqual([]);
    expect(board.refused).toEqual([{ name: "canvas_add_object", truncated: true }]);
    const rows = requests[1]?.messages ?? [];
    const toolRow = rows.find((m) => m.role === "tool");
    expect(toolRow?.content).toContain("Send one object per response.");
    expect(rows.at(-1)).toEqual({ role: "system", content: "SEND LESS" });
  });
});

describe("conformance — canvas: a provider that broke", () => {
  const broke = (model?: string): Error =>
    Object.assign(new Error("the model failed mid-answer"), { failure: { type: "transport_failed", kind: "interrupted", ...(model ? { model } : {}) } });

  it("re-asks with the broken model left out, then carries on", async () => {
    const board = { ...freshBoard(), changed: true };
    const requests: ModelRequest[] = [];
    const model = scripted([broke("m1"), { content: "Here is the answer.", model: "m2" }], requests);

    const outcome = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, []) });

    expect(outcome).toMatchObject({ kind: "finished", output: "Here is the answer." });
    expect(requests[1]?.excludeModels).toEqual(["m1"]);
    expect(requests[1]?.model).toBeUndefined();
  });

  it("hands the turn to a model that already acted, in the surface's words, before routing around", async () => {
    const board = { ...freshBoard(), changed: true };
    const requests: ModelRequest[] = [];
    // Two models acted; the second then breaks, so the first takes over.
    const second: ModelCompletion = { content: "", toolCalls: [{ id: "c2", name: "canvas_note", arguments: "{}" }], model: "weak" };
    const model = scripted([toolCall("canvas_note", "{}"), second, broke("weak"), { content: "Done.", model: "m1" }], requests);

    const outcome = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, []) });

    expect(outcome).toMatchObject({ kind: "finished", output: "Done." });
    expect(requests[3]).toMatchObject({ model: "m1", strict: true });
    expect((requests[3]?.messages ?? []).at(-1)).toEqual({ role: "system", content: "PROVIDER HAND OFF m1" });
  });

  it("fails the turn once the retry is spent", async () => {
    const board = freshBoard();
    const requests: ModelRequest[] = [];
    const model = scripted([broke("m1"), broke("m1")], requests);

    const outcome = await runAgent({ task: TASK, policy: POLICY, ports: portsFor(model, board, []) });

    expect(outcome.kind).toEqual("failed");
    expect(requests).toHaveLength(2);
  });
});
