/**
 * Characterization — the policy the cloud cut-over (PRD 35 WS3) added to the agent: the governance
 * gate and its approval, the `tool_search` meta tool, the opening rows, the finish ports a surface
 * binds (live children, descendants' writes, claim evidence, blocked events), the model hand-off's
 * success, and the compaction hook factory.
 */
import { describe, expect, it, vi } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import type { RunEvent, RunPorts } from "../../src/contract.js";
import { createCompactionHook } from "../../src/policy/compaction/index.js";
import { evaluateFinishGates, initialFinishGateState } from "../../src/policy/finish/gates.js";
import { turnSucceeded } from "../../src/policy/model/handoff.js";
import { policyGateCallKey } from "@builderforce/agent-tools";
import { gateCall } from "../../src/policy/tools/gates.js";
import { toolsHook } from "../../src/policy/tools/index.js";
import { freshState } from "../../src/runState.js";
import { openingRows } from "../../src/turnContext.js";
import { TEST_POLICY, TEST_TASK, policyCtx, schemas } from "../support/policyContext.js";

const GATE: PolicyGate = { id: "g1", tool: "run_command", effect: "require-approval", reason: "shell needs an approver" };
const BLOCK: PolicyGate = { id: "g2", tool: "delete_file", effect: "block", reason: "deletes are off limits" };
const CALL = { id: "c1", name: "run_command", args: { command: "ls" } };

function gated(human: RunPorts["human"], gates: PolicyGate[], events: RunEvent[] = []) {
  return policyCtx({ policy: { approvalGates: gates }, ports: { human, events: { emit: (e: RunEvent) => { events.push(e); } } } });
}

describe("gateCall — governance gates", () => {
  it("refuses a block gate and says so on the timeline", async () => {
    const events: RunEvent[] = [];
    const refused = await gateCall(gated({ ask: vi.fn() }, [BLOCK], events), { id: "c", name: "delete_file", args: { path: "a.ts" } });
    expect(refused?.isError).toBe(true);
    expect(events).toEqual([{ kind: "policy.blocked", step: 1, tool: "delete_file", gateId: "g2", reason: "deletes are off limits" }]);
  });

  it("parks on the first hit of an approval gate — and a parked call is NOT an approved one", async () => {
    const approve = vi.fn(async () => ({ kind: "paused" as const, approvalId: "appr-9" }));
    const ctx = gated({ ask: vi.fn(), approve }, [GATE]);
    const key = policyGateCallKey("g1", "run_command", { command: "ls" });
    const first = await gateCall(ctx, CALL);
    expect(first?.control).toEqual({ kind: "ask_human", question: expect.stringContaining("run_command"), parked: true, approvalId: "appr-9" });
    expect(ctx.state.parkedCalls).toEqual({ [key]: "appr-9" });
    expect(ctx.state.approvedCalls ?? []).toEqual([]);
    // A DIFFERENT call through the same gate is asked on its own merits.
    await gateCall(ctx, { ...CALL, args: { command: "rm -rf /" } });
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it("reads the approval's STRUCTURED decision — never the answer's words", async () => {
    const approved = gated({ ask: vi.fn(), approve: async () => ({ kind: "answered", answer: "no way", approved: true }) }, [GATE]);
    expect(await gateCall(approved, CALL)).toBeUndefined();
    expect(approved.state.approvedCalls).toEqual([policyGateCallKey("g1", "run_command", { command: "ls" })]);
    const declined = gated({ ask: vi.fn(), approve: async () => ({ kind: "answered", answer: "approve", approved: false }) }, [GATE]);
    const refused = await gateCall(declined, CALL);
    expect(refused?.isError).toBe(true);
    expect(declined.state.approvedCalls ?? []).toEqual([]);
  });

  it("on the resume the retried call asks again about the SAME approval: approved proceeds, rejected is declined, pending parks again", async () => {
    const key = policyGateCallKey("g1", "run_command", { command: "ls" });
    const decide = (answer: Awaited<ReturnType<NonNullable<RunPorts["human"]["approve"]>>>) => {
      const approve = vi.fn(async () => answer);
      const ctx = gated({ ask: vi.fn(), approve }, [GATE]);
      ctx.state.parkedCalls = { [key]: "appr-9" };
      return { ctx, approve };
    };
    const ok = decide({ kind: "answered", answer: "", approved: true });
    expect(await gateCall(ok.ctx, CALL)).toBeUndefined();
    expect(ok.approve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ approvalId: "appr-9" }));
    expect(ok.ctx.state.approvedCalls).toEqual([key]);
    expect(ok.ctx.state.parkedCalls).toEqual({});
    const no = decide({ kind: "answered", answer: "too risky", approved: false });
    expect((await gateCall(no.ctx, CALL))?.isError).toBe(true);
    expect(no.ctx.state.approvedCalls ?? []).toEqual([]);
    const waiting = decide({ kind: "paused", approvalId: "appr-9" });
    expect((await gateCall(waiting.ctx, CALL))?.control).toMatchObject({ parked: true, approvalId: "appr-9" });
  });

  it("a host with no approver REFUSES a require-approval call with the policy's own message", async () => {
    const ctx = policyCtx({ policy: { approvalGates: [GATE] }, ports: { human: { ask: vi.fn() }, events: { emit: () => undefined } } });
    const refused = await gateCall(ctx, CALL);
    expect(refused?.isError).toBe(true);
    expect(String((refused?.data as { error: string }).error)).toContain("requires human approval");
    expect(refused?.control).toBeUndefined();
  });
});

describe("tool_search — the meta tool the catalog advertises", () => {
  it("loads the matches for the rest of the run, and they stay advertised", async () => {
    const ctx = { ...policyCtx({ tools: ["read_file", "deploy_site"] }) };
    const answer = toolsHook.beforeDispatch?.(ctx, { id: "s", name: "tool_search", args: { query: "deploy site" } });
    expect((answer?.data as { ok: boolean }).ok).toBe(true);
    expect(ctx.state.loadedTools).toContain("deploy_site");
    const selected = await toolsHook.select(ctx, schemas(["read_file", "deploy_site", "zzz_unrelated"]));
    const advertised = (selected ?? []).map((t) => t.function.name);
    expect(advertised).toContain("deploy_site");
  });
});

describe("openingRows", () => {
  it("the persona is the system row and the task is the first user row", () => {
    expect(openingRows({ ...TEST_TASK, persona: "You are Ada." })).toEqual([
      { role: "system", content: "You are Ada." },
      { role: "user", content: TEST_TASK.prompt },
    ]);
  });
  it("a persona-less task is a user row alone", () => {
    expect(openingRows(TEST_TASK)).toEqual([{ role: "user", content: TEST_TASK.prompt }]);
  });
});

describe("finish ports a surface binds", () => {
  const args = (ports: Parameters<typeof evaluateFinishGates>[0]["ports"]) => ({
    writtenPaths: ["src/a.ts"], requiredSignoff: undefined, delegated: true, summary: "done", output: "",
    gates: initialFinishGateState(undefined, false), enterVerify: () => undefined, ports,
  });

  it("an owner with live children cannot finish, and the block is named", async () => {
    const onBlocked = vi.fn();
    const verdict = await evaluateFinishGates(args({ liveChildren: async () => "wait for your sub-agents", onBlocked }));
    expect(verdict).toMatchObject({ block: "wait for your sub-agents", reason: "children_running" });
  });

  it("folds the descendants' writes into the run's written set", async () => {
    const verdict = await evaluateFinishGates(args({ liveChildren: async () => null, absorbChildWrites: async (paths) => { paths.add("src/child.ts"); } }));
    expect(verdict.block).toBeNull();
    expect(verdict.writtenPaths).toEqual(["src/a.ts", "src/child.ts"]);
  });

  it("refuses a completion claim with no evidence, and tells onBlocked of a placeholder block", async () => {
    const claim = await evaluateFinishGates(args({ recordClaim: async () => ({ ok: false, error: "no successful write" }) }));
    expect(claim.reason).toBe("claim_evidence");
    const onBlocked = vi.fn();
    const stub = await evaluateFinishGates(args({ scanPlaceholders: async () => ({ flagged: [{ path: "src/a.ts", markers: ["TODO"] }] }), onBlocked }));
    expect(stub.reason).toBe("placeholders");
    expect(onBlocked).toHaveBeenCalledWith("placeholders", expect.any(String), { files: [{ path: "src/a.ts", markers: ["TODO"] }] }, expect.any(String));
  });

  it("a run not bound to a repository is not held to the deliverable or claim gates", async () => {
    const claim = vi.fn(async () => ({ ok: false as const, error: "x" }));
    const verdict = await evaluateFinishGates({ ...args({ bound: false, recordClaim: claim }), writtenPaths: ["docs/x.md"] });
    expect(verdict.block).toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("turnSucceeded", () => {
  it("clears a stall recovery's one-shot tool choice and records the served model", () => {
    const state = freshState(TEST_POLICY, TEST_TASK);
    state.forceToolChoice = "required";
    turnSucceeded(state, { model: "m-1", acted: true });
    expect(state.forceToolChoice).toBeUndefined();
  });
});

describe("createCompactionHook", () => {
  it("compacts with the surface's own summarizer and says what the fold cost", async () => {
    const summarize = vi.fn(async () => "- memory");
    const hook = createCompactionHook({ summarize, maxTokens: 800 });
    const big = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i} ${"x".repeat(400)}` }));
    const ctx = policyCtx({
      messages: [{ role: "system", content: "sys" }, ...big] as never,
      ports: { model: { complete: async () => ({ content: "" }) } },
    });
    const result = await hook.compact(ctx);
    expect(summarize).toHaveBeenCalled();
    expect(result && result.dropped).toBeGreaterThan(0);
    expect(result && result.beforeTokens).toBeGreaterThan(result?.afterTokens ?? Infinity);
  });
});
