import { describe, expect, it, vi } from "vitest";
import type { RunMessage } from "@builderforce/agent-run";
import {
  GATEWAY_MAX_ATTEMPTS,
  gatewayModelTransport,
  isRetryableStatus,
  retryDelayMs,
  wireMessage,
} from "./gatewayModelTransport.js";

const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

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
  const base = { baseUrl: "https://gw.test/llm/", apiKey: "k", sleep: async () => undefined };

  it("posts to /v1/chat/completions with the key and the declaration headers, and maps the answer", async () => {
    const fetchImpl = vi.fn(async () =>
      answer({
        model: "gw-model",
        choices: [{ message: { content: "hi", tool_calls: [{ id: "t1", function: { name: "read_file", arguments: '{"path":"a"}' } }, { function: { name: "finish" } }] } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 5 } },
      }),
    );
    const transport = gatewayModelTransport({ ...base, surface: "on_prem", executionId: 9, fetchImpl: fetchImpl as never });

    const completion = await transport.complete({ messages: [{ role: "user", content: "go" }], model: "m", maxTokens: 100 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gw.test/llm/v1/chat/completions");
    expect(init.headers).toMatchObject({
      authorization: "Bearer k",
      "x-builderforce-surface": "on_prem",
      "x-builderforce-execution-id": "9",
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

  it("retries a 429, a 529 and a 5xx with backoff, then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(answer({ error: "slow down" }, 429))
      .mockResolvedValueOnce(answer({ error: "overloaded" }, 529))
      .mockResolvedValueOnce(answer({ error: "bad gateway" }, 502))
      .mockResolvedValueOnce(answer({ choices: [{ message: { content: "ok" } }] }));
    const transport = gatewayModelTransport({ ...base, sleep, fetchImpl: fetchImpl as never });

    const completion = await transport.complete({ messages: [{ role: "user", content: "go" }] });

    expect(completion.content).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
  });

  it("honours Retry-After, capped", async () => {
    expect(retryDelayMs(1, "2")).toBe(2000);
    expect(retryDelayMs(1, "3600")).toBe(10_000);
    expect(retryDelayMs(3, null)).toBe(2000);
  });

  it("gives up after the attempt budget and throws the gateway's status", async () => {
    const fetchImpl = vi.fn(async () => answer({ error: "down" }, 503));
    const transport = gatewayModelTransport({ ...base, fetchImpl: fetchImpl as never });

    await expect(transport.complete({ messages: [{ role: "user", content: "go" }] })).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(GATEWAY_MAX_ATTEMPTS);
  });

  it("does not retry a client error", async () => {
    const fetchImpl = vi.fn(async () => answer({ error: "bad key" }, 401));
    const transport = gatewayModelTransport({ ...base, fetchImpl: fetchImpl as never });

    await expect(transport.complete({ messages: [{ role: "user", content: "go" }] })).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([401, 400, 404].some(isRetryableStatus)).toBe(false);
  });

  it("does not retry once the run was stopped", async () => {
    const stop = new AbortController();
    const fetchImpl = vi.fn(async () => {
      stop.abort();
      return answer({ error: "overloaded" }, 529);
    });
    const transport = gatewayModelTransport({ ...base, fetchImpl: fetchImpl as never });

    await expect(transport.complete({ messages: [{ role: "user", content: "go" }] }, stop.signal)).rejects.toMatchObject({ status: 529 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds a request with a timeout signal", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return answer({ choices: [{ message: { content: "ok" } }] });
    });
    const transport = gatewayModelTransport({ ...base, timeoutMs: 5_000, fetchImpl: fetchImpl as never });
    await transport.complete({ messages: [{ role: "user", content: "go" }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports the host's context window when it has one", () => {
    const window = (model: string) => (model === "m" ? 128_000 : undefined);
    expect(gatewayModelTransport({ ...base, window }).window?.("m")).toBe(128_000);
    expect(gatewayModelTransport(base).window).toBeUndefined();
  });
});
