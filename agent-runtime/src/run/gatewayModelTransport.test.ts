import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunMessage } from "@builderforce/agent-run";
import {
  GATEWAY_MAX_ATTEMPTS,
  gatewayModelTransport,
  isNetworkFailure,
  isRetryableStatus,
  retryDelayMs,
  wireMessage,
} from "./gatewayModelTransport.js";

/** The wire package's `chatComplete` reads the global `fetch`, so the tests stand in for it. */
function stubFetch(...answers: Array<Response | Error>) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    const next = answers.shift();
    if (!next) throw new Error("fetch script exhausted");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (content = "ok") => answer({ choices: [{ message: { content } }] });
const networkFailure = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
const base = { baseUrl: "https://gw.test/llm/", apiKey: "k", sleep: async () => undefined };
const go = { messages: [{ role: "user" as const, content: "go" }] };

afterEach(() => vi.unstubAllGlobals());

describe("wireMessage", () => {
  it("maps the agent's rows to the OpenAI-compatible wire", () => {
    const rows: RunMessage[] = [
      { role: "system", content: "persona" },
      { role: "user", content: "do it" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", arguments: '{"path":"a.ts"}' }] },
      { role: "tool", toolCallId: "c1", content: '{"ok":true}' },
    ];
    expect(rows.map(wireMessage)).toEqual([
      { role: "system", content: "persona" },
      { role: "user", content: "do it" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] },
      { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
    ]);
  });

  it("normalises a no-argument call to an empty object (strict vendors reject an empty string)", () => {
    const row: RunMessage = { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "finish", arguments: "  " }] };
    expect(wireMessage(row)).toMatchObject({ tool_calls: [{ function: { arguments: "{}" } }] });
  });
});

describe("gatewayModelTransport", () => {
  it("posts to /v1/chat/completions with the key, the declaration and one idempotency key, and maps the answer", async () => {
    const fetchMock = stubFetch(
      answer({
        model: "gw-model",
        choices: [{ message: { content: "hi", tool_calls: [{ id: "t1", function: { name: "read_file", arguments: '{"path":"a"}' } }, { function: { name: "finish" } }] } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 5 } },
      }),
    );
    const transport = gatewayModelTransport({ ...base, surface: "on_prem", executionId: 9 });

    const completion = await transport.complete({ messages: [{ role: "user", content: "go" }], model: "m", maxTokens: 100 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gw.test/llm/v1/chat/completions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer k",
      "x-builderforce-surface": "on_prem",
      "x-builderforce-execution-id": "9",
      "Idempotency-Key": expect.stringMatching(/^[\x21-\x7e]{1,128}$/),
    });
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m", max_tokens: 100, messages: [{ role: "user", content: "go" }] });
    expect(completion).toEqual({
      content: "hi",
      toolCalls: [
        { id: "t1", name: "read_file", arguments: '{"path":"a"}' },
        { id: "call-2", name: "finish", arguments: "{}" },
      ],
      usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 5 },
      model: "gw-model",
    });
  });

  it("retries a 429, a 529, a 5xx and a network failure with backoff, then succeeds — on ONE idempotency key", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const fetchMock = stubFetch(answer({ error: "slow down" }, 429), answer({ error: "overloaded" }, 529), networkFailure(), ok());
    const transport = gatewayModelTransport({ ...base, sleep });

    const completion = await transport.complete(go);

    expect(completion.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
    const keys = fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(1);
  });

  it("gives each call its own idempotency key", async () => {
    const fetchMock = stubFetch(ok(), ok());
    const transport = gatewayModelTransport(base);
    await transport.complete(go);
    await transport.complete(go);
    const keys = fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(2);
  });

  it("retries a request that timed out", async () => {
    const fetchMock = stubFetch(Object.assign(new Error("signal timed out"), { name: "TimeoutError" }), ok());
    await gatewayModelTransport(base).complete(go);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies what is worth another attempt", () => {
    expect([429, 529, 500, 502, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 404, 409].some(isRetryableStatus)).toBe(false);
    expect(isNetworkFailure(networkFailure())).toBe(true);
    expect(isNetworkFailure(new TypeError("x is not a function"))).toBe(false);
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
    expect([retryDelayMs(1), retryDelayMs(2), retryDelayMs(3), retryDelayMs(20)]).toEqual([500, 1000, 2000, 10_000]);
  });

  it("gives up after the attempt budget and throws the gateway's status", async () => {
    const fetchMock = stubFetch(...Array.from({ length: GATEWAY_MAX_ATTEMPTS }, () => answer({ error: "down" }, 503)));
    await expect(gatewayModelTransport(base).complete(go)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(GATEWAY_MAX_ATTEMPTS);
  });

  it("does not retry a client error", async () => {
    const fetchMock = stubFetch(answer({ error: "bad key" }, 401));
    await expect(gatewayModelTransport(base).complete(go)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry once the run was stopped", async () => {
    const stop = new AbortController();
    const fetchMock = vi.fn(async () => {
      stop.abort();
      return answer({ error: "overloaded" }, 529);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(gatewayModelTransport(base).complete(go, stop.signal)).rejects.toMatchObject({ status: 529 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ends a backoff the moment the run is stopped", async () => {
    const stop = new AbortController();
    stubFetch(answer({ error: "slow down" }, 429), ok());
    // The default wait: a long backoff that must NOT outlive the stop.
    const transport = gatewayModelTransport({ baseUrl: base.baseUrl, apiKey: "k" });
    const running = transport.complete(go, stop.signal);
    setTimeout(() => stop.abort(new Error("stopped")), 20);
    const startedAt = Date.now();
    await expect(running).rejects.toThrow("stopped");
    expect(Date.now() - startedAt).toBeLessThan(400);
  });

  it("reports the host's context window when it has one", () => {
    const window = (model: string) => (model === "m" ? 128_000 : undefined);
    expect(gatewayModelTransport({ ...base, window }).window?.("m")).toBe(128_000);
    expect(gatewayModelTransport(base).window).toBeUndefined();
  });
});
