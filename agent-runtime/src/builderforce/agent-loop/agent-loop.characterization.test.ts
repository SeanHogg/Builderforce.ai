import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentMessage, AgentTool } from "../model/agent-types.js";
import type { AssistantMessage, Context, ToolCall } from "../model/types.js";
import { Agent } from "./agent.js";
import { AssistantMessageEventStream } from "./event-stream.js";
import type { StreamFn } from "./stream.js";

/**
 * Characterization of what the native `Agent` does that `agent-loop.test.ts` does not pin: steering and follow-ups,
 * the run's ledger brief on the request tail, the PreFetch gate, terminal turns, and the shape of what `prompt()` returns
 * and what its listeners are told. Written against the loop BEFORE it moved onto `runAgent`; it is the parity oracle.
 */

const gate = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@builderforce/prefetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/prefetch")>()),
  runGate: gate.run,
}));

const model = {
  id: "m",
  name: "m",
  api: "openai-completions" as const,
  provider: "p",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1000,
};

const usage = { input: 3, output: 5, cacheRead: 1, cacheWrite: 0, totalTokens: 9, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"], extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return { role: "assistant", content, api: "openai-completions", provider: "p", model: "m", usage, stopReason, timestamp: 0, ...extra };
}

/** Scripted streamFn that records the context of every request. */
function scripted(script: AssistantMessage[], seen: Context[] = []): StreamFn {
  let call = 0;
  return (_m, context) => {
    seen.push({ ...context, messages: [...context.messages] });
    const stream = new AssistantMessageEventStream();
    const msg = script[call++] ?? assistant([{ type: "text", text: "done" }], "stop");
    queueMicrotask(() => {
      if (msg.stopReason === "error" || msg.stopReason === "aborted") stream.push({ type: "error", reason: msg.stopReason, error: msg });
      else stream.push({ type: "done", reason: msg.stopReason === "toolUse" ? "toolUse" : "stop", message: msg });
      stream.end();
    });
    return stream;
  };
}

const call = (id: string, text: string): ToolCall => ({ type: "toolCall", id, name: "echo", arguments: { text } });
const text = (t: string): AssistantMessage["content"] => [{ type: "text", text: t }];
const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: 0 });
const textOf = (m: AgentMessage | undefined): string => {
  const c = (m as { content?: unknown } | undefined)?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? "").join("") : "";
};

function echoTool(onRun?: (text: string) => void): AgentTool {
  return {
    name: "echo",
    label: "echo",
    description: "echoes",
    parameters: Type.Object({ text: Type.String() }),
    execute: async (_id, params) => {
      const t = (params as { text: string }).text;
      onRun?.(t);
      return { content: [{ type: "text", text: `echoed:${t}` }], details: { n: t } };
    },
  };
}

describe("native Agent loop — characterization", () => {
  it("a steer that arrives while a tool runs skips the turn's remaining calls and reaches the next model call", async () => {
    const ran: string[] = [];
    const seen: Context[] = [];
    const agent = new Agent({
      model,
      systemPrompt: "sys",
      tools: [
        echoTool((t) => {
          ran.push(t);
          if (t === "a") agent.steer(user("change of plan"));
        }),
      ],
    });
    agent.streamFn = scripted([assistant([call("c1", "a"), call("c2", "b")], "toolUse"), assistant(text("replanned"), "stop")], seen);

    const produced = await agent.prompt([user("go")]);

    expect(ran).toEqual(["a"]);
    const results = produced.filter((m) => m.role === "toolResult") as Array<{ toolCallId: string; isError: boolean }>;
    expect(results.map((r) => r.toolCallId)).toEqual(["c1", "c2"]);
    expect(results[0]!.isError).toBe(false);
    expect(results[1]!.isError).toBe(true);
    expect(produced.some((m) => m.role === "user" && textOf(m) === "change of plan")).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.messages.some((m) => m.role === "user" && textOf(m as AgentMessage) === "change of plan")).toBe(true);
  });

  it("a follow-up queued before the run is taken after the run would stop, and the run continues on it", async () => {
    const seen: Context[] = [];
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.streamFn = scripted([assistant(text("first answer"), "stop"), assistant(text("second answer"), "stop")], seen);
    agent.followUp(user("and also this"));

    const produced = await agent.prompt([user("go")]);

    expect(seen).toHaveLength(2);
    expect(seen[1]!.messages.some((m) => m.role === "user" && textOf(m as AgentMessage) === "and also this")).toBe(true);
    const assistants = produced.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(textOf(assistants.at(-1))).toBe("second answer");
    expect(produced.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("the run's ledger brief rides the LAST row of every request, and a successful call is recorded in the run's log", async () => {
    const seen: Context[] = [];
    const recorded: Array<[string, unknown]> = [];
    const agent = new Agent({ model, systemPrompt: "sys", tools: [echoTool()] });
    agent.knowledge = {
      setPrompt: () => undefined,
      record: (name, args) => recorded.push([name, args]),
      isEmpty: true,
      activity: {} as never,
      brief: () => "LEDGER-BRIEF-MARK",
      consolidate: () => null,
    };
    agent.streamFn = scripted([assistant([call("c1", "x")], "toolUse"), assistant(text("fin"), "stop")], seen);

    await agent.prompt([user("go")]);

    for (const request of seen) expect(textOf(request.messages.at(-1) as AgentMessage)).toContain("LEDGER-BRIEF-MARK");
    // the tail is per request: it never became part of the conversation
    expect(seen[1]!.messages.filter((m) => textOf(m as AgentMessage).includes("LEDGER-BRIEF-MARK"))).toHaveLength(1);
    expect(recorded).toEqual([["echo", { text: "x" }]]);
  });

  it("a failed call is not recorded in the run's log", async () => {
    const recorded: string[] = [];
    const failing: AgentTool = { ...echoTool(), execute: async () => { throw new Error("boom"); } };
    const agent = new Agent({ model, systemPrompt: "sys", tools: [failing] });
    agent.knowledge = { setPrompt: () => undefined, record: (n) => recorded.push(n), isEmpty: true, activity: {} as never, brief: () => null, consolidate: () => null };
    agent.streamFn = scripted([assistant([call("c1", "x")], "toolUse"), assistant(text("fin"), "stop")]);

    const produced = await agent.prompt([user("go")]);

    expect(recorded).toEqual([]);
    const result = produced.find((m) => m.role === "toolResult") as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("boom");
  });

  it("a PreFetch ANSWER settles the run with no model call", async () => {
    gate.run.mockImplementationOnce(async (_request: string, _port: unknown, opts: { adopt: (a: { result: { text: string } }) => Promise<boolean> }) => {
      await opts.adopt({ result: { text: "git status: clean" } });
      return { tail: [] };
    });
    const seen: Context[] = [];
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.prefetch = { registry: [], executors: {}, ports: {} } as never;
    agent.streamFn = scripted([], seen);

    const produced = await agent.prompt([user("what is the git status")]);

    expect(seen).toHaveLength(0);
    expect(produced.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(textOf(produced[1])).toBe("git status: clean");
  });

  it("PreFetch facts ride the volatile tail of every request", async () => {
    gate.run.mockImplementationOnce(async () => ({ tail: ["PREFETCH-FACT-MARK"] }));
    const seen: Context[] = [];
    const agent = new Agent({ model, systemPrompt: "sys", tools: [echoTool()] });
    agent.prefetch = { registry: [], executors: {}, ports: {} } as never;
    agent.streamFn = scripted([assistant([call("c1", "x")], "toolUse"), assistant(text("fin"), "stop")], seen);

    await agent.prompt([user("go")]);

    expect(seen).toHaveLength(2);
    for (const request of seen) expect(textOf(request.messages.at(-1) as AgentMessage)).toContain("PREFETCH-FACT-MARK");
  });

  it("an errored turn ends the run: the errored message is the last one recorded and no follow-up is taken", async () => {
    const seen: Context[] = [];
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.followUp(user("never taken"));
    agent.streamFn = scripted([assistant([], "error", { errorMessage: "upstream 500" })], seen);

    const produced = await agent.prompt([user("go")]);

    expect(seen).toHaveLength(1);
    const last = produced.at(-1) as AssistantMessage;
    expect(last.role).toBe("assistant");
    expect(last.stopReason).toBe("error");
    expect(last.errorMessage).toBe("upstream 500");
    expect(produced.some((m) => textOf(m) === "never taken")).toBe(false);
  });

  it("what prompt() returns keeps the model's native message: thinking blocks, signatures, usage, provider", async () => {
    const native = assistant(
      [
        { type: "thinking", thinking: "hmm", thinkingSignature: "sig-1" },
        { type: "text", text: "the answer", textSignature: "sig-2" },
      ],
      "stop",
      { responseId: "r-1" } as Partial<AssistantMessage>,
    );
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.streamFn = scripted([native]);

    const produced = await agent.prompt([user("go")]);

    const out = produced.find((m) => m.role === "assistant") as AssistantMessage;
    expect(out.content).toEqual(native.content);
    expect(out.usage).toEqual(usage);
    expect(out.provider).toBe("p");
    expect(out.model).toBe("m");
    expect(out.stopReason).toBe("stop");
  });

  it("a tool result keeps its native blocks and details, and an image result is handed back whole", async () => {
    const withImage: AgentTool = {
      ...echoTool(),
      execute: async () => ({ content: [{ type: "text", text: "shot" }, { type: "image", data: "QUJD", mimeType: "image/png" }], details: { path: "/x.png" } }),
    };
    const agent = new Agent({ model, systemPrompt: "sys", tools: [withImage] });
    agent.streamFn = scripted([assistant([call("c1", "x")], "toolUse"), assistant(text("fin"), "stop")]);

    const produced = await agent.prompt([user("go")]);

    const result = produced.find((m) => m.role === "toolResult") as { content: unknown[]; details: unknown; toolName: string; toolCallId: string; isError: boolean };
    expect(result.content).toEqual([{ type: "text", text: "shot" }, { type: "image", data: "QUJD", mimeType: "image/png" }]);
    expect(result.details).toEqual({ path: "/x.png" });
    expect(result.toolName).toBe("echo");
    expect(result.toolCallId).toBe("c1");
    expect(result.isError).toBe(false);
  });

  it("listeners hear the run in order: lifecycle, each message ended once, tool start before its end", async () => {
    const events: AgentEvent[] = [];
    const agent = new Agent({ model, systemPrompt: "sys", tools: [echoTool()] });
    agent.subscribe((e) => events.push(e));
    agent.streamFn = scripted([assistant([call("c1", "x")], "toolUse"), assistant(text("fin"), "stop")]);

    await agent.prompt([user("go")]);

    expect(events[0]!.type).toBe("agent_start");
    expect(events.at(-1)!.type).toBe("agent_end");
    const ended = events.filter((e) => e.type === "message_end").map((e) => (e as { message: AgentMessage }).message.role);
    expect(ended).toEqual(["user", "assistant", "toolResult", "assistant"]);
    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("tool_execution_start")).toBeLessThan(kinds.indexOf("tool_execution_end"));
    expect(kinds.filter((k) => k === "turn_end")).toHaveLength(2);
    expect(kinds.filter((k) => k === "turn_start")).toHaveLength(2);
  });

  it("a streamed answer's updates reach listeners before its message ends", async () => {
    const events: AgentEvent[] = [];
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.subscribe((e) => events.push(e));
    const final = assistant(text("hello"), "stop");
    agent.streamFn = () => {
      const stream = new AssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: assistant([], "stop") });
        stream.push({ type: "text_delta", contentIndex: 0, delta: "hel", partial: assistant(text("hel"), "stop") });
        stream.push({ type: "done", reason: "stop", message: final });
        stream.end();
      });
      return stream;
    };

    await agent.prompt([user("go")]);

    const kinds = events.map((e) => e.type);
    expect(kinds.indexOf("message_update")).toBeGreaterThan(-1);
    const assistantEnd = events.findIndex((e) => e.type === "message_end" && (e as { message: AgentMessage }).message.role === "assistant");
    expect(kinds.indexOf("message_update")).toBeLessThan(assistantEnd);
  });

  it("a call to a tool that does not exist is answered as an error the model reads", async () => {
    const agent = new Agent({ model, systemPrompt: "sys", tools: [echoTool()] });
    agent.streamFn = scripted([
      assistant([{ type: "toolCall", id: "c1", name: "nope", arguments: {} }], "toolUse"),
      assistant(text("fin"), "stop"),
    ]);

    const produced = await agent.prompt([user("go")]);

    const result = produced.find((m) => m.role === "toolResult") as { isError: boolean };
    expect(result.isError).toBe(true);
    expect(produced.at(-1)!.role).toBe("assistant");
  });

  it("a model switch is applied to the session: state.model follows, and the next prompt() starts on it", async () => {
    // pinned behaviour: onModelFallback keeps agent.state.model current (see agent-loop.test.ts for the stall path)
    const seen: string[] = [];
    const agent = new Agent({ model, systemPrompt: "sys" });
    agent.setModel({ ...model, id: "m9", name: "m9" });
    agent.streamFn = (m) => {
      seen.push(m.id);
      return scripted([assistant(text("ok"), "stop")])(m, { messages: [] });
    };
    await agent.prompt([user("go")]);
    expect(seen).toEqual(["m9"]);
  });
});
