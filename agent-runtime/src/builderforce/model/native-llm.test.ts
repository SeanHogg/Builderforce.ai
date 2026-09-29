/**
 * Proves the native LLM client (pi-ai replacement core) parses the gateway's
 * OpenAI-compatible responses — non-streaming `complete` and SSE `stream` (text +
 * tool-call deltas) — with no third-party SDK.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayLlmService } from "../../infra/gateway-llm-service.js";
import { nativeComplete, nativeStream, type LlmStreamEvent } from "./native-llm.js";

const client = { baseUrl: "https://gw.test", apiKey: "k" };
const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

describe("native-llm client", () => {
  it("complete parses content + tool_calls from a JSON response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "thinking",
                tool_calls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: "{}" } }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const r = await nativeComplete(client, { messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("thinking");
    expect(r.finishReason).toBe("tool_calls");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].function?.name).toBe("write_file");
  });

  it("stream assembles text + tool-call deltas across SSE frames", async () => {
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "finish", arguments: '{"sum' } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'mary":"ok"}' } }] }, finish_reason: "tool_calls" }] })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn(async () => new Response(stream, { status: 200 })) as typeof fetch;

    const events: LlmStreamEvent[] = [];
    const result = await nativeStream(client, { messages: [{ role: "user", content: "hi" }] }, (e) => events.push(e));

    expect(result.content).toBe("Hello");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function?.name).toBe("finish");
    expect(result.toolCalls[0].function?.arguments).toBe('{"summary":"ok"}');
    expect(events.some((e) => e.type === "text-delta")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("stream keeps a last frame that has no blank-line terminator and releases the body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n`));
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "b" } }] })}`));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn(async () => new Response(stream, { status: 200 })) as typeof fetch;

    const result = await nativeStream(client, { messages: [] }, () => {});
    expect(result.content).toBe("ab");
    expect(stream.locked).toBe(false);
  });

  it("posts to {baseUrl}/v1/chat/completions with the default model and maps a non-2xx to `gateway {status}: {body}`", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      nativeComplete({ ...client, baseUrl: "https://gw.test//", defaultModel: "m-default" }, { messages: [] }),
    ).rejects.toThrow("gateway 429: rate limited");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gw.test/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toEqual({ model: "m-default", messages: [] });
  });
});

describe("GatewayLlmService", () => {
  it("sends system + prompt with the provider as a routing extra, and returns the reply", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const svc = new GatewayLlmService(client);
    const out = await svc.complete({ provider: "anthropic", model: "m", system: "sys", prompt: "p", temperature: 0 });
    expect(out).toBe("done");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({
      model: "m",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "p" },
      ],
      temperature: 0,
      provider: "anthropic",
    });
  });

  it("turns a gateway failure into the node's [llm] output instead of throwing", async () => {
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as typeof fetch;
    const out = await new GatewayLlmService(client).complete({ prompt: "p" });
    expect(out).toBe("[llm] request failed: gateway 503: down");
  });
});
