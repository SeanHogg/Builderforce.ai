/** openRun — the one entry: refuses a missing entryPoint, folds the route in, and composes a surface's ports into the modules. */
import { describe, expect, it, vi } from "vitest";
import type { Capability } from "@builderforce/agent-tools";
import { openRun, routeRun, workFinishPorts, type CloseOutPort, type ModelCompletion, type RunEvent, type RunOutcomeRow, type RunPorts, type WorkEvidence } from "../../src/index.js";
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
  it("gives questions a final answer turn after six tool rounds even with progress levers off", async () => {
    const { ports } = harness([
      ...Array.from({ length: 6 }, (_, i) => call(`read-${i}`, i % 2 ? "remember_fact" : "read_file", { path: `src/${i}.ts` })),
      { content: "The handler calls the registry." },
    ]);
    const complete = vi.spyOn(ports.model, "complete");
    const outcome = await openRun({ task: { ...TEST_TASK, prompt: "How does this handler work?" }, policy: TEST_POLICY, ports });
    expect(outcome.kind).toBe("finished");
    expect(complete).toHaveBeenCalledTimes(7);
    expect(complete.mock.calls[6]?.[0].tools ?? []).toEqual([]);
    expect(JSON.stringify(complete.mock.calls[6]?.[0].messages)).toContain("Answer the question now");
  });
  it("holds prose finish for assigned work, reads evidence in a batch, and emits the terminal scorecard", async () => {
    const { ports, events } = harness([{ content: "Done." }, { content: "One checked and one handed off." }]);
    const rows: RunOutcomeRow[] = [];
    ports.events.outcome = (row) => { rows.push(row); };
    const evidence = vi.fn<(ids: readonly string[]) => Promise<readonly WorkEvidence[]>>()
      .mockResolvedValueOnce([{ id: "A", status: "done", detail: "First check passed" }])
      .mockResolvedValueOnce([
        { id: "A", status: "done", detail: "First check passed" },
        { id: "B", status: "in_review", detail: "Review requested" },
      ]);
    const outcome = await openRun({
      task: { ...TEST_TASK, assignedWork: [{ id: "A", criteria: ["First check"] }, { id: "B", criteria: ["Second check"] }] },
      policy: TEST_POLICY, ports, surface: { finish: { workEvidence: evidence } },
    });
    expect(events.find((event) => event.kind === "finish.blocked")).toMatchObject({ reason: "linked_work_open" });
    expect(evidence.mock.calls).toEqual([[["A", "B"]], [["A", "B"]]]);
    expect(outcome.kind).toBe("finished");
    expect(rows).toMatchObject([{ work: { assigned: 2, done: 1, inReview: 1, blocked: 0, open: 0 } }]);
  });

  it("opens with host-settled work visible and keeps it unresolved until host evidence arrives", async () => {
    const { ports } = harness([{ content: "Ready for review." }]);
    const complete = vi.spyOn(ports.model, "complete");
    const assigned = [{ id: "42", criteria: ["Fix the report"] }];
    const outcome = await openRun({
      task: { ...TEST_TASK, assignedWork: assigned }, policy: TEST_POLICY, ports,
      surface: { finish: workFinishPorts({ assigned, settleAfterRun: true }) },
    });
    expect(outcome.kind).toBe("finished");
    expect(outcome.state.work).toEqual(assigned);
    expect(JSON.stringify(complete.mock.calls[0]?.[0].messages)).toContain("Fix the report");
  });

  it("keeps governing instructions ahead of prepared history", async () => {
    const { ports } = harness([{ content: "Done." }]);
    const complete = vi.spyOn(ports.model, "complete");
    const transcript = [{ role: "user" as const, content: "Earlier" }, { role: "assistant" as const, content: "Recorded" }, { role: "user" as const, content: "Now", task: true as const }];
    await openRun({
      task: { ...TEST_TASK, persona: "Host persona", transcript },
      policy: TEST_POLICY, ports,
    });
    expect(complete.mock.calls[0]?.[0].messages.slice(0, 4)).toEqual([
      { role: "system", content: "Host persona" }, ...transcript,
    ]);
  });

  it("settles a closed native run on completed check evidence and drops evidence made stale by an edit", async () => {
    const check = (command: string, id: string) => call(id, "exec", { command });
    for (const [trailing, verdict] of [
      [[], "failed"],
      [[call("write", "write", { path: "src/a.ts" })], undefined],
      [[check("npm run typecheck || exit 0", "masked")], undefined],
    ] as const) {
      const { ports } = harness([
        check("npm run typecheck", "t1"), check("pnpm test", "t2"), ...trailing, { content: "End of the run." },
      ]);
      delete ports.capabilities;
      const execute = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
        data: "tool output",
        ...(args.command ? { meta: { details: { exitCode: args.command === "npm run typecheck" ? 1 : 0 } } } : {}),
      }));
      ports.platform = { ...ports.platform!, schemas: () => schemas(["exec", "write"]), execute };
      const rows: RunOutcomeRow[] = [];
      ports.events.outcome = (row) => { rows.push(row); };
      const outcome = await openRun({
        task: { ...TEST_TASK, prompt: "Report the checks" },
        policy: TEST_POLICY, ports, surface: { verify: { observeNativeChecks: true } },
      });
      // An unclassified shell call may have changed the workspace, so it clears prior proof.
      expect(outcome.kind).toBe("finished");
      expect(execute).toHaveBeenCalledTimes(2 + trailing.length);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.verify).toBe(verdict ?? "not-run");
    }
  });

  it("refuses a prose finish on a failed configured check and records the next passing result", async () => {
    const { ports, events } = harness([
      call("w1", "write_file", { path: "src/a.ts", content: "export const a = 1;" }),
      { content: "The file is updated." },
      { content: "The updated file passes the check." },
    ]);
    const runFor = vi.fn().mockResolvedValueOnce({ exitCode: 1 }).mockResolvedValueOnce({ exitCode: 0 });
    const outcome = await openRun({
      task: TEST_TASK, policy: { ...TEST_POLICY, verify: "declared-checks" }, ports,
      surface: { verify: {
        surface: "on-prem", shell: { runFor },
        sandbox: { read: async () => '{"scripts":{"test":"vitest"}}', list: async () => [] },
      } },
    });
    expect(events).toContainEqual(expect.objectContaining({ kind: "finish.blocked", reason: "verify" }));
    expect(runFor).toHaveBeenCalledTimes(2);
    expect(outcome.kind).toBe("finished");
    expect(outcome.state.telemetry?.verify).toBe("passed");
  });

  it("regression: throws without policy.entryPoint, never defaulting it", async () => {
    const { ports } = harness([]);
    await expect(openRun({ task: TEST_TASK, policy: { ...TEST_POLICY, entryPoint: "" as never }, ports })).rejects.toThrow("openRun: policy.entryPoint is required");
    await expect(openRun({ task: TEST_TASK, policy: { ...TEST_POLICY, entryPoint: undefined as never }, ports })).rejects.toThrow("openRun: policy.entryPoint is required");
  });

  it("composes recorded preflight facts without checking the host or repeating its notices", async () => {
    const { ports, events } = harness([{ content: "done" }]);
    const preflight = vi.fn(() => ({ byoUnresolved: [] }));
    ports.model.preflight = preflight;
    const outcome = await openRun({
      task: TEST_TASK, policy: TEST_POLICY, ports,
      surface: { preflight: { byoUnresolved: ["anthropic:expired"] } },
    });
    expect(outcome.kind).toBe("finished");
    expect(outcome.state.preflight).toBe("degraded:anthropic:expired");
    expect(events.filter((event) => event.kind === "model.preflight")).toEqual([
      { kind: "model.preflight", step: 0, status: "degraded", notices: [] },
    ]);
    expect(preflight).not.toHaveBeenCalled();
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
      const closeOut = vi.fn<CloseOutPort>(async () => undefined);
      const outcome = await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, surface: { closeOut } });
      expect(outcome.kind).toBe("finished");
      expect(closeOut).toHaveBeenCalledTimes(1);
      expect(closeOut.mock.calls[0]?.[1]).toBe("finish");
    });

    it("regression: a failed run that never reached the finish gate closes out once, in settled (upkeep-only) mode", async () => {
      const { ports } = harness([]);
      ports.model = { complete: async () => { throw new Error("provider down"); } };
      const closeOut = vi.fn<CloseOutPort>(async () => undefined);
      const outcome = await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, surface: { closeOut } });
      expect(outcome.kind).toBe("failed");
      expect(closeOut).toHaveBeenCalledTimes(1);
      expect(closeOut.mock.calls[0]?.[1]).toBe("settled");
    });

    it("a stopped run (user Stop) never closes out", async () => {
      const { ports } = harness([{ content: "done" }]);
      const controller = new AbortController();
      controller.abort();
      const closeOut = vi.fn<CloseOutPort>(async () => undefined);
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

  it("a child traces no independent route", async () => {
    const { ports, events } = harness([{ content: "done" }]);
    await openRun({ task: TEST_TASK, policy: TEST_POLICY, ports, route: { request: "x", child: true } });
    expect(events.some((e) => e.kind === "run.routed")).toBe(false);
  });

  it("uses the shared default when the surface omits routing settings", async () => {
    const { ports, events } = harness([{ content: "done" }]);
    const outcome = await openRun({ task: { ...TEST_TASK, prompt: "Fix the typo in the README heading" }, policy: TEST_POLICY, ports });
    expect(events.find((e) => e.kind === "run.routed")).toMatchObject({ route: "full" });
    expect(outcome.state.pipeline?.route).toBe("full");
  });

  it("keeps the admitted route when resuming with different routing settings", async () => {
    const { ports, events } = harness([call("w1", "write_file", { path: "a.ts", content: "fix" }), { content: "Done." }]);
    const task = { ...TEST_TASK, prompt: "Fix the typo in the README heading" };
    const first = await openRun({ task, policy: TEST_POLICY, ports, maxSteps: 1, route: { request: task.prompt, routing: { mode: "auto" } } });
    expect(first.kind).toBe("yielded");
    expect(first.state.pipeline?.route).toBe("quick");
    const resumed = await openRun({
      task, policy: TEST_POLICY, ports, resume: first.state,
      route: { request: task.prompt, routing: { mode: "always" } },
    });
    expect(resumed.kind).toBe("finished");
    expect(resumed.state.pipeline).toEqual(first.state.pipeline);
    expect(events.filter((event) => event.kind === "run.routed")).toHaveLength(1);
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
