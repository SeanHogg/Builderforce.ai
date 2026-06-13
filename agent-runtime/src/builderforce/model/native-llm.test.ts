/**
 * Proves the native LLM client (pi-ai replacement core) parses the gateway's
 * OpenAI-compatible responses — non-streaming `complete` and SSE `stream` (text +
 * tool-call deltas) — with no third-party SDK.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
