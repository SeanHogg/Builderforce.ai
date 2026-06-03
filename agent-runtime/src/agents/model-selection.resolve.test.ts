import { describe, expect, it } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { resolveAllowedModelRef } from "./model-selection.js";

describe("resolveAllowedModelRef", () => {
  it("accepts explicitly allowlisted free-tier models", () => {
    const cfg: BuilderForceAgentsConfig = {
      agents: {
        defaults: {
          models: {
            "opencode/glm-5-free": {},
            "openrouter/google/gemma-3-27b-it:free": {},
            "openrouter/openai/gpt-oss-120b:free": {},
          },
        },
      },
    };

    const catalog = [
      { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
    ];

    const testCases = [
      { raw: "opencode/glm-5-free", expectedKey: "opencode/glm-5-free" },
      {
        raw: "openrouter/google/gemma-3-27b-it:free",
        expectedKey: "openrouter/google/gemma-3-27b-it:free",
      },
      {
        raw: "openrouter/openai/gpt-oss-120b:free",
        expectedKey: "openrouter/openai/gpt-oss-120b:free",
      },
    ];

    for (const { raw, expectedKey } of testCases) {
      const result = resolveAllowedModelRef({
        cfg,
        catalog,
        raw,
        defaultProvider: "anthropic",
      });

      if ("error" in result) {
        throw new Error(`Expected success for ${raw}, got error: ${result.error}`);
      }
      expect(result.key).toBe(expectedKey);
      expect(result.ref.provider).toBe(expectedKey.split("/")[0]);
      expect(result.ref.model).toBe(expectedKey.split("/").slice(1).join("/"));
    }
  });

  it("rejects models that are not in allowlist", () => {
    const cfg: BuilderForceAgentsConfig = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-5": {},
          },
        },
      },
    };

    const catalog = [
      { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
    ];

    const result = resolveAllowedModelRef({
      cfg,
      catalog,
      raw: "openai/gpt-4o",
      defaultProvider: "anthropic",
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("model not allowed:");
    }
  });

  it("accepts models when allowlist is empty (allowAny mode)", () => {
    const cfg: BuilderForceAgentsConfig = {};
    const catalog = [{ provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" }];

    const result = resolveAllowedModelRef({
      cfg,
      catalog,
      raw: "anthropic/claude-opus-4-5",
      defaultProvider: "anthropic",
    });

    if ("error" in result) {
      throw new Error(`Expected success in allowAny mode, got error: ${result.error}`);
    }
    expect(result.key).toBe("anthropic/claude-opus-4-5");
  });

  it("allows models for configured providers when allowlist is non-empty", () => {
    const cfg: BuilderForceAgentsConfig = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-5": {},
          },
        },
      },
      models: {
        providers: {
          openrouter: {
            apiKey: "test-key",
            baseUrl: "https://openrouter.ai/api/v1",
            models: [],
          },
        },
      },
    };

    const catalog = [
      { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
    ];

    const result = resolveAllowedModelRef({
      cfg,
      catalog,
      raw: "openrouter/google/gemma-3-27b-it:free",
      defaultProvider: "openrouter",
    });

    if ("error" in result) {
      throw new Error(`Expected success for configured provider, got: ${result.error}`);
    }
    expect(result.key).toBe("openrouter/google/gemma-3-27b-it:free");
  });

  it("treats openrouter namespaced model IDs as openrouter when default provider is openrouter", () => {
    const cfg: BuilderForceAgentsConfig = {
      agents: {
        defaults: {
          models: {
            "openrouter/nvidia/nemotron-3-nano-30b-a3b:free": {},
          },
        },
      },
      models: {
        providers: {
          openrouter: {
            apiKey: "test-key",
            baseUrl: "https://openrouter.ai/api/v1",
            models: [],
          },
        },
      },
    };

    const catalog = [
      { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
    ];

    const result = resolveAllowedModelRef({
      cfg,
      catalog,
      raw: "opencode/glm-5-free",
      defaultProvider: "openrouter",
    });

    if ("error" in result) {
      throw new Error(`Expected success for openrouter namespaced model, got: ${result.error}`);
    }
    expect(result.key).toBe("openrouter/opencode/glm-5-free");
    expect(result.ref.provider).toBe("openrouter");
    expect(result.ref.model).toBe("opencode/glm-5-free");
  });
});
