import { describe, expect, it } from "vitest";
import { handleChatEvent, type ChatEventPayload, type ChatState } from "./chat.ts";

/**
 * The Control UI, given the chat events the server broadcasts for a run that FAILED but said why as its reply (the payloads are exactly
 * what `agent-runtime/src/gateway/server-chat.failed-reply.test.ts` pins): it drops the stream on an error and shows the error message,
 * so the person sees the notice once, in the error line. Had the server left `errorMessage` off, the notice would be lost.
 */
const NOTICE = "The run ended without a reply: its tool calls were refused or failed. Governance gate no-shell refused some of its tool calls.";

function createState(): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: "client-1",
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "session-1",
  };
}

const delta: ChatEventPayload = { runId: "client-1", sessionKey: "session-1", state: "delta", message: { role: "assistant", content: [{ type: "text", text: NOTICE }] } };
const error: ChatEventPayload = { runId: "client-1", sessionKey: "session-1", state: "error", errorMessage: NOTICE, replyStreamed: true } as ChatEventPayload;

describe("handleChatEvent: a run that failed and said why as its reply", () => {
  it("shows the notice exactly once: the stream is dropped and the error line carries the text", () => {
    const state = createState();
    handleChatEvent(state, delta);
    expect(state.chatStream).toBe(NOTICE);

    handleChatEvent(state, error);

    expect(state.chatStream).toBeNull();
    expect(state.chatMessages).toEqual([]);
    expect(state.lastError).toBe(`run error: ${NOTICE}`);
    expect(state.lastError!.split(NOTICE)).toHaveLength(2);
  });
});
