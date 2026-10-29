/**
 * The guards hook as the run drives it: the levers come from `RunPolicy.levers`
 * (`guardLeversOf`), D7's note comes back as the replacement result, D8's read-only port
 * follows its lever, and A3's pause parks the run with an `ask_human` control.
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

  it("A3: a parked run skips the next call with an ask_human control, once", async () => {
    const hook = createGuardsHook({ pause: async () => ({ approvalId: "appr-9" }) });
    const ctx = policyCtx({ policy: { levers: ["a3_progress_detector"] } });
    ctx.state.guards = { pendingPause: "Is this the right file?" };
    const parked = await hook.beforeDispatch(ctx, { id: "x", name: "read_file", args: {} });
    expect(parked?.skip?.control).toMatchObject({ kind: "ask_human", approvalId: "appr-9", question: "Is this the right file?" });
    expect(parked?.skip?.control?.options?.length).toBe(2);
    expect(await hook.beforeDispatch(ctx, { id: "y", name: "read_file", args: {} })).toBeUndefined();
  });
});
