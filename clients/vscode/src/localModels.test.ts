import { describe, it, expect, afterEach, vi } from "vitest";
import { LOCAL_MODEL_PREFIX, parseLocalModelRef } from "@builderforce/local-inference";
import { resolveLocalChatEndpoint, listLocalModels, localModelOptions } from "./localModels";

/**
 * The editor's binding of `@builderforce/local-inference`: the endpoints it hands the
 * probe, the picker rows and the proxy fence. The ref grammar, URL rules and probe are
 * pinned in that package's suite; the transports (pinned and local-first) in
 * brain-embedded's `localFirstTransport.test.ts`.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("the host-proxy destination fence", () => {
  const config = {
    enabled: true,
    endpoints: {
      ollama: { baseUrl: "http://127.0.0.1:11434" },
      freetoken: { baseUrl: "http://127.0.0.1:1919" },
    },
  };

  it("allows exactly the configured chat endpoints", () => {
    expect(resolveLocalChatEndpoint(config, "http://127.0.0.1:11434/v1/chat/completions")).not.toBeNull();
    expect(resolveLocalChatEndpoint(config, "http://127.0.0.1:1919/v1/chat/completions")).not.toBeNull();
  });

  it("refuses any other path on a configured origin — this is not a same-origin proxy", () => {
    for (const url of [
      "http://127.0.0.1:11434/v1/models",
      "http://127.0.0.1:11434/api/pull", // Ollama's model-management surface
      "http://127.0.0.1:1919/",
      "http://127.0.0.1:1919/v1/chat/completions/../../admin",
    ]) {
      expect(resolveLocalChatEndpoint(config, url), url).toBeNull();
    }
  });

  it("refuses an origin the host never configured", () => {
    for (const url of [
      "http://127.0.0.1:9999/v1/chat/completions",
      "http://169.254.169.254/v1/chat/completions", // cloud metadata
      "https://evil.example/v1/chat/completions",
      "http://localhost:1919/v1/chat/completions", // same host, different origin string
    ]) {
      expect(resolveLocalChatEndpoint(config, url), url).toBeNull();
    }
  });

  it("opens nothing for a provider whose URL was blanked", () => {
    const partial = {
      enabled: true,
      endpoints: { ollama: { baseUrl: "" }, freetoken: { baseUrl: "http://127.0.0.1:1919" } },
    };
    expect(resolveLocalChatEndpoint(partial, "http://127.0.0.1:1919/v1/chat/completions")).not.toBeNull();
    // An empty base must not normalize into a prefix that matches anything.
    expect(resolveLocalChatEndpoint(partial, "/v1/chat/completions")).toBeNull();
  });
});

describe("catalog discovery", () => {
  it("lists every probed runtime's models as pinnable refs", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-oss-20b" }, { id: "qwen3:8b" }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const models = await listLocalModels({
      enabled: true,
      endpoints: { ollama: { baseUrl: "" }, freetoken: { baseUrl: "http://127.0.0.1:1919" } },
    });
    expect(models.map((m) => m.ref)).toEqual(["local/freetoken/gpt-oss-20b", "local/freetoken/qwen3:8b"]);
  });

  it("treats an unreachable runtime as 'no models', not an error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(
      listLocalModels({ enabled: true, endpoints: { ollama: { baseUrl: "http://127.0.0.1:11434" } } }),
    ).resolves.toEqual([]);
  });

  it("probes nothing at all while the feature is off", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(
      listLocalModels({
        enabled: false,
        endpoints: {
          ollama: { baseUrl: "http://127.0.0.1:11434" },
          freetoken: { baseUrl: "http://127.0.0.1:1919" },
        },
      }),
    ).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips a provider whose URL was blanked", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const models = await listLocalModels({
      enabled: true,
      endpoints: { ollama: { baseUrl: "" }, freetoken: { baseUrl: "http://127.0.0.1:1919" } },
    });
    expect(models.map((m) => m.ref)).toEqual(["local/freetoken/m"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("skips Synapse when no desktop endpoint was discovered", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const models = await listLocalModels({
      enabled: true,
      endpoints: { ollama: { baseUrl: "http://127.0.0.1:11434" }, freetoken: { baseUrl: "" } },
    });
    expect(models.map((m) => m.ref)).toEqual(["local/ollama/m"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("lists Synapse models when desktop.json published an endpoint", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("11435")) {
        return new Response(JSON.stringify({ data: [{ id: "qwen3:8b" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const models = await listLocalModels({
      enabled: true,
      endpoints: {
        ollama: { baseUrl: "" },
        freetoken: { baseUrl: "" },
        synapse: { baseUrl: "http://127.0.0.1:11435", token: "desk-token" },
      },
    });
    expect(models.map((m) => m.ref)).toEqual(["local/synapse/qwen3:8b"]);
  });
});

describe("rows for the shared model-list builder", () => {
  it("converts discovered models into list rows once, for both pickers", () => {
    // The panel's menu and the QuickPick both build from these. They used to disagree
    // because only the QuickPick knew local models existed at all.
    expect(
      localModelOptions([
        { ref: "local/freetoken/gpt-oss-20b", provider: "freetoken", model: "gpt-oss-20b" },
        { ref: "local/ollama/qwen3:8b", provider: "ollama", model: "qwen3:8b" },
        { ref: "local/synapse/llama-3.1-8b", provider: "synapse", model: "llama-3.1-8b" },
      ]),
    ).toEqual([
      { id: "local/freetoken/gpt-oss-20b", label: "gpt-oss-20b", runtime: "FreeToken" },
      { id: "local/ollama/qwen3:8b", label: "qwen3:8b", runtime: "Ollama" },
      { id: "local/synapse/llama-3.1-8b", label: "llama-3.1-8b", runtime: "Synapse" },
    ]);
  });

  it("pins the id to the REF, not the bare model name", () => {
    // The id becomes the selection. A bare name would pin something the router cannot
    // resolve to a runtime — and would collide with a gateway model of the same name.
    const [row] = localModelOptions([{ ref: "local/ollama/llama3.1-8b", provider: "ollama", model: "llama3.1-8b" }]);
    expect(row.id.startsWith(LOCAL_MODEL_PREFIX)).toBe(true);
    expect(parseLocalModelRef(row.id)).toEqual({ provider: "ollama", model: "llama3.1-8b" });
  });

  it("has nothing to offer when nothing was discovered", () => {
    expect(localModelOptions([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Kimi Code. It rides the SAME "the extension host makes the call" path as the on-device
// engines, for a different reason: not that the weights are local, but that Kimi's edge
// refuses our hosted gateway before reading a credential while accepting the identical
// request from the developer's own machine. That makes it the first local provider that
// carries an account — hence a bearer, hence the containment rules below.
// ---------------------------------------------------------------------------
describe("kimi-code as a locally-served provider", () => {
  const kimiConfig = {
    enabled: true,
    endpoints: {
      ollama: { baseUrl: "http://127.0.0.1:11434" },
      freetoken: { baseUrl: "http://127.0.0.1:1919" },
      "kimi-code": { baseUrl: "https://api.kimi.com/coding/v1", token: "kc-secret-token-value" },
    },
    kimiCodeModels: [
      { model: "kimi-for-coding", displayName: "K2.7 Coding" },
      { model: "k3", displayName: "K3" },
    ],
  };

  it("lists Kimi's models WITHOUT a network probe — its catalog is already on disk", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const models = await listLocalModels(kimiConfig);

    expect(models.filter((m) => m.provider === "kimi-code").map((m) => m.ref)).toEqual([
      "local/kimi-code/kimi-for-coding",
      "local/kimi-code/k3",
    ]);
    // Only the two on-device engines were probed; Kimi contributed no round trip.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("offers no Kimi rows when no install was discovered", async () => {
    // A machine without Kimi Code (or signed out) must show the picker unchanged.
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
    const models = await listLocalModels({
      enabled: true,
      endpoints: { ollama: { baseUrl: "" }, freetoken: { baseUrl: "" } },
      kimiCodeModels: [{ model: "k3", displayName: "K3" }],
    });
    expect(models).toEqual([]);
  });

  it("shows Kimi's own display name in the picker, not the wire id", () => {
    const [row] = localModelOptions([
      { ref: "local/kimi-code/kimi-for-coding", provider: "kimi-code", model: "kimi-for-coding", label: "K2.7 Coding" },
    ]);
    expect(row).toEqual({ id: "local/kimi-code/kimi-for-coding", label: "K2.7 Coding", runtime: "Kimi Code" });
  });

  it("still falls back to the bare id for a runtime that publishes no label", () => {
    const [row] = localModelOptions([{ ref: "local/ollama/qwen3:8b", provider: "ollama", model: "qwen3:8b" }]);
    expect(row.label).toBe("qwen3:8b");
  });

  it("fences the Kimi endpoint and hands back the credential it takes", () => {
    const resolved = resolveLocalChatEndpoint(kimiConfig, "https://api.kimi.com/coding/v1/chat/completions");
    expect(resolved).toEqual({
      provider: "kimi-code",
      endpoint: { baseUrl: "https://api.kimi.com/coding/v1", token: "kc-secret-token-value" },
    });
    // One lookup answers both "may this be called?" and "with what?" — a fence and a
    // separate credential lookup could disagree, and either answer would be a defect.
    expect(resolveLocalChatEndpoint(kimiConfig, "https://api.kimi.com/coding/v1/models")).toBeNull();
    expect(resolveLocalChatEndpoint(kimiConfig, "https://evil.example/v1/chat/completions")).toBeNull();
  });

  it("returns NO token for an on-device engine, so it stays usable signed out", () => {
    const resolved = resolveLocalChatEndpoint(kimiConfig, "http://127.0.0.1:1919/v1/chat/completions");
    expect(resolved?.provider).toBe("freetoken");
    expect(resolved?.endpoint.token).toBeUndefined();
  });
});
