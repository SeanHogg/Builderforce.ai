import type { Api, Model } from "../builderforce/model/types.js";
import { describe, expect, it } from "vitest";
import { resolveForwardCompatModel } from "./model-forward-compat.js";
import type { ModelRegistry } from "./model-discovery.js";

function createTemplateModel(provider: string, id: string): Model<Api> {
  return {
    id,
    name: id,
    provider,
    api: "anthropic-messages",
    input: ["text"],
    reasoning: true,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_192,
  } as Model<Api>;
}

function createRegistry(models: Record<string, Model<Api>>): ModelRegistry {
  return {
    find(provider: string, modelId: string) {
      return models[`${provider}/${modelId}`] ?? null;
    },
  } as ModelRegistry;
}

describe("agents/model-forward-compat", () => {
  it("resolves anthropic opus 4.6 via 4.5 template", () => {
    const registry = createRegistry({
      "anthropic/claude-opus-4-5": createTemplateModel("anthropic", "claude-opus-4-5"),
    });
    const model = resolveForwardCompatModel("anthropic", "claude-opus-4-6", registry);
    expect(model?.id).toBe("claude-opus-4-6");
    expect(model?.name).toBe("claude-opus-4-6");
    expect(model?.provider).toBe("anthropic");
  });

  it("resolves anthropic sonnet 4.6 dot variant with suffix", () => {
    const registry = createRegistry({
      "anthropic/claude-sonnet-4.5-20260219": createTemplateModel(
        "anthropic",
        "claude-sonnet-4.5-20260219",
      ),
    });
    const model = resolveForwardCompatModel("anthropic", "claude-sonnet-4.6-20260219", registry);
    expect(model?.id).toBe("claude-sonnet-4.6-20260219");
    expect(model?.name).toBe("claude-sonnet-4.6-20260219");
    expect(model?.provider).toBe("anthropic");
  });

  it("does not resolve anthropic 4.6 fallback for other providers", () => {
    const registry = createRegistry({
      "anthropic/claude-opus-4-5": createTemplateModel("anthropic", "claude-opus-4-5"),
    });
    const model = resolveForwardCompatModel("openai", "claude-opus-4-6", registry);
    expect(model).toBeUndefined();
  });

  it("resolves the current flagships from the newest older release of the family", () => {
    const registry = createRegistry({
      "anthropic/claude-opus-5": createTemplateModel("anthropic", "claude-opus-5"),
      "anthropic/claude-sonnet-4-6": createTemplateModel("anthropic", "claude-sonnet-4-6"),
      "anthropic/claude-fable-5": createTemplateModel("anthropic", "claude-fable-5"),
    });
    expect(resolveForwardCompatModel("anthropic", "claude-opus-5-5", registry)?.id).toBe("claude-opus-5-5");
    expect(resolveForwardCompatModel("anthropic", "claude-sonnet-5-5", registry)?.id).toBe(
      "claude-sonnet-5-5",
    );
    expect(resolveForwardCompatModel("anthropic", "claude-fable-5-1", registry)?.id).toBe("claude-fable-5-1");
  });

  it("keeps the thinking suffix when borrowing an antigravity template", () => {
    const registry = createRegistry({
      "google-antigravity/claude-opus-4-6-thinking": createTemplateModel(
        "google-antigravity",
        "claude-opus-4-6-thinking",
      ),
    });
    const model = resolveForwardCompatModel("google-antigravity", "claude-opus-5-5-thinking", registry);
    expect(model?.id).toBe("claude-opus-5-5-thinking");
    expect(model?.provider).toBe("google-antigravity");
  });

  it("never borrows from a NEWER release", () => {
    const registry = createRegistry({
      "anthropic/claude-opus-5-5": createTemplateModel("anthropic", "claude-opus-5-5"),
    });
    expect(resolveForwardCompatModel("anthropic", "claude-opus-4-6", registry)).toBeUndefined();
  });
});
