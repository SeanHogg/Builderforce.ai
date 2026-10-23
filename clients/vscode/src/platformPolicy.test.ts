/**
 * The editor's platform policy is DERIVED from the inference mode (`resolveInferencePolicy`)
 * with the `builderforce.platform.*` settings as advanced overrides — only the ones the
 * person explicitly set. Signed out and undecided sends nothing; signed in and undecided
 * runs Hybrid, so heartbeat / assigned work / personality keep working with sync off.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  /** USER settings written through `update` (Global). */
  config: {} as Record<string, unknown>,
  /** USER settings the person set by hand. */
  explicit: {} as Record<string, unknown>,
  /** A repository's `.vscode/settings.json` — must never be read. */
  workspace: {} as Record<string, unknown>,
  key: undefined as string | undefined,
  configListeners: [] as Array<(event: { affectsConfiguration(section: string): boolean }) => void>,
  secretListeners: [] as Array<(event: { key: string }) => void>,
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      // `get` is the EFFECTIVE value — a workspace value wins, which is exactly why the
      // policy must not read it.
      get: (key: string) => host.workspace[key] ?? host.explicit[key] ?? host.config[key],
      inspect: (key: string) => ({
        key,
        globalValue: host.explicit[key] ?? host.config[key],
        workspaceValue: host.workspace[key],
        workspaceFolderValue: host.workspace[key],
      }),
      update: async (key: string, value: unknown) => {
        host.config[key] = value;
      },
    }),
    onDidChangeConfiguration: (listener: (typeof host.configListeners)[number]) => {
      host.configListeners.push(listener);
      return { dispose() {} };
    },
  },
  ConfigurationTarget: { Global: 1 },
}));

import { bindPlatformPolicy, platformCapabilityFor, platformInferenceMode, platformPolicy, platformRequestRefusalFor } from "./platformPolicy";
import { inferenceModeState, setInferenceMode } from "./inferenceModeSetting";

const SECRET = "builderforce.apiKey";
const subscriptions: Array<{ dispose(): void }> = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function configChanged(): void {
  for (const listener of host.configListeners) listener({ affectsConfiguration: () => true });
}

async function signIn(key: string | undefined): Promise<void> {
  host.key = key;
  for (const listener of host.secretListeners) listener({ key: SECRET });
  await flush();
}

beforeAll(async () => {
  const context = {
    subscriptions,
    secrets: {
      get: async (key: string) => (key === SECRET ? host.key : undefined),
      onDidChange: (listener: (typeof host.secretListeners)[number]) => {
        host.secretListeners.push(listener);
        return { dispose() {} };
      },
    },
  };
  bindPlatformPolicy(context as never, SECRET);
  await flush();
});

afterAll(() => {
  for (const sub of subscriptions.splice(0)) sub.dispose();
});

describe("mode-derived platform policy", () => {
  it("signed out and undecided: Local only — nothing reaches the platform", () => {
    expect(inferenceModeState()).toEqual({ mode: "local-only", chosen: false, signedIn: false });
    const policy = platformPolicy();
    for (const capability of ["gateway-inference", "connected-feature", "synchronize", "direct-provider", "authenticate"] as const) {
      expect(policy.allows(capability)).toBe(false);
    }
  });

  it("signed in and undecided: Hybrid — gateway and connected features on, sync off", async () => {
    await signIn("bfk_test");
    expect(inferenceModeState()).toEqual({ mode: "hybrid", chosen: false, signedIn: true });
    const policy = platformPolicy();
    expect(policy.allows("gateway-inference")).toBe(true);
    expect(policy.allows("connected-feature")).toBe(true);
    expect(policy.allows("synchronize")).toBe(false);
  });

  it("signed in Hybrid with sync off: a run's ordinary writes and stream are NOT refused (the web's answer)", () => {
    // 2026.10.57 refused these in the editor (strict `allows('synchronize')` on a write).
    const api = "https://api.builderforce.ai";
    expect(platformInferenceMode()).toBe("hybrid");
    expect(platformRequestRefusalFor(`${api}/api/projects/11/tickets`, { method: "POST" })).toBeNull();
    expect(platformRequestRefusalFor(`${api}/api/brain/chats/3/messages`, { method: "POST" })).toBeNull();
    expect(platformRequestRefusalFor(`${api}/api/brain/stream`, { method: "POST" })).toBeNull();
    expect(platformRequestRefusalFor(`${api}/llm/v1/chat/completions`, { method: "POST" })).toBeNull();
    // The named sync transport still answers to the sync switch.
    expect(platformRequestRefusalFor(`${api}/api/sync/v1/push`, { method: "POST" })).toBe("synchronize");
  });

  it("an explicitly set platform setting overrides the mode; an unset one follows it", () => {
    host.explicit["platform.synchronize"] = true;
    configChanged();
    expect(platformPolicy().allows("synchronize")).toBe(true);
    delete host.explicit["platform.synchronize"];
    configChanged();
    expect(platformPolicy().allows("synchronize")).toBe(false);
  });

  it("a chosen mode applies at once, and Local only keeps its promise over an override", async () => {
    host.explicit["platform.gatewayInference"] = true;
    const pending = setInferenceMode("local-only");
    // Applied before the config write lands — the held first turn runs in it.
    expect(inferenceModeState()).toMatchObject({ mode: "local-only", chosen: true });
    expect(platformPolicy().allows("gateway-inference")).toBe(false);
    await pending;
    configChanged();
    expect(host.config.inferenceMode).toBe("local-only");
    expect(platformPolicy().allows("gateway-inference")).toBe(false);
    // Local only still refuses what carries content.
    expect(platformRequestRefusalFor("https://api.builderforce.ai/api/brain/stream", { method: "POST" })).toBe("gateway-inference");
    expect(platformRequestRefusalFor("https://api.builderforce.ai/api/brain/chats/3/messages", { method: "POST" })).toBe("synchronize");
    delete host.explicit["platform.gatewayInference"];
    await setInferenceMode("specific");
    expect(platformPolicy().allows("direct-provider")).toBe(true);
  });

  it("a repository's workspace settings never move the mode or open a capability", async () => {
    await setInferenceMode("local-only");
    host.workspace.inferenceMode = "hybrid";
    host.workspace["platform.gatewayInference"] = true;
    host.workspace["platform.synchronize"] = true;
    configChanged();
    expect(inferenceModeState()).toMatchObject({ mode: "local-only", chosen: true });
    expect(platformPolicy().allows("gateway-inference")).toBe(false);
    expect(platformPolicy().allows("synchronize")).toBe(false);
    // Nor does a workspace value turn OFF what the person's own mode grants.
    await setInferenceMode("hybrid");
    host.workspace = {};
    host.workspace["platform.connectedFeatures"] = false;
    configChanged();
    expect(platformPolicy().allows("connected-feature")).toBe(true);
    host.workspace = {};
  });
});

describe("platform request classification (the shared route table)", () => {
  const api = "https://api.builderforce.ai";
  it.each([
    [`${api}/api/limbic/block`, "POST", "connected-feature"],
    [`${api}/api/vscode/connect`, "POST", "connected-feature"],
    [`${api}/llm/v1/models`, "GET", "connected-feature"],
    [`${api}/llm/v1/chat/completions`, "POST", "gateway-inference"],
    [`${api}/api/auth/tenant-api-key-token`, "POST", "authenticate"],
    [`${api}/api/brain/chats`, "POST", "synchronize"],
  ] as const)("%s %s → %s", (url, method, capability) => {
    expect(platformCapabilityFor(url, { method })).toBe(capability);
  });

  it("leaves a non-platform origin unclassified", () => {
    expect(platformCapabilityFor("http://127.0.0.1:11434/v1/chat/completions", { method: "POST" })).toBeNull();
  });
});
