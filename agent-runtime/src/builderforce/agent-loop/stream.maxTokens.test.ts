import { afterEach, describe, expect, it, vi } from "vitest";
import type { Model } from "../model/types.js";
import { createGatewayStreamFn } from "./stream.js";

const model = { id: "m", provider: "p", api: "openai-completions", baseUrl: "https://gw.test", contextWindow: 16_384, maxTokens: 4_096 } as unknown as Model;

/** Run one turn against a stubbed gateway and return the JSON body it was sent. */
async function bodyOf(options: { maxTokens?: number }): Promise<Record<string, unknown>> {
  let sent: Record<string, unknown> = {};
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return new Response('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
  }));
  const stream = await createGatewayStreamFn({ baseUrl: "https://gw.test", apiKey: "k" })(model, { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 0 }] }, { apiKey: "k", ...options });
  await stream.result();
  return sent;
}

describe("the default stream and the turn's reply bound", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends max_tokens when the agent set one (a window forced it)", async () => {
    expect((await bodyOf({ maxTokens: 4_096 })).max_tokens).toBe(4_096);
  });

  it("sends none when the agent set none: the provider's own limit stands", async () => {
    expect("max_tokens" in (await bodyOf({}))).toBe(false);
  });
});
