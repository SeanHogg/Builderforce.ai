import { describe, expect, it, vi } from "vitest";
import type { BuilderForceAgentsConfig } from "../../config/config.js";

// The picker's job is CHOOSING from the operator's declared chain, not resolving
// credentials off disk — `resolveModel` is the runner's own resolver and is exercised
// by its own tests, so here it is a stub that mints a model per provider/id and refuses
// one unregistered provider (the case where a declared fallback isn't usable).
vi.mock("./model.js", () => ({
  resolveModel: (provider: string, modelId: string) =>
    provider === "unregistered"
      ? { error: `Unknown model: ${provider}/${modelId}` }
      : { model: { id: modelId, provider, name: modelId } },
}));

const { createStallFallbackPicker } = await import("./stall-fallback.js");

function cfg(primary: string, fallbacks: string[]): BuilderForceAgentsConfig {
  return { agents: { defaults: { model: { primary, fallbacks } } } } as BuilderForceAgentsConfig;
}

describe("createStallFallbackPicker", () => {
  it("returns undefined when the operator declared no alternative", () => {
    // The whole product point: a self-hosted model is an explicit pin. With nothing to
    // fail over TO, the loop keeps its old behaviour and never substitutes a model.
    const pick = createStallFallbackPicker({
      cfg: cfg("openai/gpt-4.1-mini", []),
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });
    expect(pick).toBeUndefined();
  });

  it("walks the operator's own chain in order, skipping what the run already burned", () => {
    const pick = createStallFallbackPicker({
      cfg: cfg("openai/gpt-4.1-mini", ["anthropic/claude-haiku-3-5", "ollama/qwen3"]),
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });
    expect(pick).toBeDefined();
    // The pin itself is candidate #1, so a run that has burned only it gets #2.
    expect(pick?.(["openai/gpt-4.1-mini"])?.id).toBe("claude-haiku-3-5");
    expect(pick?.(["openai/gpt-4.1-mini", "anthropic/claude-haiku-3-5"])?.id).toBe("qwen3");
    // Chain exhausted — undefined is what tells the loop to stop and explain.
    expect(
      pick?.(["openai/gpt-4.1-mini", "anthropic/claude-haiku-3-5", "ollama/qwen3"]),
    ).toBeUndefined();
  });

  it("skips a declared fallback whose provider isn't registered on this host", () => {
    const pick = createStallFallbackPicker({
      cfg: cfg("openai/gpt-4.1-mini", ["unregistered/ghost", "ollama/qwen3"]),
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });
    // Offering a model the transport would reject at request time just burns a failover.
    expect(pick?.(["openai/gpt-4.1-mini"])?.id).toBe("qwen3");
  });
});
