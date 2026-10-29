/**
 * Test — the D1 `CascadeSession` (reasoning escalation, the lever-off inertness, the D2 prior weak-pass rate) and D8's
 * read-only port, ported from `api/.../costLoop/verifierCascade.test.ts`. Inputs and expected values are the source's;
 * the engine's env-string levers are the constructor's flag and the engine's difficulty-gate module is `CascadePorts`.
 */
import { describe, expect, it, vi } from "vitest";
import { initialRunPolicy } from "@builderforce/run-policy";
import { CascadeSession } from "../../src/policy/guards/cascade.js";
import { RunGuards } from "../../src/policy/guards/index.js";
import { isReadOnlyCloudTool } from "../../src/policy/guards/readOnly.js";

const ladder = { candidates: ["weak", "mid"], rankOf: (m: string) => (m === "weak" ? 0 : 1) };
const features = { actionType: "bugfix", role: "code", promptTokens: 10, toolCount: 3, turnIndex: 0 };
const state = () => initialRunPolicy({ pinnedModel: "weak", startPhase: "code" });
// The surface's reasoning ladder and the role's default (`code` reasons at medium).
const LEVELS = ["minimal", "low", "medium", "high"];
const reasoning = { defaultThinkLevel: "medium", escalateThinkLevel: (l: string) => LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(l) + 1)]! };

function ports() {
  return {
    skip: vi.fn(async (..._a: unknown[]) => false),
    outcome: vi.fn(async (..._a: unknown[]) => undefined),
    rate: vi.fn(async (..._a: unknown[]): Promise<number | undefined> => undefined),
  };
}

describe("CascadeSession", () => {
  it("raises reasoning one level per open escalation, from the role default", async () => {
    const s = new CascadeSession(true, undefined, reasoning);
    await s.seed(state(), { strict: false, ladder, features });
    expect(s.execParams(undefined)).toBeUndefined();
    await s.verdict(state(), "code_edit", { passed: false, verifier: "changed_files" }, { ladder, attemptModel: "weak", features });
    expect(s.execParams(undefined)).toEqual({ thinkLevel: "high" });
    expect(s.execParams({ temperature: 0.2, thinkLevel: "low" } as never)).toEqual({ temperature: 0.2, thinkLevel: "medium" });
  });

  it("is inert with the lever off, and keeps the first tick's facts for later ticks", async () => {
    const s = new CascadeSession(false, undefined);
    const seeded = await s.seed(state(), { strict: false, ladder, features });
    expect(seeded.model).toBe("weak");
    const resumed = new CascadeSession(false, JSON.parse(JSON.stringify(s.snapshot())));
    expect(resumed.featuresActionType("other")).toBe("bugfix");
    // A3 may still move a soft run up, through the cascade's ladder.
    expect(resumed.escalate(state(), ladder, "weak")?.model).toBe("mid");
  });
});

describe("CascadeSession — D2 prior weak-pass rate", () => {
  it("reads the tenant + action-type rate once, feeds it to the router and the training row, and carries it across ticks", async () => {
    const g = ports();
    g.rate.mockResolvedValue(0.8);
    const cascadePorts = { shouldSkipWeakAttempt: g.skip, weakPassRate: g.rate, recordOutcome: g.outcome };
    const s = new CascadeSession(true, undefined, cascadePorts);
    await s.seed(state(), { strict: false, ladder, features });
    expect(g.rate).toHaveBeenCalledWith("bugfix");
    expect(g.skip.mock.calls[0]?.[0]).toMatchObject({ priorWeakPassRate: 0.8 });
    const resumed = new CascadeSession(true, JSON.parse(JSON.stringify(s.snapshot())), cascadePorts);
    await resumed.verdict(state(), "code_edit", { passed: true, verifier: "changed_files" }, { ladder, attemptModel: "weak", features });
    expect(g.rate).toHaveBeenCalledTimes(1);
    expect(g.outcome.mock.calls[0]?.[0]).toMatchObject({ features: { priorWeakPassRate: 0.8 } });
  });

  it("leaves the feature unset for a cold tenant, and does not ask again", async () => {
    const g = ports();
    g.rate.mockResolvedValue(undefined);
    const cascadePorts = { shouldSkipWeakAttempt: g.skip, weakPassRate: g.rate, recordOutcome: g.outcome };
    const s = new CascadeSession(true, undefined, cascadePorts);
    await s.seed(state(), { strict: false, ladder, features });
    expect(g.skip.mock.calls[0]?.[0]).not.toHaveProperty("priorWeakPassRate");
    const resumed = new CascadeSession(true, JSON.parse(JSON.stringify(s.snapshot())), cascadePorts);
    await resumed.verdict(state(), "code_edit", { passed: true, verifier: "changed_files" }, { ladder, attemptModel: "weak", features });
    expect(g.rate).toHaveBeenCalledTimes(1);
  });
});

describe("parallelReads (D8)", () => {
  it("names read tools only, and offers the port only while the lever is on", () => {
    expect(isReadOnlyCloudTool("search_code")).toBe(true);
    expect(isReadOnlyCloudTool("edit_file")).toBe(false);
    // Lever off: no call is read-only (every call dispatches in sequence). On: the read tools are.
    expect(new RunGuards({}, undefined, {}).isReadOnly("search_code")).toBe(false);
    expect(new RunGuards({ d8_parallel_tool_calls: true }, undefined, {}).isReadOnly("search_code")).toBe(true);
  });
});
