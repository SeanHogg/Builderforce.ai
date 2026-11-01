import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Model, ToolCall } from "../model/types.js";
import { createGatewayStreamFn } from "./stream.js";

const model = { id: "m", provider: "p", api: "openai-completions", baseUrl: "https://gw.test", contextWindow: 16_384, maxTokens: 4_096 } as unknown as Model;

const frame = (delta: Record<string, unknown>, finish?: string): string => `data: ${JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`;
const call = (args: string) => frame({ tool_calls: [{ index: 0, id: "c1", function: { name: "write_file", arguments: args } }] });

/** One turn against a stubbed gateway that answers with these SSE frames. */
async function turn(...frames: string[]): Promise<AssistantMessage> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(`${frames.join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } })));
  const stream = await createGatewayStreamFn({ baseUrl: "https://gw.test", apiKey: "k" })(model, { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 0 }] }, { apiKey: "k" });
  return stream.result();
}

const toolCallOf = (message: AssistantMessage): ToolCall => message.content.find((b): b is ToolCall => b.type === "toolCall")!;

describe("a reply the output limit cut short says so", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a cut-off text reply is a length stop, not a stop", async () => {
    const message = await turn(frame({ content: "The handler is in" }), frame({}, "length"));
    expect(message.stopReason).toBe("length");
  });

  it("a cut-off tool call is a length stop and keeps what the model wrote, so it never reads as a call with no arguments", async () => {
    const message = await turn(call('{"path": "a.ts", "content": "const x'), frame({}, "length"));

    expect(message.stopReason).toBe("length");
    expect(toolCallOf(message)).toMatchObject({ name: "write_file", arguments: {}, rawArguments: '{"path": "a.ts", "content": "const x' });
  });

  it("a call cut off before its first argument byte is open, not empty", async () => {
    const message = await turn(call(""), frame({}, "length"));
    expect(toolCallOf(message).rawArguments).toBe("{");
  });

  it("a complete call is unchanged: parsed arguments, no raw text, a toolUse stop", async () => {
    const message = await turn(call('{"path": "a.ts"}'), frame({}, "tool_calls"));

    expect(message.stopReason).toBe("toolUse");
    expect(toolCallOf(message)).toEqual({ type: "toolCall", id: "c1", name: "write_file", arguments: { path: "a.ts" } });
  });

  it("a call that takes no arguments is unchanged, whether the model sent {} or nothing", async () => {
    expect(toolCallOf(await turn(call("{}"), frame({}, "tool_calls")))).toEqual({ type: "toolCall", id: "c1", name: "write_file", arguments: {} });
    expect(toolCallOf(await turn(call(""), frame({}, "tool_calls")))).toEqual({ type: "toolCall", id: "c1", name: "write_file", arguments: {} });
  });

  it("whitespace is not an argument: a call cut off after only spaces or a newline is open, like one cut off before them", async () => {
    expect(toolCallOf(await turn(call("  \n"), frame({}, "length"))).rawArguments).toBe("{");
    // ... and a finished call that sent only whitespace takes no arguments, as before
    expect(toolCallOf(await turn(call("  "), frame({}, "tool_calls")))).toEqual({ type: "toolCall", id: "c1", name: "write_file", arguments: {} });
  });

  it("`null` on a finished reply is a call with no arguments, as it has always run; an array or a scalar is declined", async () => {
    expect(toolCallOf(await turn(call("null"), frame({}, "tool_calls")))).toEqual({ type: "toolCall", id: "c1", name: "write_file", arguments: {} });
    expect(toolCallOf(await turn(call("[]"), frame({}, "tool_calls"))).rawArguments).toBe("[]");
    expect(toolCallOf(await turn(call("42"), frame({}, "tool_calls"))).rawArguments).toBe("42");
  });

  it("garbled arguments from a reply that finished are kept raw too: the agent declines the call instead of running it with none", async () => {
    const message = await turn(call("{path: a.ts}"), frame({}, "tool_calls"));

    expect(message.stopReason).toBe("toolUse");
    expect(toolCallOf(message)).toMatchObject({ arguments: {}, rawArguments: "{path: a.ts}" });
  });
});
