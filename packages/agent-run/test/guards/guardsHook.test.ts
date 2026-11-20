/**
 * The guards hook as the run drives it: the levers come from `RunPolicy.levers`
 * (`guardLeversOf`), D7's note comes back as the replacement result, D8's read-only port
 * follows its lever, and A3 never parks the run on a person (it has no `beforeDispatch`).
 */
import { describe, expect, it } from "vitest";
import { createGuardsHook, guardLeversOf } from "../../src/policy/guards/index.js";
import { policyCtx } from "../support/policyContext.js";

describe("guardLeversOf", () => {
  it("switches on exactly the guard levers the policy names", () => {
    expect(guardLeversOf(["a3_progress_detector", "d8_parallel_tool_calls", "c2_observation_masking"])).toEqual({
      a3_progress_detector: true,
      d7_deterministic_handlers: false,
      d1_verifier_cascade: false,
      d8_parallel_tool_calls: true,
    });
    expect(Object.values(guardLeversOf([])).some(Boolean)).toBe(false);
  });
});

describe("createGuardsHook", () => {
  it("D7: returns the noted result for a broken write, nothing for a clean one", async () => {
    const hook = createGuardsHook();
    const ctx = policyCtx({ policy: { levers: ["d7_deterministic_handlers"] } });
    const bad = await hook.observe(ctx, { id: "a", name: "write_file", args: { path: "cfg.json", content: '{ "a": ' } }, { ok: true });
    expect(String((bad?.data as { note?: string }).note)).toMatch(/Post-edit check FAILED[\s\S]*cfg\.json/);
    const good = await hook.observe(ctx, { id: "b", name: "write_file", args: { path: "cfg.json", content: '{ "a": 1 }' } }, { ok: true });
    expect(good).toBeUndefined();
  });

  it("D8: read-only calls only while the lever is on", () => {
    const hook = createGuardsHook();
    const on = policyCtx({ policy: { levers: ["d8_parallel_tool_calls"] } });
    expect(hook.isReadOnly?.(on, "read_file")).toBe(true);
    expect(hook.isReadOnly?.(on, "write_file")).toBe(false);
    expect(hook.isReadOnly?.(policyCtx(), "read_file")).toBe(false);
  });

  it("regression: chat #157440 — A3 never parks a run; an old saved pendingPause is ignored on resume", async () => {
    const hook = createGuardsHook();
    expect(hook.beforeDispatch).toBeUndefined();
    const ctx = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    // State saved before the pause rung was removed: the extra JSON key is simply dropped.
    ctx.state.guards = { pendingPause: "Is this the right file?" } as unknown as typeof ctx.state.guards;
    await hook.observe(ctx, { id: "x", name: "read_file", args: { path: "a.ts" } }, { ok: true });
    expect((ctx.state.guards as Record<string, unknown>).pendingPause).toBeUndefined();
  });
});
