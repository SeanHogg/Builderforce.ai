import { describe, expect, it } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { buildAllowedModelSet } from "./model-selection.js";

describe("buildAllowedModelSet", () => {
  it("allows explicitly configured models even when not in catalog or configured providers", () => {
    const cfg: BuilderForceAgentsConfig = {
      agents: {
        defaults: {
          models: {
            // These free-tier models are allowlisted but not in the catalog
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

    const result = buildAllowedModelSet({
      cfg,
      catalog,
      defaultProvider: "anthropic",
    });

    expect(result.allowAny).toBe(false);
    expect(result.allowedKeys.has("opencode/glm-5-free")).toBe(true);
    expect(result.allowedKeys.has("openrouter/google/gemma-3-27b-it:free")).toBe(true);
    expect(result.allowedKeys.has("openrouter/openai/gpt-oss-120b:free")).toBe(true);
  });

  it("does not reject models with special characters in model IDs", () => {
    const cfg: BuilderForceAgentsConfig = {
      agents: {
        defaults: {
          models: {
            "openrouter/meta-llama/llama-3.3-70b:free": {},
          },
        },
      },
    };

    const catalog = [{ provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" }];

    const result = buildAllowedModelSet({
      cfg,
      catalog,
      defaultProvider: "anthropic",
    });

    expect(result.allowedKeys.has("openrouter/meta-llama/llama-3.3-70b:free")).toBe(true);
  });

  it("allows models when allowlist is empty (allowAny mode)", () => {
    const cfg: BuilderForceAgentsConfig = {};
    const catalog = [{ provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" }];

    const result = buildAllowedModelSet({
      cfg,
      catalog,
      defaultProvider: "anthropic",
    });

    expect(result.allowAny).toBe(true);
    expect(result.allowedKeys.has("anthropic/claude-opus-4-5")).toBe(true);
  });

  it("allows catalog models when explicitly allowlisted", () => {
    const cfg: BuilderForceAgentsConfig = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-5": {},
          },
        },
      },
    };

    const catalog = [{ provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" }];

    const result = buildAllowedModelSet({
      cfg,
      catalog,
      defaultProvider: "anthropic",
    });

    expect(result.allowAny).toBe(false);
    expect(result.allowedKeys.has("anthropic/claude-opus-4-5")).toBe(true);
  });
});
