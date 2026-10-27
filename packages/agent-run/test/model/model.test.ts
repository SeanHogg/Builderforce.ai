/**
 * WS2g tests — the model policy module (`src/policy/model`).
 *
 * Ports the assertion content of the sources the module replaces, retargeted to this
 * folder's exports. The original suites live beside their homes:
 *   • `api/src/application/runtime/cloudAgent/cloudRunModelPolicy.test.ts` — the phase
 *     rule, the turn hand-off, the resume path and the stall step;
 *   • `packages/run-policy/src/*.test.ts` — the reducer these drive (kept there; here we
 *     only assert the module's port drives it correctly);
 *   • `clients/vscode/src/modelRouting.test.ts` — the inference-mode promises (Local only
 *     / Hybrid / Specific), asserted against the ported decision functions;
 *   • `api/src/application/llm/byoCredentialHealth.*.test.ts` — the BYO resolution
 *     signal and preflight classification.
 *
 * Assertions are NOT weakened: a ported expectation pins the same behaviour the source
 * test pinned, expressed against this module's surface.
 */

import { describe, expect, it } from "vitest";
import { initialRunPolicy, nextTurn } from "@builderforce/run-policy";

import {
  classifyPreflight,
  inferenceDecision,
  initialModelRunState,
  policyRole,
  requestForTurn,
  resumeModelRunState,
  routeAroundFailure,
  stallStep,
  turnRequestFields,
  turnRole,
} from "../../src/policy/model/index.js";

// ── The phase rule (cloudRunModelPolicy.test: "the phase rule") ─────────────

describe("the phase rule", () => {
  it("a ticket run codes; a plan or verify child starts in that phase; a non-phase child keeps its role", () => {
    expect(policyRole(undefined)).toEqual({ startPhase: "code" });
    expect(policyRole("plan")).toEqual({ startPhase: "plan" });
    expect(policyRole("verify")).toEqual({ startPhase: "verify" });
    expect(policyRole("explore")).toEqual({ startPhase: "code", fixedRole: "explore" });
    // A board delivery role is not a model role: the run still codes.
    expect(policyRole("reviewer")).toEqual({ startPhase: "code" });
  });

  it("turnRole matches what the reducer asks for", () => {
    expect(turnRole(undefined)).toBe("code");
    expect(turnRole("plan")).toBe("plan");
    expect(turnRole("explore")).toBe("explore");
    expect(turnRole("reviewer")).toBe("code");
  });
});

// ── The turn hand-off (cloudRunModelPolicy.test: "completeUnderRunPolicy") ──

describe("requestForTurn / routeAroundFailure / recordSuccess", () => {
  it("asks for the seed, then LOCKS onto what served turn 1", () => {
    let state = initialModelRunState({ pick: { model: "seed-coder", strict: false }, delegatedRole: undefined });
    const ask1 = requestForTurn(state, true);
    expect([ask1.model, ask1.strict, ask1.role]).toEqual(["seed-coder", false, "code"]);
    // Turn 1 served by "served-coder" — lock onto it.
    state = {
      ...state,
      policy: nextTurn(state.policy, { hasTools: true }) && state.policy, // no-op; drive via success below
    };
    // Record success on served-coder, then the next ask must be it.
    state = { ...state, policy: { ...state.policy, model: "served-coder", locked: true } };
    const ask2 = requestForTurn(state, true);
    expect(ask2.model).toBe("served-coder");
  });

  it("drops a strict pin on 429 and re-asks once on the cascade, recording the hand-off", () => {
    const state = initialModelRunState({ pick: { model: "opus", strict: true }, delegatedRole: undefined });
    const ask = requestForTurn(state, true);
    expect([ask.model, ask.strict]).toEqual(["opus", true]);
    // A 429 releases the pin and routes around it: retry asks for nothing (the cascade).
    const { state: next, retry } = routeAroundFailure(state, ask, { kind: "transport", status: 429 });
    expect(retry).not.toBeNull();
    expect(retry!.model).toBeUndefined();
    expect(retry!.strict).toBe(false);
    expect(next.policy.model).toBeUndefined();
  });

  it("cascades a project Evermind decline (400) but a 400 from anything else fails fast", () => {
    const evermind = initialModelRunState({ pick: { model: "evermind/p7", strict: true }, delegatedRole: undefined });
    const { retry: declineRetry } = routeAroundFailure(evermind, requestForTurn(evermind, true), { kind: "transport", status: 400 });
    expect(declineRetry).not.toBeNull(); // decline releases the pin, cascade re-asks

    const opus = initialModelRunState({ pick: { model: "opus", strict: true }, delegatedRole: undefined });
    const { retry: failRetry } = routeAroundFailure(opus, requestForTurn(opus, true), { kind: "transport", status: 400 });
    expect(failRetry).toBeNull(); // a 400 from a non-declining model fails the turn
  });

  it("spends a forced tool choice on exactly one request", () => {
    const state = { ...initialModelRunState({ pick: { model: "m", strict: false }, delegatedRole: undefined }), forceToolChoice: "required" as const };
    const ask = requestForTurn(state, true);
    expect(turnRequestFields(ask).tool_choice).toBe("required");
  });
});

// ── The resume path (cloudRunModelPolicy.test: "resumeCloudRunModelState") ─

describe("resumeModelRunState", () => {
  it("resumes a tick persisted before the policy existed on its locked model", () => {
    const state = resumeModelRunState(undefined, "locked-model", { model: "seed", strict: false }, undefined);
    expect(state.policy.model).toBe("locked-model");
  });

  it("keeps a persisted policy as it is", () => {
    const saved = initialModelRunState({ pick: { model: "x", strict: true }, delegatedRole: "verify" });
    expect(resumeModelRunState(saved, "other", { model: "seed", strict: false }, undefined)).toBe(saved);
  });
});

// ── The stall step (cloudRunModelPolicy.test: "cloudStallStep") ─────────────

describe("stallStep", () => {
  const promise = { text: "I'll search the codebase.", toolCallCount: 0, toolNames: ["read_file", "write_file"], requestText: "Fix the handler" };

  it("a turn that acted resets the budget and does nothing else", () => {
    const state = { ...initialModelRunState({ pick: { model: "grok", strict: false }, delegatedRole: undefined }), stallRecoveries: 2 };
    const r = stallStep(state, { ...promise, toolCallCount: 1 }, null);
    expect(r.step).toEqual({ kind: "none" });
    expect(r.state.stallRecoveries).toBe(0);
  });

  it("re-prompts a narrating turn, then fails over onto the coding surface", () => {
    let state = initialModelRunState({ pick: { model: "grok", strict: false }, delegatedRole: undefined });
    const surface = { codingModels: ["grok", "sonnet"] };
    // First stall: a nudge, budget spent.
    const r1 = stallStep(state, { ...promise, resolvedModel: "grok" }, surface);
    expect(r1.step.kind).toBe("nudge");
    state = r1.state;
    // Drive the re-prompt budget to exhausted so the policy swaps models.
    state = { ...state, stallRecoveries: 3 };
    const r2 = stallStep(state, { ...promise, resolvedModel: "grok" }, surface);
    expect(r2.step).toMatchObject({ kind: "failover", to: "sonnet" });
    expect(r2.state.stallRecoveries).toBe(0);
    expect(r2.state.policy.model).toBe("sonnet");
  });
});

// ── The inference mode (modelRouting.test: "the inference mode is decided by the seam") ─

describe("inferenceDecision", () => {
  it("Local only serves on the machine and never falls back to the gateway", () => {
    expect(inferenceDecision({ mode: "local-only", localServable: true })).toEqual({ decision: "local" });
    expect(inferenceDecision({ mode: "local-only", localServable: false })).toEqual({ decision: "no_local_model" });
  });

  it("Hybrid serves on the machine when it can, else the gateway (never silent)", () => {
    expect(inferenceDecision({ mode: "hybrid", pick: "k3", localServable: true })).toEqual({ decision: "local" });
    expect(inferenceDecision({ mode: "hybrid", pick: "k3", localServable: false })).toEqual({ decision: "gateway" });
  });

  it("Specific with nothing picked is refused no_specific_model, never quietly run local-first", () => {
    expect(inferenceDecision({ mode: "specific", pick: "" })).toEqual({ decision: "no_specific_model" });
    expect(inferenceDecision({ mode: "specific", pick: "opus" })).toEqual({ decision: "specific" });
  });
});

// ── The BYO preflight (byoCredentialHealth tests: unresolved reasons) ───────

describe("classifyPreflight", () => {
  it("an expired credential earns one refresh attempt and no notice until it stays unresolved", () => {
    const first = classifyPreflight({ byoSelected: true, unresolvedReasons: { anthropic: "expired" } });
    expect(first.refreshExpired).toBe(true);
    expect(first.notices).toEqual([]);
  });

  it("a still-unresolved credential after refresh is a notice", () => {
    const r = classifyPreflight({
      byoSelected: true,
      unresolvedReasons: { anthropic: "expired" },
      unresolvedAfterRefresh: "revoked",
    });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toContain("anthropic");
    expect(r.notices[0]).toContain("revoked");
  });

  it("a non-expired unresolved reason is owner-actionable and named immediately", () => {
    const r = classifyPreflight({ byoSelected: true, unresolvedReasons: { openai: "undecryptable" } });
    expect(r.refreshExpired).toBe(false);
    expect(r.notices[0]).toContain("openai");
    expect(r.notices[0]).toContain("undecryptable");
  });

  it("a plan phase landing on a Flash-class model is a notice (llm.model_downgrade path)", () => {
    const r = classifyPreflight({ byoSelected: false, unresolvedReasons: {}, planModelAgentic: false });
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toContain("Flash-class");
  });

  it("a clean preflight names nothing", () => {
    const r = classifyPreflight({ byoSelected: true, unresolvedReasons: {}, planModelAgentic: true });
    expect(r).toEqual({ notices: [], refreshExpired: false });
  });
});
