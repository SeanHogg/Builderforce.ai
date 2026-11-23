import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createModelHook, type RecordedModelPreflight, type SurfacePorts } from "../../src/index.js";
import { modelHook } from "../../src/policy/model/index.js";
import { policyCtx } from "../support/policyContext.js";

const FLASH = "google/gemini-2.5-flash";

describe("createModelHook", () => {
  it("accepts recorded facts instead of a surface policy callback", () => {
    expectTypeOf<NonNullable<SurfacePorts["preflight"]>>().toEqualTypeOf<RecordedModelPreflight>();
  });

  it("keeps the default transport check when no recorded preflight was supplied", async () => {
    const preflight = vi.fn(() => ({ byoUnresolved: ["openai:revoked"] }));
    const ctx = policyCtx({ ports: { model: { complete: async () => ({ content: "" }), preflight } } });
    const event = await createModelHook().preflight!(ctx);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(event).toMatchObject({ status: "degraded" });
    expect(ctx.state.preflight).toBe("degraded:openai:revoked");
  });

  it.each([
    { recorded: { byoUnresolved: [] }, verdict: "ok", status: "ok" },
    { recorded: { byoUnresolved: ["anthropic:expired", "openai:revoked"] }, verdict: "degraded:anthropic:expired,openai:revoked", status: "degraded" },
    { recorded: { byoUnresolved: [], planModel: FLASH }, verdict: "degraded:plan_flash", status: "degraded" },
    { recorded: { byoUnresolved: ["anthropic:expired"], planModel: FLASH }, verdict: "degraded:anthropic:expired", status: "degraded" },
  ])("reuses recorded facts: $verdict, with no transport check or repeated notice", async ({ recorded, verdict, status }) => {
    const preflight = vi.fn(() => { throw new Error("must not check twice"); });
    // The routed model can differ from the host's plan model. Only the recorded facts decide this event.
    const ctx = policyCtx({ policy: { pinnedModel: FLASH }, ports: { model: { complete: async () => ({ content: "" }), preflight } } });
    const hook = createModelHook({ recordedPreflight: recorded });
    expect(await hook.preflight!(ctx)).toEqual({ kind: "model.preflight", step: ctx.step, status, notices: [] });
    expect(ctx.state.preflight).toBe(verdict);
    expect(preflight).not.toHaveBeenCalled();
    expect(hook.resolve).toBe(modelHook.resolve);
    expect(hook.downgrade).toBe(modelHook.downgrade);
    expect(hook.recoverFailure).toBe(modelHook.recoverFailure);
  });
});
