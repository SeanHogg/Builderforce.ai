/**
 * The Brain's adapters under the conformance suite (PRD 35 §3.3, §4 WS4): the VS Code,
 * Web and Rovr entry points differ ONLY by the label their outcome row carries and the ports
 * they build — so one scripted task must give the SAME `RunEvent` trace and `RunOutcome` on
 * each, and the surface behaviours the Brain keeps (Stop, a steer that interrupts, the
 * model preflight, the window-sized result cap) must hold on each.
 *
 * The ports below have the shape the Brain's adapters build (`brain-embedded` `run/*`): a
 * model transport over a streaming function with `window()` and `preflight()`, an event sink
 * that records the trace and the outcome row, a run store the cell stands behind, a human
 * channel whose ask parks the run, and the run-keyed steering inbox the composer posts to.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import {
  queueRunSteering,
  runAgent,
  runSteeringSource,
  type ModelCompletion,
  type ModelRequest,
  type RunEvent,
  type RunOutcome,
  type RunOutcomeRow,
  type RunPolicy,
  type RunPorts,
  type RunTask,
} from "../../src/index.js";
import { resetRunSteering } from "../../src/policy/steering/index.js";

const ENTRY_POINTS = ["vscode", "web", "rovr"] as const;
type EntryPoint = (typeof ENTRY_POINTS)[number];

const TASK: RunTask = { prompt: "Say hello, then finish.", dispatch: { source: "chat" } };

function policyFor(entryPoint: EntryPoint): RunPolicy {
  return {
    entryPoint,
    toolScope: "chat-work",
    role: "general",
    levers: [],
    budgets: {},
    inference: "hybrid",
    verify: "none",
    approvalGates: [],
    delegation: { requested: false, readsBeforeNudge: 6 },
  };
}

interface Harness {
  ports: RunPorts;
  events: RunEvent[];
  rows: RunOutcomeRow[];
  requests: ModelRequest[];
  /** Ask `window(model)` was called with — the tools policy sizes its result cap from it. */
  windowAsked: string[];
}

/** The ports a Brain adapter builds, over a scripted model. */
function harness(runKey: number, answers: Array<(request: ModelRequest) => ModelCompletion>, opts: { preflight?: () => { byoUnresolved: string[] } } = {}): Harness {
  const events: RunEvent[] = [];
  const rows: RunOutcomeRow[] = [];
  const requests: ModelRequest[] = [];
  const windowAsked: string[] = [];
  let turn = 0;
  const ports: RunPorts = {
    model: {
      complete: async (request) => {
        requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
        const answer = answers[turn];
        turn += 1;
        if (!answer) throw new Error("script exhausted");
        return answer(request);
      },
      window: (model) => (windowAsked.push(model), 200_000),
      ...(opts.preflight ? { preflight: opts.preflight } : {}),
    },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (event) => void events.push(event), outcome: (row) => void rows.push(row) },
    human: { ask: async () => ({ kind: "paused" }) },
    steering: runSteeringSource(runKey),
    context: { pack: () => ({ focus: [{ path: "README.md", content: "# fixture" }], facts: [], recall: [] }) },
  };
  return { ports, events, rows, requests, windowAsked };
}

const finish = (): ModelCompletion => ({ content: "", toolCalls: [{ id: "c1", name: "finish", arguments: '{"summary":"Hello! Done."}' }], model: "fake-model" });
const answer = (): ModelCompletion => ({ content: "Hello! Done.", model: "fake-model" });
const listFiles = (): ModelCompletion => ({ content: "", toolCalls: [{ id: "c1", name: "list_files", arguments: "{}" }], model: "fake-model" });

beforeEach(() => resetRunSteering());

describe("conformance — the Brain's entry points run the same task the same way", () => {
  async function trace(entryPoint: EntryPoint, runKey: number): Promise<{ events: RunEvent[]; outcome: RunOutcome; rows: RunOutcomeRow[] }> {
    const h = harness(runKey, [finish, answer]);
    const outcome = await runAgent({ task: TASK, policy: policyFor(entryPoint), ports: h.ports });
    return { events: h.events, outcome, rows: h.rows };
  }

  it("gives one RunEvent trace and one outcome on vscode, web and rovr", async () => {
    const runs = await Promise.all(ENTRY_POINTS.map((entryPoint, i) => trace(entryPoint, 810 + i)));
    const [first, ...rest] = runs;
    for (const other of rest) {
      expect(other.events).toEqual(first!.events);
      expect(other.outcome.kind).toEqual(first!.outcome.kind);
    }
    expect(first!.outcome).toMatchObject({ kind: "finished", output: "Hello! Done." });
  });

  it("stamps the surface's label on the uniform outcome row — and nothing else about the run changes", async () => {
    const runs = await Promise.all(ENTRY_POINTS.map((entryPoint, i) => trace(entryPoint, 820 + i)));
    runs.forEach((run, i) => {
      expect(run.rows).toHaveLength(1);
      expect(run.rows[0]?.entryPoint).toBe(ENTRY_POINTS[i]);
    });
    const { entryPoint: _a, ...first } = runs[0]!.rows[0]!;
    for (const run of runs.slice(1)) {
      const { entryPoint: _b, ...row } = run.rows[0]!;
      expect(row).toEqual(first);
    }
  });

  it("opens with the model preflight, which names an unresolved account on every surface", async () => {
    for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
      const h = harness(830 + i, [answer], { preflight: () => ({ byoUnresolved: ["anthropic:expired"] }) });
      await runAgent({ task: TASK, policy: policyFor(entryPoint), ports: h.ports });
      expect(h.events[0]?.kind).toBe("run.started");
      expect(h.events[1]).toMatchObject({ kind: "model.preflight", status: "degraded" });
    }
  });
});

describe("conformance — Stop and steer on the Brain's surfaces", () => {
  it("a Stop (the cell's abort signal) settles the run cancelled and the model is never asked again", async () => {
    for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
      const stop = new AbortController();
      const h = harness(840 + i, [
        () => {
          stop.abort();
          return listFiles();
        },
        () => answer(),
      ]);
      const outcome = await runAgent({ task: TASK, policy: policyFor(entryPoint), ports: h.ports, signal: stop.signal });
      expect(outcome).toMatchObject({ kind: "failed", reason: "cancelled" });
      expect(h.requests).toHaveLength(1);
    }
  });

  it("a message steered mid-run interrupts the turn and is in front of the very next model call", async () => {
    for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
      const runKey = 850 + i;
      const h = harness(runKey, [
        () => {
          queueRunSteering(runKey, "write the update now", { interrupt: true, fromPerson: true });
          return listFiles();
        },
        () => answer(),
      ]);
      await runAgent({ task: TASK, policy: policyFor(entryPoint), ports: h.ports });
      const kinds = h.events.map((e) => e.kind);
      expect(kinds.filter((k) => k === "steer.applied")).toHaveLength(1);
      expect(h.requests[1]?.messages.map((m) => m.content)).toContain("write the update now");
    }
  });

  it("the tools policy sizes its result cap from the transport's window on every surface", async () => {
    for (const [i, entryPoint] of ENTRY_POINTS.entries()) {
      const h = harness(860 + i, [listFiles, answer]);
      await runAgent({ task: TASK, policy: policyFor(entryPoint), ports: h.ports });
      expect(h.windowAsked.length).toBeGreaterThan(0);
    }
  });
});
