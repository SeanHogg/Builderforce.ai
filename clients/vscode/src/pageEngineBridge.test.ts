import { describe, expect, it } from "vitest";
import type { LocalRuntimeProbe } from "@builderforce/local-inference";
import { PageEngineError, type ChatCompletionChunk, type PageEngine } from "@seanhogg/builderforce-brain-embedded";
import { createHostPageEngineBridge, type HostPageEngineBridge } from "./pageEngineBridge";
import type { PageEngineRequest } from "./pageEngineBridgeProtocol";
import { servePageEngines } from "../webview/src/pageEngineHost";

/**
 * The editor's page-engine bridge, end to end over a fake postMessage: the host's proxy
 * engines on one side, the webview's `servePageEngines` over real `PageEngine`s on the
 * other, and frames delivered asynchronously in both directions as VS Code does.
 */

const MODEL = "Qwen3-4B-q4f16_1-MLC";
const URL_ = "http://webllm.local/v1/chat/completions";

const probe: LocalRuntimeProbe = {
  provider: "webllm",
  endpoint: { baseUrl: "http://webllm.local" },
  reachable: true,
  models: [{ ref: `local/webllm/${MODEL}`, provider: "webllm", model: MODEL }],
} as LocalRuntimeProbe;

const chunk = (content: string): ChatCompletionChunk => ({
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
});

function webllmEngine(chat: PageEngine["chatCompletions"]): PageEngine {
  return {
    runtime: "webllm",
    baseUrl: "http://webllm.local",
    probe: async () => probe,
    invalidate: () => undefined,
    chatCompletions: chat,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Host bridge + webview server joined by an async fake postMessage. */
function connect(engine: PageEngine): { host: HostPageEngineBridge; detach: () => void } {
  const host = createHostPageEngineBridge({ probeTimeoutMs: 200 });
  let toWebview: ((request: PageEngineRequest) => void) | undefined;
  servePageEngines(() => [engine], {
    reply: (type, payload) => queueMicrotask(() => host.receive({ type, ...payload })),
    listen: (onRequest) => {
      toWebview = onRequest;
      return () => {
        toWebview = undefined;
      };
    },
  });
  const detach = host.attach({ post: (message) => queueMicrotask(() => toWebview?.(message)) });
  return { host, detach };
}

const streamRequest = (signal?: AbortSignal): RequestInit => ({
  method: "POST",
  body: JSON.stringify({ model: MODEL, stream: true, messages: [{ role: "user", content: "hi" }] }),
  ...(signal ? { signal } : {}),
});

describe("page-engine bridge (host ↔ webview)", () => {
  it("answers the host's probe from the webview's engine", async () => {
    const { host } = connect(webllmEngine(async () => (async function* () {})()));
    const probes = await host.probe({ fresh: true });
    expect(probes.map((p) => p.provider)).toEqual(["webllm"]);
    expect(probes[0]!.models[0]!.ref).toBe(`local/webllm/${MODEL}`);
  });

  it("probes as absent and refuses a chat with 503 when no webview is attached", async () => {
    const host = createHostPageEngineBridge();
    expect(host.connected()).toBe(false);
    expect(await host.probe()).toEqual([]);
    const res = await host.fetch()(URL_, streamRequest());
    expect(res.status).toBe(503);
  });

  it("streams the webview engine's chunks back as OpenAI SSE", async () => {
    const { host } = connect(
      webllmEngine(async () =>
        (async function* () {
          yield chunk("Hel");
          yield chunk("lo");
        })(),
      ),
    );
    const res = await host.fetch()(URL_, streamRequest());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"content":"Hel"');
    expect(text).toContain('"content":"lo"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("keeps an engine refusal's status across the bridge", async () => {
    const { host } = connect(
      webllmEngine(async () => {
        throw new PageEngineError(413, "context_too_large", "prompt exceeds the window");
      }),
    );
    const res = await host.fetch()(URL_, streamRequest());
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: "context_too_large", message: "prompt exceeds the window" } });
  });

  it("propagates a Stop on the host to the webview's engine", async () => {
    let sawAbort = false;
    const { host } = connect(
      webllmEngine(async (_body, signal) =>
        (async function* () {
          yield chunk("first");
          await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
          sawAbort = true;
        })(),
      ),
    );
    const controller = new AbortController();
    const res = await host.fetch()(URL_, streamRequest(controller.signal));
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"content":"first"');
    controller.abort();
    await tick();
    await tick();
    expect(sawAbort).toBe(true);
  });

  it("ends an answer in flight with an error frame when the webview goes away", async () => {
    const { host, detach } = connect(
      webllmEngine(async () =>
        (async function* () {
          yield chunk("partial");
          await new Promise(() => undefined); // never finishes on its own
        })(),
      ),
    );
    const res = await host.fetch()(URL_, streamRequest());
    const reader = res.body!.getReader();
    await reader.read();
    detach();
    const rest = new TextDecoder().decode((await reader.read()).value);
    expect(rest).toContain('"error"');
    expect(host.connected()).toBe(false);
  });
});
