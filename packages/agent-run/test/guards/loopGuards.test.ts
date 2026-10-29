/**
 * Test — the in-run guards: D8 parallel reads, D7 post-edit check, D1 verifier cascade,
 * A3 progress detector, and the sandbox's own checks as the D1 code unit's verifier.
 *
 * Ported from `api/src/application/runtime/costLoop/loopGuards.test.ts`, retargeted to
 * `packages/agent-run/src/policy/guards` (`RunGuards` + the `CascadeSession`). The
 * engine's env-string levers are the constructor's `GuardLevers`; the engine's db /
 * telemetry / difficulty-gate couplings are the `GuardPorts`. Assertions are the
 * source's, unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialRunPolicy } from "@builderforce/run-policy";
import type { DifficultyFeatures } from "@builderforce/difficulty-router";
import { RunGuards, type GuardLevers, type GuardPorts } from "../../src/policy/guards/index.js";
import type { PolicyToolCall } from "../../src/policy/hooks.js";

const RANK: Record<string, number> = { weak: 0, mid: 1, strong: 2 };
const ladder = { candidates: ["strong", "weak", "mid"], rankOf: (m: string) => RANK[m] ?? 1 };
const feat = (actionType: string): DifficultyFeatures =>
  ({ role: "developer", actionType, promptTokens: 10, toolCount: 3, turnIndex: 0 }) as DifficultyFeatures;

const ON: GuardLevers = { a3_progress_detector: true, d7_deterministic_handlers: true, d1_verifier_cascade: true, d8_parallel_tool_calls: true };
const OFF: GuardLevers = {};

const call = (id: string, name: string, args: Record<string, unknown>): PolicyToolCall => ({ id, name, args });
const ok = (name: string) => ({ data: { ok: true, echoed: name } });

function harness(levers: GuardLevers = ON, model = "weak") {
  const outcome = vi.fn(async () => undefined);
  const skip = vi.fn(async () => false);
  const record = vi.fn(async (_e: { tool: string }) => undefined);
  let state = initialRunPolicy({ pinnedModel: model, startPhase: "code", pinReleasable: true, lockAfterFirstSuccess: true });
  const ports: GuardPorts = {
    model: { get: () => state, set: (next) => { state = { ...state, ...next }; } },
    resolvedModel: () => state.model,
    features: () => ({ actionType: "bugfix" }) as never,
    pause: vi.fn(async () => ({ approvalId: "appr-1" })),
    onEvent: record,
    cascade: { recordOutcome: outcome, shouldSkipWeakAttempt: skip, weakPassRate: async () => undefined, ladder },
  };
  const guards = new RunGuards(levers, undefined, ports);
  return { guards, ports, model: () => state, outcome, skip, record };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RunGuards — levers off", () => {
  it("persists nothing and carries no tail", () => {
    const { guards } = harness(OFF);
    expect(guards.snapshot()).toEqual({});
    expect(guards.tailSections().filter(Boolean)).toEqual([]);
  });
});

describe("RunGuards — D8 / D7", () => {
  it("offers the read-only port for read tools only", () => {
    const { guards } = harness(ON);
    expect(guards.isReadOnly("read_file")).toBe(true);
    expect(guards.isReadOnly("write_file")).toBe(false);
  });

  it("notes a broken write on its own tool result, and leaves a clean one alone", async () => {
    const { guards, ports } = harness(ON);
    const bad = await guards.checkEdit(call("a", "write_file", { path: "cfg.json", content: '{ "a": ' }), ok("write_file"), ports);
    expect(String((bad as { note?: string }).note)).toMatch(/Post-edit check FAILED[\s\S]*cfg\.json/);
    const good = await guards.checkEdit(call("b", "write_file", { path: "cfg.json", content: '{ "a": 1 }' }), ok("write_file"), ports);
    expect((good as { note?: string }).note).toBeUndefined();
  });
});

describe("RunGuards — D1 cascade", () => {
  it("escalates one tier when a turn's edit fails its check, and records a training row", async () => {
    const { guards, ports, model, outcome } = harness(ON);
    await guards.seedModel(model(), { strict: false, ladder, features: feat("bugfix") }).then((s) => ports.model?.set(s));
    await guards.checkEdit(call("a", "write_file", { path: "cfg.json", content: "{" }), ok("write_file"), ports);
    await guards.endTurn(2, ports);
    expect(model().model).toBe("mid");
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ weakModel: "weak", passed: false, verifier: "changed_files" }));
    expect(ports.onEvent).toHaveBeenCalledWith(expect.objectContaining({ tool: "model.escalated" }));
  });

  it("escalates on a finish the gates refused, but not on CI still running", async () => {
    const { guards, ports, model } = harness(ON);
    await guards.seedModel(model(), { strict: false, ladder, features: feat("bugfix") }).then((s) => ports.model?.set(s));
    expect(await guards.finish({ block: "CI is still running", reason: "branch_ci_pending" }, 1, ports)).toBe("CI is still running");
    expect(model().model).toBe("weak");
    expect(await guards.finish({ block: "stub code", reason: "placeholders" }, 2, ports)).toBe("stub code");
    expect(model().model).toBe("mid");
    expect(guards.tailSections().join("\n")).toContain("stub code");
  });

  it("starts a soft seed on the weakest tier, unless the difficulty router says skip", async () => {
    const a = harness(ON, "strong");
    const seeded = await a.guards.seedModel(a.model(), { strict: false, ladder, features: feat("bugfix") });
    expect(seeded.model).toBe("weak");
    a.skip.mockResolvedValue(true);
    const b = harness(ON, "strong");
    b.skip.mockResolvedValue(true);
    expect((await b.guards.seedModel(b.model(), { strict: false, ladder, features: feat("bugfix") })).model).toBe("strong");
    const c = harness(ON, "strong");
    expect((await c.guards.seedModel(c.model(), { strict: true, ladder, features: feat("bugfix") })).model).toBe("strong");
  });
});

describe("RunGuards — A3 progress detector", () => {
  async function revertTurn(guards: RunGuards, ports: GuardPorts, step: number) {
    for (const [i, content] of ["A", "B", "A"].entries()) {
      const c = call(`c${step}-${i}`, "write_file", { path: "notes.md", content });
      guards.observe(c, ok("write_file"));
      await guards.checkEdit(c, ok("write_file"), ports);
    }
    await guards.endTurn(step, ports);
  }

  it("steers on the first trip, escalates on the second, pauses on the third", async () => {
    const { guards, ports, model } = harness({ a3_progress_detector: true, d1_verifier_cascade: false });
    await guards.seedModel(model(), { strict: false, ladder, features: feat("bugfix") }).then((s) => ports.model?.set(s));
    await revertTurn(guards, ports, 1);
    expect(guards.tailSections().join("\n")).toContain("notes.md");
    await revertTurn(guards, ports, 2);
    expect(model().model).toBe("mid");
    await revertTurn(guards, ports, 3);
    const parked = await guards.beforeDispatchPause(ports);
    expect(parked?.control).toMatchObject({ kind: "ask_human", approvalId: "appr-1" });
    expect(ports.pause).toHaveBeenCalledTimes(1);
    // The park is spent: the next call runs.
    expect(await guards.beforeDispatchPause(ports)).toBeUndefined();
  });

  it("keeps its tallies across a durable tick", async () => {
    const levers: GuardLevers = { a3_progress_detector: true };
    const first = harness(levers);
    for (const [i, content] of ["A", "B"].entries()) {
      const c = call(`c${i}`, "write_file", { path: "n.md", content });
      first.guards.observe(c, ok("write_file"));
      await first.guards.checkEdit(c, ok("write_file"), first.ports);
    }
    await first.guards.endTurn(0, first.ports);
    const resumed = new RunGuards(levers, JSON.parse(JSON.stringify(first.guards.snapshot())), first.ports);
    const c = call("c2", "write_file", { path: "n.md", content: "A" });
    resumed.observe(c, ok("write_file"));
    await resumed.checkEdit(c, ok("write_file"), first.ports);
    await resumed.endTurn(1, first.ports);
    expect(resumed.tailSections().join("\n")).toContain("n.md");
  });
});

describe("RunGuards — the sandbox's own checks (D1 verifier, D7 steer)", () => {
  const failing = { passed: false, verifier: "post_edit_checks", reason: "tsc: 2 errors", steer: "Post-edit checks FAILED: src/a.ts(3,1) error TS2304" };

  it("a failing sandbox check overrules a passing static read and escalates the turn", async () => {
    const { guards, ports, model, outcome } = harness(ON);
    await guards.seedModel(model(), { strict: false, ladder, features: feat("bugfix") }).then((s) => ports.model?.set(s));
    ports.checks = async () => failing;
    await guards.checkEdit(call("a", "write_file", { path: "cfg.json", content: "{}" }), ok("write_file"), ports);
    await guards.endTurn(2, ports);
    expect(model().model).toBe("mid");
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ passed: false, verifier: "post_edit_checks" }));
  });

  it("shows the model the failures on the next turn under D7, and only that turn", async () => {
    const { guards, ports } = harness(ON);
    ports.checks = async () => failing;
    await guards.checkEdit(call("a", "write_file", { path: "cfg.json", content: "{}" }), ok("write_file"), ports);
    await guards.endTurn(1, ports);
    expect(guards.tailSections().join("\n")).toContain("TS2304");
    // A turn with no edits drains nothing and clears the note.
    await guards.endTurn(2, ports);
    expect(guards.tailSections().join("\n")).not.toContain("TS2304");
  });

  it("runs the checks for D1 alone without showing the model their failures", async () => {
    const { guards, ports } = harness({ d1_verifier_cascade: true });
    const checks = vi.fn(async () => failing);
    ports.checks = checks;
    await guards.checkEdit(call("a", "write_file", { path: "cfg.json", content: "{}" }), ok("write_file"), ports);
    await guards.endTurn(1, ports);
    expect(checks).toHaveBeenCalledTimes(1);
    expect(guards.tailSections().join("\n")).not.toContain("TS2304");
  });

  it("never asks the sandbox on a turn with no edit", async () => {
    const { guards, ports } = harness(ON);
    const checks = vi.fn(async () => failing);
    ports.checks = checks;
    guards.observe(call("r", "read_file", { path: "cfg.json" }), ok("read_file"));
    await guards.endTurn(1, ports);
    expect(checks).not.toHaveBeenCalled();
  });
});

// PRD 35 WS8p: a turn that says the run has what it needs, then only reads, is an unkept
// claim — the turn's text reaches A3 (`noteTurnText`), so the second one trips here too.
describe("RunGuards — A3 readiness claims", () => {
  async function claimTurn(guards: RunGuards, ports: GuardPorts, step: number) {
    guards.noteTurnText("Now I have everything I need.");
    const read = call(`r${step}`, "read_file", { path: `docs/file-${step}.md` });
    guards.observe(read, ok("read_file"));
    await guards.endTurn(step, ports);
  }

  it("steers on the second claim that only read, though each read was a new file", async () => {
    const { guards, ports } = harness({ a3_progress_detector: true, d1_verifier_cascade: false });
    await claimTurn(guards, ports, 1);
    expect(guards.tailSections().join("\n")).not.toContain("you have said");
    await claimTurn(guards, ports, 2);
    expect(guards.tailSections().join("\n")).toContain("you have said 2 times that you have what you need");
  });
});
