import { describe, it, expect, afterEach, vi } from "vitest";
import {
  GATEWAY_COMPLETIONS_PATH,
  LOCAL_MODEL_PREFIX,
  completeLocal,
  formatLocalModelRef,
  resolveLocalChatEndpoint,
  isLocalModelRef,
  listLocalModels,
  listProviderModels,
  localChatCompletionsUrl,
  localModelsUrl,
  localModelOptions,
  LOCAL_PROVIDER_LABEL,
  localTransport,
  normalizeLocalBaseUrl,
  parseLocalModelRef,
  rewriteToLocalUrl,
} from "./localModels";

/**
 * The on-device path's contract. Two things here are load-bearing and invisible at the
 * call site, so they are pinned by test rather than by comment:
 *
 *  - the ref grammar must survive an Ollama model id, which legitimately contains `:`
 *    AND `/` (`hf.co/user/repo:q4`) — a naive split would truncate the model and pin a
 *    model that does not exist;
 *  - the transport must rewrite the SHARED streamer's hard-coded gateway path onto the
 *    runtime's plain OpenAI route, and send NO bearer token. If `streamChatCompletion`
 *    ever changes that path, `GATEWAY_COMPLETIONS_PATH` stops matching and this suite
 *    fails — which is the point, because the alternative is a silent 404 per turn.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("local model refs", () => {
  it("round-trips a plain model id", () => {
    const ref = formatLocalModelRef("freetoken", "gpt-oss-20b");
    expect(ref).toBe("local/freetoken/gpt-oss-20b");
    expect(parseLocalModelRef(ref)).toEqual({ provider: "freetoken", model: "gpt-oss-20b" });
  });

  it("keeps an Ollama id containing ':' and '/' intact", () => {
    const ref = formatLocalModelRef("ollama", "hf.co/user/repo:q4_K_M");
    expect(parseLocalModelRef(ref)).toEqual({ provider: "ollama", model: "hf.co/user/repo:q4_K_M" });
  });

  it("rejects anything that is not a local pin", () => {
    for (const ref of [
      undefined,
      "",
      "claude-sonnet-4",
      "direct/ollama-local/default", // the CLOUD relay vendor — not this path
      "project_evermind:12",
      "local/", // no provider
      "local/ollama", // no model
      "local/ollama/", // empty model
      "local/lmstudio/foo", // unknown runtime
    ]) {
      expect(parseLocalModelRef(ref)).toBeNull();
      expect(isLocalModelRef(ref)).toBe(false);
    }
  });

  it("uses the documented prefix", () => {
    expect(formatLocalModelRef("ollama", "x").startsWith(LOCAL_MODEL_PREFIX)).toBe(true);
  });
});

describe("base URL normalization", () => {
  it("accepts the bare origin and the documented /v1 form identically", () => {
    for (const raw of [
      "http://127.0.0.1:1919",
      "http://127.0.0.1:1919/",
      "http://127.0.0.1:1919/v1",
      "http://127.0.0.1:1919/v1/",
      "  http://127.0.0.1:1919/v1  ",
    ]) {
      expect(normalizeLocalBaseUrl(raw)).toBe("http://127.0.0.1:1919");
    }
  });

  it("appends the OpenAI routes exactly once", () => {
    expect(localChatCompletionsUrl("http://127.0.0.1:1919/v1")).toBe("http://127.0.0.1:1919/v1/chat/completions");
    expect(localModelsUrl("http://127.0.0.1:11434/")).toBe("http://127.0.0.1:11434/v1/models");
  });
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

describe("transport", () => {
  it("rewrites the shared streamer's gateway path onto the runtime's OpenAI route", () => {
    expect(rewriteToLocalUrl(`http://127.0.0.1:1919${GATEWAY_COMPLETIONS_PATH}`)).toBe(
      "http://127.0.0.1:1919/v1/chat/completions",
    );
  });

  it("leaves an unrecognized URL alone rather than mangling it", () => {
    expect(rewriteToLocalUrl("http://127.0.0.1:1919/v1/models")).toBe("http://127.0.0.1:1919/v1/models");
  });

  it("sends no bearer token and rewrites through its fetch", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      seen.push(input);
      return new Response("{}", { status: 200 });
    });
    const transport = localTransport({ baseUrl: "http://127.0.0.1:1919/v1" }, fetchImpl);

    // A local runtime has no account: a null token is what makes the streamer omit the
    // Authorization header, which is what lets a signed-out editor run a local turn.
    expect(transport.getToken()).toBeNull();
    expect(transport.baseUrl).toBe("http://127.0.0.1:1919");

    await transport.fetch?.(`${transport.baseUrl}${GATEWAY_COMPLETIONS_PATH}`, {});
    expect(seen).toEqual(["http://127.0.0.1:1919/v1/chat/completions"]);
  });
});

describe("catalog discovery", () => {
  it("maps an OpenAI-compatible /v1/models payload to pinnable refs", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-oss-20b" }, { id: "qwen3:8b" }, { id: 42 }] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const models = await listProviderModels("freetoken", "http://127.0.0.1:1919");
    // The non-string id is dropped rather than pinned as "42".
    expect(models.map((m) => m.ref)).toEqual(["local/freetoken/gpt-oss-20b", "local/freetoken/qwen3:8b"]);
  });

  it("treats an unreachable runtime as 'no models', not an error", async () => {
    // The NORMAL case: a developer running only one of the two runtimes still opens the
    // picker, and a dead port must not throw through it.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(listProviderModels("ollama", "http://127.0.0.1:11434")).resolves.toEqual([]);
  });

  it("treats a non-OK response as 'no models'", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(listProviderModels("ollama", "http://127.0.0.1:11434")).resolves.toEqual([]);
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
});

describe("rows for the shared model-list builder", () => {
  it("converts discovered models into list rows once, for both pickers", () => {
    // The panel's menu and the QuickPick both build from these. They used to disagree
    // because only the QuickPick knew local models existed at all.
    expect(
      localModelOptions([
        { ref: "local/freetoken/gpt-oss-20b", provider: "freetoken", model: "gpt-oss-20b" },
        { ref: "local/ollama/qwen3:8b", provider: "ollama", model: "qwen3:8b" },
      ]),
    ).toEqual([
      { id: "local/freetoken/gpt-oss-20b", label: "gpt-oss-20b", runtime: "FreeToken" },
      { id: "local/ollama/qwen3:8b", label: "qwen3:8b", runtime: "Ollama" },
    ]);
  });

  it("pins the id to the REF, not the bare model name", () => {
    // The id becomes the selection. A bare name would pin something the router cannot
    // resolve to a runtime — and would collide with a gateway model of the same name.
    const [row] = localModelOptions([{ ref: "local/ollama/llama3.1-8b", provider: "ollama", model: "llama3.1-8b" }]);
    expect(row.id.startsWith(LOCAL_MODEL_PREFIX)).toBe(true);
    expect(parseLocalModelRef(row.id)).toEqual({ provider: "ollama", model: "llama3.1-8b" });
  });

  it("names every runtime without translating them", () => {
    expect(LOCAL_PROVIDER_LABEL).toEqual({
      ollama: "Ollama",
      freetoken: "FreeToken",
      "kimi-code": "Kimi Code",
    });
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

  it("sends the bearer on a Kimi turn and omits it entirely for an on-device one", async () => {
    const kimi = localTransport({ baseUrl: "https://api.kimi.com/coding/v1", token: "kc-token" });
    expect(kimi.getToken()).toBe("kc-token");
    // Null (not "") is what makes the shared streamer omit the header outright — an empty
    // Bearer would be sent and rejected.
    expect(localTransport({ baseUrl: "http://127.0.0.1:1919" }).getToken()).toBeNull();
  });

  it("authenticates the non-streaming completion path too", async () => {
    let seen: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    // The codebase scanner rides this path; without the header it would 401 on a model
    // the picker had just offered.
    await completeLocal({ baseUrl: "https://api.kimi.com/coding/v1", token: "kc-token" }, "k3", [
      { role: "user", content: "hi" },
    ]);
    expect(seen.authorization).toBe("Bearer kc-token");
  });
});
