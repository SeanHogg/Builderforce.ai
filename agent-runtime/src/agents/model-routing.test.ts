import { describe, expect, it } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { catalogViewFromEntries } from "./model-catalog-view.js";
import {
  resolveRelayTaskModel,
  resolveRoleRoutedModel,
  resolveSubagentSpawnModel,
} from "./model-routing.js";

const model = (id: string, input: number, output: number) => ({
  id,
  name: id,
  reasoning: false,
  input: ["text" as const],
  cost: { input, output, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 8192,
});

/** An operator chain: the free gateway pool first, a flagship as the fallback. */
function chainConfig(fallbacks: string[]): BuilderForceAgentsConfig {
  return {
    agents: { defaults: { model: { primary: "builderforcellm/auto", fallbacks } } },
    models: {
      providers: {
        builderforcellm: {
          baseUrl: "https://api.builderforce.ai/llm/v1",
          models: [model("auto", 0, 0), model("poolside/laguna:free", 0, 0)],
        },
        anthropic: {
          baseUrl: "https://api.anthropic.com",
          models: [model("claude-opus-5-5", 5, 25)],
        },
      },
    },
  } as BuilderForceAgentsConfig;
}

describe("resolveRoleRoutedModel", () => {
  const cfg = chainConfig(["anthropic/claude-opus-5-5"]);
  const view = catalogViewFromEntries([
    { provider: "builderforcellm", id: "auto", cost: { input: 0, output: 0 } },
    { provider: "anthropic", id: "claude-opus-5-5", cost: { input: 5, output: 25 } },
  ]);

  it("a code turn leads with the strongest model in the configured chain", async () => {
    await expect(
      resolveRoleRoutedModel({ cfg, lead: "builderforcellm/auto", role: "code", view }),
    ).resolves.toBe("anthropic/claude-opus-5-5");
  });

  it("a utility turn leads with the cheapest", async () => {
    await expect(
      resolveRoleRoutedModel({ cfg, lead: "anthropic/claude-opus-5-5", role: "utility", view }),
    ).resolves.toBe("builderforcellm/auto");
  });

  it("a plan turn keeps the operator's lead", async () => {
    await expect(
      resolveRoleRoutedModel({ cfg, lead: "builderforcellm/auto", role: "plan", view }),
    ).resolves.toBe("builderforcellm/auto");
  });
});

describe("resolveSubagentSpawnModel", () => {
  const cfg = chainConfig(["anthropic/claude-opus-5-5"]);

  it("routes a role-typed spawn with no explicit model through the router", async () => {
    await expect(resolveSubagentSpawnModel({ cfg, agentId: "main", role: "code" })).resolves.toBe(
      "anthropic/claude-opus-5-5",
    );
  });

  it("an explicit model is the operator's word and is never rerouted", async () => {
    await expect(
      resolveSubagentSpawnModel({ cfg, agentId: "main", role: "code", modelOverride: "openai/gpt-5.2" }),
    ).resolves.toBe("openai/gpt-5.2");
  });

  it("with no role the runtime default stands", async () => {
    await expect(resolveSubagentSpawnModel({ cfg, agentId: "main" })).resolves.toBe(
      "builderforcellm/auto",
    );
  });
});

describe("resolveRelayTaskModel", () => {
  it("picks only among models the gateway itself serves, never the `auto` placeholder", async () => {
    const cfg = chainConfig(["builderforcellm/poolside/laguna:free", "anthropic/claude-opus-5-5"]);
    await expect(resolveRelayTaskModel({ prompt: "Fix the login bug", cfg })).resolves.toBe(
      "poolside/laguna:free",
    );
  });

  it("leaves the choice to the engine when the chain offers the gateway nothing to pick", async () => {
    const cfg = chainConfig(["anthropic/claude-opus-5-5"]);
    await expect(resolveRelayTaskModel({ prompt: "Fix the login bug", cfg })).resolves.toBeUndefined();
  });
});
