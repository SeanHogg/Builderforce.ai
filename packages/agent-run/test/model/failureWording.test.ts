/**
 * A surface that wants the kernel's provider-failure routing but says nothing of it to the model (the Brain): its wording carries only
 * the trace callbacks, never a `handoff` / `reroute` sentence, so a recovered failure leaves no row in the transcript.
 */
import { describe, expect, it } from "vitest";
import { recoverProviderFailure } from "../../src/policy/model/failure.js";
import type { TransportFailure } from "../../src/surface.js";
import { policyCtx } from "../support/policyContext.js";

const FAILURE: TransportFailure = { type: "transport_failed", kind: "transport", status: 503 };

describe("recoverProviderFailure — wording is optional", () => {
  it("routes the failure around with no note for the model, and tells the surface's trace callbacks", () => {
    const rerouted: unknown[] = [];
    const abandoned: unknown[] = [];
    const ctx = policyCtx({ ports: { delivery: { rungs: () => [], providerFailure: { rerouted: (f: unknown) => { rerouted.push(f); }, abandoned: (f: unknown) => { abandoned.push(f); } } } } as never });
    const route = recoverProviderFailure(ctx, FAILURE, "gpt-x", "503 Service Unavailable");
    expect(route).not.toHaveProperty("note");
    expect(route.kind === "retry" ? rerouted.length : abandoned.length).toBe(1);
    expect(route.kind === "retry" ? abandoned.length : rerouted.length).toBe(0);
  });

  it("a surface that words both keeps its sentences", () => {
    const ctx = policyCtx({ ports: { delivery: { rungs: () => [], providerFailure: { handoff: (to: string) => `now ${to}`, reroute: "asking again" } } } as never });
    const route = recoverProviderFailure(ctx, FAILURE, "gpt-x", "503");
    if (route.kind === "retry") expect(["asking again"].some((s) => route.note === s) || String(route.note).startsWith("now ")).toBe(true);
  });
});
