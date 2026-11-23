/** openRun — the one entry: refuses a missing entryPoint, folds the route in, and composes a surface's ports into the modules. */
import { describe, expect, it, vi } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { openRun, routeRun, type ModelCompletion, type RunEvent, type RunPorts } from "../../src/index.js";
import { routedPolicy } from "../../src/openRun.js";
import { schemas, TEST_POLICY, TEST_TASK } from "../support/policyContext.js";

const HOLD = "Epic #6902 is still in_progress: continue executing.";

function harness(script: ModelCompletion[], closed = true): { ports: RunPorts; events: RunEvent[] } {
  let n = 0;
  const events: RunEvent[] = [];
  const ports: RunPorts = {
    model: { complete: async () => script[n++] ?? { content: "done" } },
    capabilities: { capabilities: new Set<Capability>() },
    store: { load: () => undefined, save: () => undefined },
    events: { emit: (e) => { events.push(e); } },
    human: { ask: async () => ({ kind: "paused" }) },
    context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
    platform: {
      closed,
      verbatimText: true,
      schemas: () => schemas(["write_file"]),
      selection: { query: "", limit: 50, required: new Set<string>() },
      execute: async () => ({ data: { ok: true } }),
    },
  };
  return { ports, events };
}

const call = (id: string, name: string, args: Record<string, unknown>): ModelCompletion => ({ content: "", toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const WRITE_THEN_FINISH = (): ModelCompletion[] => [
  call("e1", "write_file", { path: "src/a.ts", content: "export const a = 1;" }),
  call("f1", "finish", { summary: "Implemented src/a.ts." }),
  { content: "Implemented src/a.ts." },
];

describe("openRun", () => {
  it("regression: throws without policy.entryPoint, never defaulting it", async () => {
    const { ports } = harness([]);
    await expect(openRun({ task: TEST_TASK, policy: { ...TEST_POLICY, entryPoint: "" as never }, ports })).rejects.toThrow("openRun: policy.entryPoint is required");
    await expect(openRun({ task: TEST_TASK, policy: { ...TEST_POLICY, entryPoint: undefined as never }, ports })).rejects.toThrow("openRun: policy.entryPoint is required");
  });

  it("a surface's finish.openWork holds the finish until it returns null", async () => {
    const { ports } = harness(WRITE_THEN_FINISH());
    const holds = [HOLD, null];
    const openWork = vi.fn(async () => holds.shift() ?? null);
    const outcome = await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, surface: { finish: { openWork } } });
    expect(outcome.kind).toBe("finished");
    expect(openWork).toHaveBeenCalled();
  });

  it("regression: a closeOut that throws is traced and never refuses the finish", async () => {
    // An OPEN platform: the shared registry's `finish` tool is what reaches the finish gate (a closed one answers `finish` itself).
    const { ports, events } = harness([call("f1", "finish", { summary: "Implemented src/a.ts." }), { content: "Implemented src/a.ts." }], false);
    const closeOut = vi.fn(async () => { throw new Error("ticket service down"); });
    const outcome = await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, surface: { closeOut } });
    expect(outcome.kind).toBe("finished");
    expect(closeOut).toHaveBeenCalled();
    const traced = events.find((e) => e.kind === "finish.close_out_error");
    expect(traced).toMatchObject({ kind: "finish.close_out_error", reason: "ticket service down" });
  });

  describe("close-out on every settle", () => {
    it("a finished run closes out once, in finish mode", async () => {
      const { ports } = harness([call("f1", "finish", { summary: "Implemented src/a.ts." }), { content: "Implemented src/a.ts." }], false);
      const closeOut = vi.fn(async () => undefined);
      const outcome = await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, surface: { closeOut } });
      expect(outcome.kind).toBe("finished");
      expect(closeOut).toHaveBeenCalledTimes(1);
      expect(closeOut.mock.calls[0]?.[1]).toBe("finish");
    });

    it("regression: a failed run that never reached the finish gate closes out once, in settled (upkeep-only) mode", async () => {
      const { ports } = harness([]);
      ports.model = { complete: async () => { throw new Error("provider down"); } };
      const closeOut = vi.fn(async () => undefined);
      const outcome = await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, surface: { closeOut } });
      expect(outcome.kind).toBe("failed");
      expect(closeOut).toHaveBeenCalledTimes(1);
      expect(closeOut.mock.calls[0]?.[1]).toBe("settled");
    });

    it("a stopped run (user Stop) never closes out", async () => {
      const { ports } = harness([{ content: "done" }]);
      const controller = new AbortController();
      controller.abort();
      const closeOut = vi.fn(async () => undefined);
      const outcome = await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, signal: controller.signal, surface: { closeOut } });
      expect(outcome).toMatchObject({ kind: "failed", reason: "cancelled" });
      expect(closeOut).not.toHaveBeenCalled();
    });
  });

  it("a route folds its start into the model policy and is traced once after run.started", async () => {
    const { ports, events } = harness([{ content: "done" }]);
    const outcome = await openRun({
      task: TEST_TASK,
      policy: { ...TEST_POLICY, modelStart: { plain: true } },
      ports,
      route: { request: "Rename the helper in utils.ts", routing: { mode: "auto", threshold: 1, quickModel: "fast-coder" } },
    });
    expect(outcome.kind).toBe("finished");
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "run.routed")).toHaveLength(1);
    expect(kinds.indexOf("run.routed")).toBe(kinds.indexOf("run.started") + 1);
    expect(events.find((e) => e.kind === "run.routed")).toMatchObject({ route: "quick" });
    expect(outcome.state.model.phase).toBe("code");
  });

  it("an unrouted run (no routing) traces no route", async () => {
    const { ports, events } = harness([{ content: "done" }]);
    await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, route: { request: "x" } });
    expect(events.some((e) => e.kind === "run.routed")).toBe(false);
  });

  it("a run whose route is already decided is not routed again, and is traced as the one run.routed", async () => {
    const { ports, events } = harness([{ content: "done" }]);
    const input = { request: "Rename the helper in utils.ts", routing: { mode: "auto" as const, threshold: 1, quickModel: "fast-coder" } };
    const decided = routeRun(input);
    const outcome = await openRun({ task: TEST_TASK, policy: { ...TEST_POLICY, modelStart: { plain: true } }, ports, route: { input: { ...input, routing: { mode: "always" } }, decided } });
    expect(events.filter((e) => e.kind === "run.routed")).toHaveLength(1);
    expect(events.find((e) => e.kind === "run.routed")).toMatchObject({ route: "quick" });
    expect(outcome.state.model.phase).toBe("code");
  });
});

describe("routedPolicy", () => {
  const QUICK = { request: "Rename the helper in utils.ts", routing: { mode: "auto" as const, threshold: 1, quickModel: "fast-coder" } };

  it("regression: a cloud-shaped policy (no `plain`, a delegated role) routed with no pipeline keeps its model policy", () => {
    const cloud = { ...TEST_POLICY, modelStart: { model: "seed", strict: false, delegatedRole: "reviewer" } };
    const request = { request: "Fix the bug", modelStrict: true };
    const out = routedPolicy(cloud, request, routeRun(request));
    expect(out.modelStart).toEqual({ model: "seed", strict: false, delegatedRole: "reviewer" });
    expect(out.modelStart?.plain).toBeUndefined();
  });

  it("regression: a child route on a policy with no modelStart leaves the model policy unchanged", () => {
    const request = { request: "Fix the bug", child: true };
    const out = routedPolicy(TEST_POLICY, request, routeRun(request));
    expect(out.modelStart).toBeUndefined();
  });

  it("a child on an existing modelStart starts in code, keeping `plain` exactly as it was", () => {
    const request = { request: "Fix the bug", child: true };
    expect(routedPolicy({ ...TEST_POLICY, modelStart: { model: "m" } }, request, routeRun(request)).modelStart).toEqual({ model: "m", startPhase: "code" });
  });

  it("regression: a Brain-shaped plain policy + a quick route gets the quick pin and phase, and skips the verify stage", () => {
    const out = routedPolicy({ ...TEST_POLICY, modelStart: { plain: true, model: "picked" } }, QUICK, routeRun(QUICK));
    expect(out.modelStart).toEqual({ plain: true, model: "fast-coder", startPhase: "code", phaseModels: { code: "fast-coder" } });
    expect(out.skipVerifyStage).toBe(true);
  });

  it("a full route leaves the verify stage on", () => {
    const full = { request: "Rename the helper", routing: { mode: "always" as const } };
    expect(routedPolicy({ ...TEST_POLICY, modelStart: { plain: true } }, full, routeRun(full)).skipVerifyStage).toBeUndefined();
  });
});
