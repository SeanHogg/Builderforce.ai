/**
 * toolset — `toolScope: 'chat-reply'` data, ported from
 * `api/src/application/llm/cloudAgentToolset.ts` `CHAT_SCOPED_AGENT_TOOLS`.
 *
 * The tools an agent gets ONLY when it is replying INSIDE a Brain chat (the
 * `@agent` addressed-reply loop), where a current `chatId` exists to act on: read the
 * conversation's linked work and tie/untie tickets to THIS chat, inspect why the last
 * run did not finish and what has already run, and steer/resume the agent's own run on
 * a linked ticket. Deliberately NOT part of the platform surface: an autonomous run has
 * no chat context, and the escalation/destructive members (start a run, invite,
 * consolidate) stay off — the same restraint as excluding executions.submit.
 *
 * The LIST is verbatim from the source; the `toolScope: 'chat-reply'` marker is the
 * kernel-side data (`RunPolicy.toolScope` is the contract field, WS1).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

/**
 * The tool names the 'chat-reply' scope grants, verbatim from
 * `cloudAgentToolset.ts` `CHAT_SCOPED_AGENT_TOOLS`. Order preserved.
 */
export const CHAT_REPLY_SCOPED_TOOLS: readonly string[] = [
  "chats.get_messages",
  "chats.list_tickets",
  "chats.link_ticket",
  "chats.unlink_ticket",
  "chats.ticket_lineage",
  "chats.list_agents",
  // Why the LAST run on this chat did not finish — read-only, consulted BEFORE the
  // failed attempt is repeated.
  "chats.diagnostics",
  // What has already RUN on this chat's tickets and who started it.
  "chats.runs",
  // The addressed agent's hands: steer/resume the agent's OWN run on a linked ticket or
  // start a follow-up on the same branch. NOT the unattended executions.post_message.
  "chats.execute_as_agent",
];

/** True when a `toolScope` value is the addressed-reply scope. */
export function isChatReplyScope(toolScope: string | null | undefined): boolean {
  return toolScope === "chat-reply";
}

/** The scope marker the data answers to — `RunPolicy.toolScope`. */
export const CHAT_REPLY_TOOL_SCOPE = "chat-reply";
