/**
 * A run that failed but said why as its reply streams that text to the chat, then ends in the error phase carrying the same text.
 * The chat shows the failure once: the error final does not repeat a message the person has already read. An error with nothing
 * streamed before it still carries its message.
 */
import { describe, expect, it, vi } from "vitest";
import { createAgentEventHandler, createChatRunState, createToolEventRecipientRegistry } from "./server-chat.js";

const NOTICE = "The run ended without a reply: its tool calls were refused or failed. Governance gate no-shell refused some of its tool calls.";

function harness() {
  const broadcast = vi.fn();
  const chatRunState = createChatRunState();
  const handler = createAgentEventHandler({
    broadcast,
    broadcastToConnIds: vi.fn(),
    nodeSendToSession: vi.fn(),
    agentRunSeq: new Map<string, number>(),
    chatRunState,
    resolveSessionKeyForRun: () => undefined,
    clearAgentRunContext: vi.fn(),
    toolEventRecipients: createToolEventRecipientRegistry(),
  });
  chatRunState.registry.add("run-1", { sessionKey: "session-1", clientRunId: "client-1" });
  const chat = () => broadcast.mock.calls.filter(([event]) => event === "chat").map(([, payload]) => payload as { state?: string; errorMessage?: string; message?: { content?: Array<{ text?: string }> } });
  return { handler, chat };
}

describe("the chat's view of a run that failed and said why as its reply", () => {
  it("shows the text once: streamed as the reply, with an error final that does not repeat it", () => {
    const { handler, chat } = harness();

    handler({ runId: "run-1", seq: 1, stream: "assistant", ts: Date.now(), data: { text: NOTICE } });
    handler({ runId: "run-1", seq: 2, stream: "lifecycle", ts: Date.now(), data: { phase: "error", error: NOTICE } });

    const events = chat();
    expect(events.map((e) => e.state)).toEqual(["delta", "error"]);
    expect(events[0]!.message?.content?.[0]?.text).toBe(NOTICE);
    expect(events[1]!.errorMessage).toBeUndefined();
  });

  it("an error with nothing streamed before it still carries its message", () => {
    const { handler, chat } = harness();

    handler({ runId: "run-1", seq: 1, stream: "lifecycle", ts: Date.now(), data: { phase: "error", error: "provider timeout" } });

    expect(chat().map((e) => [e.state, e.errorMessage])).toEqual([["error", "provider timeout"]]);
  });

  it("an error whose message is NOT what was streamed keeps it", () => {
    const { handler, chat } = harness();

    handler({ runId: "run-1", seq: 1, stream: "assistant", ts: Date.now(), data: { text: "partial answer" } });
    handler({ runId: "run-1", seq: 2, stream: "lifecycle", ts: Date.now(), data: { phase: "error", error: "provider timeout" } });

    expect(chat().at(-1)).toMatchObject({ state: "error", errorMessage: "provider timeout" });
  });
});
