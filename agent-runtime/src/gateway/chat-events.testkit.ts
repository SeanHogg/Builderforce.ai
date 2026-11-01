/** Test kit: the chat events the REAL server handler broadcasts for a run's agent events, as the clients receive them. */
import { vi } from "vitest";
import { createAgentEventHandler, createChatRunState, createToolEventRecipientRegistry } from "./server-chat.js";

export const NOTICE = "The run ended without a reply: its tool calls were refused or failed. Governance gate no-shell refused some of its tool calls.";

export type Chat = { state?: string; errorMessage?: string; replyStreamed?: boolean; stopReason?: string; message?: { content?: Array<{ text?: string }> } };

/** The chat events the real handler broadcasts for a run's agent events. */
export function chatEventsFor(events: Array<{ stream: string; data: Record<string, unknown> }>): Chat[] {
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
  events.forEach((e, i) => handler({ runId: "run-1", seq: i + 1, stream: e.stream, ts: Date.now(), data: e.data }));
  return broadcast.mock.calls.filter(([event]) => event === "chat").map(([, payload]) => payload as Chat);
}

