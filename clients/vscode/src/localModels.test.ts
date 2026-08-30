import { describe, it, expect, afterEach, vi } from "vitest";
import {
  GATEWAY_COMPLETIONS_PATH,
  LOCAL_MODEL_PREFIX,
  formatLocalModelRef,
  isLocalChatEndpoint,
  isLocalModelRef,
  listLocalModels,
  listProviderModels,
  localChatCompletionsUrl,
  localModelsUrl,
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
    baseUrls: { ollama: "http://127.0.0.1:11434", freetoken: "http://127.0.0.1:1919" },
  };

  it("allows exactly the configured chat endpoints", () => {
    expect(isLocalChatEndpoint(config, "http://127.0.0.1:11434/v1/chat/completions")).toBe(true);
    expect(isLocalChatEndpoint(config, "http://127.0.0.1:1919/v1/chat/completions")).toBe(true);
  });

  it("refuses any other path on a configured origin — this is not a same-origin proxy", () => {
    for (const url of [
      "http://127.0.0.1:11434/v1/models",
      "http://127.0.0.1:11434/api/pull", // Ollama's model-management surface
      "http://127.0.0.1:1919/",
      "http://127.0.0.1:1919/v1/chat/completions/../../admin",
    ]) {
      expect(isLocalChatEndpoint(config, url), url).toBe(false);
    }
  });

  it("refuses an origin the host never configured", () => {
    for (const url of [
      "http://127.0.0.1:9999/v1/chat/completions",
      "http://169.254.169.254/v1/chat/completions", // cloud metadata
      "https://evil.example/v1/chat/completions",
      "http://localhost:1919/v1/chat/completions", // same host, different origin string
    ]) {
      expect(isLocalChatEndpoint(config, url), url).toBe(false);
    }
  });

  it("opens nothing for a provider whose URL was blanked", () => {
    const partial = { enabled: true, baseUrls: { ollama: "", freetoken: "http://127.0.0.1:1919" } };
    expect(isLocalChatEndpoint(partial, "http://127.0.0.1:1919/v1/chat/completions")).toBe(true);
    // An empty base must not normalize into a prefix that matches anything.
    expect(isLocalChatEndpoint(partial, "/v1/chat/completions")).toBe(false);
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
    const transport = localTransport("http://127.0.0.1:1919/v1", fetchImpl);

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
        baseUrls: { ollama: "http://127.0.0.1:11434", freetoken: "http://127.0.0.1:1919" },
      }),
    ).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips a provider whose URL was blanked", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const models = await listLocalModels({
      enabled: true,
      baseUrls: { ollama: "", freetoken: "http://127.0.0.1:1919" },
    });
    expect(models.map((m) => m.ref)).toEqual(["local/freetoken/m"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
