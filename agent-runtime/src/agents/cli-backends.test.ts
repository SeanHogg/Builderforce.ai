import { describe, expect, it } from "vitest";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { resolveCliBackendConfig } from "./cli-backends.js";

describe("resolveCliBackendConfig reliability merge", () => {
  it("deep-merges reliability watchdog overrides for codex", () => {
    const cfg = {
      agents: {
        defaults: {
          cliBackends: {
            "codex-cli": {
              command: "codex",
              reliability: {
                watchdog: {
                  resume: {
                    noOutputTimeoutMs: 42_000,
                  },
                },
              },
            },
          },
        },
      },
    } satisfies BuilderForceAgentsConfig;

    const resolved = resolveCliBackendConfig("codex-cli", cfg);

    expect(resolved).not.toBeNull();
    expect(resolved?.config.reliability?.watchdog?.resume?.noOutputTimeoutMs).toBe(42_000);
    // Ensure defaults are retained when only one field is overridden.
    expect(resolved?.config.reliability?.watchdog?.resume?.noOutputTimeoutRatio).toBe(0.3);
    expect(resolved?.config.reliability?.watchdog?.resume?.minMs).toBe(60_000);
    expect(resolved?.config.reliability?.watchdog?.resume?.maxMs).toBe(180_000);
    expect(resolved?.config.reliability?.watchdog?.fresh?.noOutputTimeoutRatio).toBe(0.8);
  });
});

describe("claude-cli model aliases", () => {
  it("maps every spelling of a release onto the family word the CLI accepts, current flagships included", () => {
    const aliases = resolveCliBackendConfig("claude-cli")?.config.modelAliases ?? {};
    expect(aliases["claude-opus-5-5"]).toBe("opus");
    expect(aliases["opus-5.5"]).toBe("opus");
    expect(aliases["claude-sonnet-5-5"]).toBe("sonnet");
    expect(aliases["claude-haiku-5-5"]).toBe("haiku");
    // Older spellings the table always carried still resolve.
    expect(aliases["claude-opus-4-6"]).toBe("opus");
    expect(aliases["sonnet-4.0"]).toBe("sonnet");
    expect(aliases["haiku-3.5"]).toBe("haiku");
    // A family the CLI documents no word for is passed through as the full id.
    expect(aliases["claude-fable-5-1"]).toBeUndefined();
  });
});
