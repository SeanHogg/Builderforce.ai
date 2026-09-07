import { Type } from "@sinclair/typebox";
import { MAX_ANNOUNCEMENT_RECOVERIES, MAX_MODEL_FAILOVERS } from "@builderforce/agent-stall";
import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentTool } from "../model/agent-types.js";
import type { AssistantMessage, ToolCall } from "../model/types.js";
import { Agent } from "./agent-loop.js";
import { AssistantMessageEventStream } from "./event-stream.js";
import type { StreamFn } from "./stream.js";

const model = {
  id: "m",
  name: "m",
  api: "openai-completions" as const,
  provider: "p",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 1000,
};

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "p",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}

/** Scripted streamFn: returns a pre-built assistant message per call. */
function scriptedStreamFn(script: AssistantMessage[]): StreamFn {
  let call = 0;
  return () => {
    const stream = new AssistantMessageEventStream();
    const msg = script[call++] ?? assistant([{ type: "text", text: "done" }], "stop");
    queueMicrotask(() => {
      stream.push({
        type: "done",
        reason: msg.stopReason === "toolUse" ? "toolUse" : "stop",
        message: msg,
      });
      stream.end();
    });
    return stream;
  };
}

describe("native Agent loop", () => {
  it("streams a turn, executes a tool call, feeds the result back, and finishes", async () => {
    const calls: string[] = [];
    const echoTool: AgentTool = {
      name: "echo",
      label: "echo",
      description: "echoes",
      parameters: Type.Object({ text: Type.String() }),
      execute: async (_id, params) => {
        const { text } = params as { text: string };
        calls.push(text);
        return { content: [{ type: "text", text: `echoed:${text}` }], details: {} };
      },
    };

    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tc1",
      name: "echo",
      arguments: { text: "hi" },
    };
    const streamFn = scriptedStreamFn([
      assistant([toolCall], "toolUse"), // turn 1: call the tool
      assistant([{ type: "text", text: "all done" }], "stop"), // turn 2: finish
    ]);

    const agent = new Agent({ model, tools: [echoTool], systemPrompt: "sys" });
    agent.streamFn = streamFn;

    const events: AgentEvent[] = [];
    agent.subscribe((e) => events.push(e));

    const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

    // the tool ran with the model-provided args
    expect(calls).toEqual(["hi"]);
    // a tool result message was produced and fed back
    const toolResults = produced.filter((m) => m.role === "toolResult");
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0] as { content: { text: string }[] }).content[0].text).toBe("echoed:hi");
    // loop terminated on the second (text) assistant turn
    const finalAssistant = produced
      .filter((m) => m.role === "assistant")
      .at(-1) as AssistantMessage;
    expect((finalAssistant.content[0] as { text: string }).text).toBe("all done");
    // lifecycle events emitted
    expect(events.some((e) => e.type === "agent_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_execution_end")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    expect(agent.isStreaming).toBe(false);
  });

  it("stops immediately when the first turn has no tool calls", async () => {
    const streamFn = scriptedStreamFn([assistant([{ type: "text", text: "hello" }], "stop")]);
    const agent = new Agent({ model });
    agent.streamFn = streamFn;
    const produced = await agent.prompt([{ role: "user", content: "hi", timestamp: 0 }]);
    expect(produced.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(produced.filter((m) => m.role === "toolResult")).toHaveLength(0);
  });

  /**
   * Announced-but-untaken tool call. Without recovery the loop reads "0 tool calls =
   * done" and ends the run holding a promise — for an autonomous run, a silent no-op
   * that still burns the run. Shares the gate with the Brain loop via
   * `@builderforce/agent-stall`.
   */
  describe("announced-but-untaken tool call", () => {
    const echoTool: AgentTool = {
      name: "echo",
      label: "echo",
      description: "echoes",
      parameters: Type.Object({ text: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "echoed" }], details: {} }),
    };
    const toolCall: ToolCall = { type: "toolCall", id: "tc1", name: "echo", arguments: { text: "hi" } };
    const isNudge = (m: { role: string; content?: unknown }) =>
      m.role === "user" && String(m.content ?? "").includes("made zero tool calls");

    it("re-prompts a turn that promises a tool call, and the model then acts", async () => {
      const streamFn = scriptedStreamFn([
        assistant([{ type: "text", text: "I'll search the codebase for the handler." }], "stop"),
        assistant([toolCall], "toolUse"),
        assistant([{ type: "text", text: "Found it in agent-loop.ts." }], "stop"),
      ]);
      const agent = new Agent({ model, tools: [echoTool], systemPrompt: "sys" });
      agent.streamFn = streamFn;

      const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

      // The nudge was injected as a user turn...
      expect(produced.filter(isNudge)).toHaveLength(1);
      // ...the model then actually called the tool...
      expect(produced.filter((m) => m.role === "toolResult")).toHaveLength(1);
      // ...and the run ended on a real answer, not the announcement.
      const finalAssistant = produced.filter((m) => m.role === "assistant").at(-1) as AssistantMessage;
      expect((finalAssistant.content[0] as { text: string }).text).toBe("Found it in agent-loop.ts.");
    });

    it("gives up after the shared budget so an always-narrating model cannot spin", async () => {
      let turns = 0;
      const alwaysAnnounces: StreamFn = () => {
        turns++;
        const stream = new AssistantMessageEventStream();
        const msg = assistant([{ type: "text", text: "Let me search for that now." }], "stop");
        queueMicrotask(() => {
          stream.push({ type: "done", reason: "stop", message: msg });
          stream.end();
        });
        return stream;
      };
      const agent = new Agent({ model, tools: [echoTool], systemPrompt: "sys" });
      agent.streamFn = alwaysAnnounces;

      const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

      // 1 original turn + exactly MAX_ANNOUNCEMENT_RECOVERIES re-prompted turns.
      expect(turns).toBe(1 + MAX_ANNOUNCEMENT_RECOVERIES);
      expect(produced.filter(isNudge)).toHaveLength(MAX_ANNOUNCEMENT_RECOVERIES);
      // Giving up must be LOUD. Ending on the promise alone leaves an autonomous run
      // looking like a clean completion that happened to do nothing.
      const tailMessage = produced.at(-1);
      const tail = tailMessage && "content" in tailMessage
        ? String(tailMessage.content ?? "")
        : "";
      expect(tail).toContain("nothing was actually run");
      // NOT "pick a different model": that advice was withdrawn from the shared notice
      // (efaa85925) because a runtime rejecting every request upstream looks identical
      // from inside the loop, and no model change fixes it. The notice now names both
      // possibilities and points at the log that separates them. `agent-stall` updated
      // its own assertion; this duplicate was left asserting the deleted sentence.
      expect(tail).not.toContain("pick a different model");
      expect(tail).toContain("check your runtime or gateway log");
    });

    /**
     * The exact turn that ended VS Code chat #85: no first-person subject, just the
     * call written out as text. It used to score as a complete answer, so the loop
     * returned it and the run died having done nothing.
     */
    it("recovers a BARE pseudo-call, not just a first-person promise", async () => {
      const streamFn = scriptedStreamFn([
        assistant([{ type: "text", text: "run tool builtin_chats_list_tickets with chatId is 85" }], "stop"),
        assistant([toolCall], "toolUse"),
        assistant([{ type: "text", text: "3 tickets, all in backlog." }], "stop"),
      ]);
      const agent = new Agent({ model, tools: [echoTool], systemPrompt: "sys" });
      agent.streamFn = streamFn;

      const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

      expect(produced.filter(isNudge)).toHaveLength(1);
      expect(produced.filter((m) => m.role === "toolResult")).toHaveLength(1);
    });

    /**
     * MODEL FAILOVER — the on-prem half of the decision the gateway loops already took.
     * A model that burns its whole re-prompt budget still narrating cannot be nudged
     * out of it; only a different model finishes the request. The loop never picks one
     * itself (a self-hosted model is an operator's explicit pin) — it asks the host's
     * `pickFallbackModel`, which on-prem is built from the operator's own declared
     * fallback chain.
     */
    describe("model failover", () => {
      /** Narrates forever on every model EXCEPT `answersOn` (null ⇒ all of them stall). */
      function failoverStreamFn(answersOn: string | null, seen: string[]): StreamFn {
        return (m) => {
          seen.push(m.id);
          const stream = new AssistantMessageEventStream();
          const msg = m.id === answersOn
            ? assistant([{ type: "text", text: "The handler is in agent-loop.ts." }], "stop")
            : assistant([{ type: "text", text: "Let me search for that now." }], "stop");
          queueMicrotask(() => {
            stream.push({ type: "done", reason: "stop", message: msg });
            stream.end();
          });
          return stream;
        };
      }

      it("switches to the host's successor once the re-prompt budget is spent, and says so", async () => {
        const seen: string[] = [];
        const successor = { ...model, id: "m2", name: "m2" };
        const fallbacks: string[][] = [];
        const swaps: string[] = [];
        const agent = new Agent({
          model,
          tools: [echoTool],
          systemPrompt: "sys",
          pickFallbackModel: (tried) => {
            fallbacks.push([...tried]);
            return tried.includes("p/m2") ? undefined : successor;
          },
          onModelFallback: (from, to) => swaps.push(`${from.id}->${to.id}`),
        });
        agent.streamFn = failoverStreamFn("m2", seen);

        const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

        // The pinned model burned its whole budget, then the successor answered.
        expect(seen.filter((id) => id === "m")).toHaveLength(1 + MAX_ANNOUNCEMENT_RECOVERIES);
        expect(seen.at(-1)).toBe("m2");
        expect(swaps).toEqual(["m->m2"]);
        // The picker is told what has already been burned, PROVIDER-QUALIFIED — the same
        // model id behind two providers is two different routes.
        expect(fallbacks[0]).toContain("p/m");
        // The swap is announced on the transcript, never silent.
        const notice = produced.find((m) => m.role === "custom" && m.customType === "model_failover");
        expect(notice).toBeTruthy();
        expect(String((notice as { content: string }).content)).toContain("`p/m2`");
        // ...and the session now runs on the model that actually works.
        expect(agent.state.model.id).toBe("m2");
      });

      it("ends on the exhausted notice when the host offers no successor", async () => {
        const seen: string[] = [];
        const agent = new Agent({ model, tools: [echoTool], systemPrompt: "sys" });
        agent.streamFn = failoverStreamFn("m2", seen);

        const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

        expect(seen).toHaveLength(1 + MAX_ANNOUNCEMENT_RECOVERIES);
        expect(produced.some((m) => m.role === "custom" && m.customType === "model_failover")).toBe(false);
        const tailMessage = produced.at(-1);
        const tail = tailMessage && "content" in tailMessage ? String(tailMessage.content ?? "") : "";
        expect(tail).toContain("nothing was actually run");
      });

      it("stops after MAX_MODEL_FAILOVERS rather than walking the operator's whole chain", async () => {
        const seen: string[] = [];
        const chain = ["m2", "m3", "m4", "m5"].map((id) => ({ ...model, id, name: id }));
        const agent = new Agent({
          model,
          tools: [echoTool],
          systemPrompt: "sys",
          // Every model narrates, so each one burns its budget and asks for the next.
          pickFallbackModel: (tried) => chain.find((c) => !tried.includes(`p/${c.id}`)),
        });
        agent.streamFn = failoverStreamFn(null, seen); // nothing answers → every model stalls

        const produced = await agent.prompt([{ role: "user", content: "go", timestamp: 0 }]);

        const swapped = produced.filter((m) => m.role === "custom" && m.customType === "model_failover");
        expect(swapped).toHaveLength(MAX_MODEL_FAILOVERS);
        // Distinct models tried: the pin plus one per failover — never the whole chain.
        expect(new Set(seen).size).toBe(1 + MAX_MODEL_FAILOVERS);
        const tailMessage = produced.at(-1);
        const tail = tailMessage && "content" in tailMessage ? String(tailMessage.content ?? "") : "";
        // The notice names every model burned, so "it didn't work" is actionable.
        expect(tail).toContain("This run already failed over from");
      });
    });

    it("leaves a genuine final answer alone even with tools available", async () => {
      let turns = 0;
      const streamFn: StreamFn = () => {
        turns++;
        const stream = new AssistantMessageEventStream();
        const msg = assistant([{ type: "text", text: "The build failed because the token expired." }], "stop");
        queueMicrotask(() => {
          stream.push({ type: "done", reason: "stop", message: msg });
          stream.end();
        });
        return stream;
      };
      const agent = new Agent({ model, tools: [echoTool], systemPrompt: "sys" });
      agent.streamFn = streamFn;

      const produced = await agent.prompt([{ role: "user", content: "why?", timestamp: 0 }]);

      expect(turns).toBe(1);
      expect(produced.filter(isNudge)).toHaveLength(0);
    });
  });
});
