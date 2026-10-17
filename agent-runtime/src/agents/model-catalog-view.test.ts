import { describe, expect, it } from "vitest";
import {
  catalogViewFromEntries,
  isExplicitlyFree,
  isLocalModel,
  loadOnPremCatalogView,
  priceForCost,
  vendorOfCandidateKey,
} from "./model-catalog-view.js";

describe("priceForCost — on-prem per-MILLION cost → port per-TOKEN price", () => {
  it("divides by one million", () => {
    expect(priceForCost({ input: 3, output: 15 })).toEqual({ input: 3e-6, output: 15e-6 });
  });
  it("refuses a malformed block rather than inventing a price", () => {
    expect(priceForCost(undefined)).toBeUndefined();
    expect(priceForCost({ input: Number.NaN, output: 1 })).toBeUndefined();
    expect(priceForCost({ input: -1, output: 1 })).toBeUndefined();
  });
});

describe("isLocalModel", () => {
  it("is local for a local inference api, a loopback baseUrl, or a local-only provider", () => {
    expect(isLocalModel("custom", { api: "ollama" })).toBe(true);
    expect(isLocalModel("custom", { api: "llama" })).toBe(true);
    expect(isLocalModel("custom", { baseUrl: "http://127.0.0.1:8000/v1" })).toBe(true);
    expect(isLocalModel("custom", { baseUrl: "http://localhost:1234/v1" })).toBe(true);
    expect(isLocalModel("custom", { baseUrl: "http://[::1]:8080/v1" })).toBe(true);
    for (const provider of ["ollama", "lmstudio", "freetoken", "synapse", "vllm", "llama", "ollama-local"]) {
      expect(isLocalModel(provider)).toBe(true);
    }
  });
  it("is cloud for a hosted provider", () => {
    expect(isLocalModel("anthropic", { api: "anthropic-messages", baseUrl: "https://api.anthropic.com" })).toBe(
      false,
    );
    expect(isLocalModel("together", { baseUrl: "not a url" })).toBe(false);
  });
});

describe("catalogViewFromEntries", () => {
  const view = catalogViewFromEntries([
    { provider: "anthropic", id: "claude-opus-5-5", cost: { input: 4, output: 20 } },
    { provider: "together", id: "zai-org/GLM-4.7", cost: { input: 0.45, output: 2 } },
    { provider: "builderforcellm", id: "auto", cost: { input: 0, output: 0 } },
    // A local runtime with a (nonsense) price still costs the tenant nothing.
    { provider: "ollama", id: "qwen3:8b", api: "ollama", cost: { input: 1, output: 9 } },
    // Later rows never override an earlier row for the same key.
    { provider: "anthropic", id: "claude-opus-5-5", cost: { input: 0, output: 0 } },
  ]);

  it("answers vendor from the candidate key's provider, normalized", () => {
    expect(view.vendorOf("anthropic/claude-opus-5-5")).toBe("anthropic");
    expect(vendorOfCandidateKey("Z.AI/glm-5")).toBe("zai");
  });

  it("answers tier and per-token price from the row, first row winning", () => {
    expect(view.tierOf("anthropic/claude-opus-5-5")).toBe("ULTRA");
    expect(view.priceOf?.("anthropic/claude-opus-5-5")).toEqual({ input: 4e-6, output: 20e-6 });
    expect(view.tierOf("together/zai-org/GLM-4.7")).toBe("STANDARD");
    expect(view.tierOf("builderforcellm/auto")).toBe("FREE");
  });

  it("treats local residency as FREE and cloud otherwise", () => {
    expect(view.residencyOf?.("ollama/qwen3:8b")).toBe("local");
    expect(view.tierOf("ollama/qwen3:8b")).toBe("FREE");
    expect(view.residencyOf?.("anthropic/claude-opus-5-5")).toBe("cloud");
  });

  it("answers a shared `local/<runtime>/<model>` ref as local and FREE", () => {
    expect(view.residencyOf?.("local/ollama/qwen3:8b")).toBe("local");
    expect(view.tierOf("local/synapse/qwen3-8b")).toBe("FREE");
    expect(view.vendorOf("local/ollama/qwen3:8b")).toBe("local/ollama");
  });

  it("knows nothing about a model it has no row for — never cheap by default", () => {
    expect(view.tierOf("openai/gpt-9")).toBeUndefined();
    expect(view.priceOf?.("openai/gpt-9")).toBeUndefined();
    expect(view.tierOf("no-slash")).toBeUndefined();
  });
});

describe("a zero cost is free only when the catalog SAYS free", () => {
  const view = catalogViewFromEntries([
    // Placeholder zeros: the provider module publishes no price.
    { provider: "moonshot", id: "kimi-k2.5", cost: { input: 0, output: 0 } },
    { provider: "xiaomi", id: "mimo-v2-flash", cost: { input: 0, output: 0 } },
    // Explicitly free: a `:free` / `-free` id, or the first-party free pool.
    { provider: "openrouter", id: "google/gemma-4-31b-it:free", cost: { input: 0, output: 0 } },
    { provider: "opencode", id: "glm-4.7-free", cost: { input: 0, output: 0 } },
    { provider: "builderforcellm", id: "auto", cost: { input: 0, output: 0 } },
    // Local inference is free whatever its row says.
    { provider: "lmstudio", id: "qwen3", cost: { input: 0, output: 0 } },
  ]);

  it("reads a cloud placeholder zero as an UNKNOWN price and tier, never as cheap", () => {
    expect(view.tierOf("moonshot/kimi-k2.5")).toBeUndefined();
    expect(view.priceOf?.("moonshot/kimi-k2.5")).toBeUndefined();
    expect(view.tierOf("xiaomi/mimo-v2-flash")).toBeUndefined();
  });

  it("reads a declared-free model as FREE", () => {
    expect(view.tierOf("openrouter/google/gemma-4-31b-it:free")).toBe("FREE");
    expect(view.tierOf("opencode/glm-4.7-free")).toBe("FREE");
    expect(view.tierOf("builderforcellm/auto")).toBe("FREE");
    expect(view.priceOf?.("builderforcellm/auto")).toEqual({ input: 0, output: 0 });
    expect(view.tierOf("lmstudio/qwen3")).toBe("FREE");
  });

  it("isExplicitlyFree reads the id marker and the free-pool provider only", () => {
    expect(isExplicitlyFree("openrouter", "x/y:free")).toBe(true);
    expect(isExplicitlyFree("builderforcellm", "poolside/laguna-s-2.1:free")).toBe(true);
    expect(isExplicitlyFree("moonshot", "kimi-k2.5")).toBe(false);
    expect(isExplicitlyFree("together", "freedom-7b")).toBe(false);
  });
});

describe("loadOnPremCatalogView", () => {
  it("reads the configured providers and survives a missing models.json", () => {
    const view = loadOnPremCatalogView({
      agentDir: "/nonexistent/builderforce-agent-dir",
      cfg: {
        models: {
          providers: {
            custom: {
              baseUrl: "https://example.test/v1",
              models: [
                {
                  id: "big",
                  name: "big",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 1,
                  maxTokens: 1,
                },
              ],
            },
          },
        },
      },
    });
    expect(view.tierOf("custom/big")).toBe("PREMIUM");
  });
});
