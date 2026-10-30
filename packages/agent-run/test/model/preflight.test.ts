/**
 * The model preflight before turn 1 (`model.preflight`) and `llm.model_downgrade`
 * (§6.10, E7) — from the transport's BYO-resolution port and the run's own state.
 */
import { describe, expect, it } from "vitest";
import { priceBookFromPrices } from "@builderforce/model-catalog";
import { buildOutcomeRow } from "../../src/index.js";
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

/** A tiny price book: output $/token decides the tier (>= $20/M ULTRA, $8-20 PREMIUM, < $8 STANDARD, 0 FREE). */
const BOOK = priceBookFromPrices([
  ["opus", { input: 5e-6, output: 25e-6 }],
  ["opus-2", { input: 5e-6, output: 25e-6 }],
  ["sonnet", { input: 3e-6, output: 15e-6 }],
  ["haiku", { input: 1e-7, output: 5e-7 }],
  ["free-pool", { input: 0, output: 0 }],
]);

describe("a pinned failover and an auto-routed downgrade on the SAME model", () => {
  it("records the pinned failover for the row without suppressing the auto-routed announcement that follows", () => {
    const ctx = policyCtx();
    ctx.state.preflight = "degraded:openai:expired";
    // Turn 1: a pinned model fails over onto a weaker one.
    expect(modelDowngrade(ctx, "opus", "haiku", BOOK)).toMatchObject({ reason: "failover" });
    // Later: an auto-routed turn (asked for nothing) lands on that same model while a connected account is unusable.
    const announced = modelDowngrade(ctx, undefined, "haiku", BOOK);
    expect(announced).toMatchObject({ requestedModel: "default", model: "haiku", reason: "byo_unresolved:openai:expired" });
    expect(ctx.state.downgrades).toEqual(["haiku"]);
    expect(ctx.state.degradedBy).toEqual(["haiku"]);
    // …said ONCE: the same auto-routed turn again does not repeat it.
    expect(modelDowngrade(ctx, undefined, "haiku", BOOK)).toBeUndefined();
  });
});

describe("an auto-routed downgrade (nothing requested)", () => {
  it("is announced but never recorded as degraded: with no requested model there is nothing it is weaker than", () => {
    const ctx = policyCtx();
    ctx.state.preflight = "degraded:openai:expired";
    expect(modelDowngrade(ctx, undefined, "haiku", BOOK)).toMatchObject({ requestedModel: "default", model: "haiku", reason: "byo_unresolved:openai:expired" });
    expect(ctx.state.downgrades).toEqual(["haiku"]);
    expect(ctx.state.degradedBy ?? []).toEqual([]);
    expect(buildOutcomeRow({ entryPoint: "on-prem", kind: "finished", state: ctx.state })).not.toHaveProperty("degraded");
  });
});

describe("modelDowngrade records a downgrade only when the served model is weaker", () => {
  it("a failover onto a weaker model is recorded once (the row reads it as degraded); a same-tier failover is not", () => {
    const weaker = policyCtx();
    expect(modelDowngrade(weaker, "opus", "haiku", BOOK)).toMatchObject({ reason: "failover" });
    expect(modelDowngrade(weaker, "opus", "haiku", BOOK)).toMatchObject({ reason: "failover" });
    expect(weaker.state.degradedBy).toEqual(["haiku"]);
    // A pinned failover is a FACT for the row, not an auto-routed announcement: it never enters the dedupe list.
    expect(weaker.state.downgrades ?? []).toEqual([]);
    expect(buildOutcomeRow({ entryPoint: "on-prem", kind: "finished", state: weaker.state })).toMatchObject({ degraded: true });

    const sameTier = policyCtx();
    expect(modelDowngrade(sameTier, "opus", "opus-2", BOOK)).toMatchObject({ reason: "failover" });
    expect(sameTier.state.degradedBy ?? []).toEqual([]);
    expect(buildOutcomeRow({ entryPoint: "on-prem", kind: "finished", state: sameTier.state })).not.toHaveProperty("degraded");
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
