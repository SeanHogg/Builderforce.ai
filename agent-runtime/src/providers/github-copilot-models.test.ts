import { describe, expect, it } from "vitest";
import { buildCopilotModelDefinition, getDefaultCopilotModelIds } from "./github-copilot-models.js";

describe("github-copilot models", () => {
  it("returns a fresh copy of the default catalog ids", () => {
    const first = getDefaultCopilotModelIds();
    first.push("mutated");
    expect(getDefaultCopilotModelIds()).not.toContain("mutated");
    expect(getDefaultCopilotModelIds()).toContain("gpt-4o");
  });

  it("builds a zero-cost openai-responses model definition", () => {
    const def = buildCopilotModelDefinition("  gpt-4.1  ");
    expect(def.id).toBe("gpt-4.1");
    expect(def.name).toBe("gpt-4.1");
    expect(def.api).toBe("openai-responses");
    expect(def.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(def.contextWindow).toBeGreaterThan(0);
    expect(def.maxTokens).toBeGreaterThan(0);
  });

  it("rejects an empty model id", () => {
    expect(() => buildCopilotModelDefinition("   ")).toThrow(/Model id required/);
  });
});
