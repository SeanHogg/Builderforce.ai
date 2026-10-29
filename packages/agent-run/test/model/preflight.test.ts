/**
 * The model preflight before turn 1 (`model.preflight`) and `llm.model_downgrade`
 * (§6.10, E7) — from the transport's BYO-resolution port and the run's own state.
 */
import { describe, expect, it } from "vitest";
import { modelDowngrade, modelPreflightEvent, preflightVerdict, runModelPreflight } from "../../src/policy/model/index.js";
import { policyCtx } from "../support/policyContext.js";

describe("modelPreflightEvent", () => {
  it("is ok when the transport has no preflight or nothing is unresolved", () => {
    expect(modelPreflightEvent(0, undefined)).toEqual({ kind: "model.preflight", step: 0, status: "ok", notices: [] });
    expect(modelPreflightEvent(0, { byoUnresolved: [] })).toMatchObject({ status: "ok" });
  });

  it("is refreshed when the transport renewed an expired token", () => {
    expect(modelPreflightEvent(0, { byoUnresolved: [], refreshed: ["anthropic"] })).toMatchObject({ status: "refreshed", notices: [] });
  });

  it("is degraded, naming the provider and the fallback, when a credential is still unresolved", () => {
    const event = modelPreflightEvent(0, { byoUnresolved: ["anthropic:expired"], fallback: "free-model" });
    expect(event.status).toBe("degraded");
    expect(event.notices.join(" ")).toContain("anthropic");
    expect(event.notices.join(" ")).toContain("free-model");
    expect(preflightVerdict(event, { byoUnresolved: ["anthropic:expired"] })).toBe("degraded:anthropic:expired");
  });
});

describe("runModelPreflight — the hook half", () => {
  it("asks the transport once and records the verdict on the state", async () => {
    const asked: Array<string | undefined> = [];
    const ctx = policyCtx({
      policy: { pinnedModel: "pinned-x" },
      ports: { model: { complete: async () => ({ content: "" }), preflight: (m) => (asked.push(m), { byoUnresolved: ["openai:revoked"] }) } },
    });
    const event = await runModelPreflight(ctx);
    expect(asked).toEqual(["pinned-x"]);
    expect(event.status).toBe("degraded");
    expect(ctx.state.preflight).toBe("degraded:openai:revoked");
  });

  it("a transport whose preflight throws costs the notice, never the run", async () => {
    const ctx = policyCtx({ ports: { model: { complete: async () => ({ content: "" }), preflight: () => { throw new Error("down"); } } } });
    expect((await runModelPreflight(ctx)).status).toBe("ok");
  });
});

describe("modelDowngrade", () => {
  it("names a turn that asked for a model and was answered by another", () => {
    expect(modelDowngrade(policyCtx(), "sonnet", "flash")).toMatchObject({ kind: "llm.model_downgrade", requestedModel: "sonnet", model: "flash", reason: "failover" });
    expect(modelDowngrade(policyCtx(), "sonnet", "sonnet")).toBeUndefined();
  });

  it("names an auto-routed turn once per served model while a BYO credential is unresolved", () => {
    const ctx = policyCtx();
    ctx.state.preflight = "degraded:anthropic:expired";
    expect(modelDowngrade(ctx, undefined, "free-model")).toMatchObject({ requestedModel: "default", reason: "byo_unresolved:anthropic:expired" });
    expect(modelDowngrade(ctx, undefined, "free-model")).toBeUndefined();
  });

  it("is quiet for a clean auto-routed turn on an unpriced model", () => {
    expect(modelDowngrade(policyCtx(), undefined, "local-unpriced-model")).toBeUndefined();
  });
});
