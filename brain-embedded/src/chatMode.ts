/**
 * Chat MODE — "am I being asked a question, or being asked to get something done?"
 *
 * Two modes, one per conversation:
 *
 *   • `chat` — CONVERSATIONAL. The Brain reads, reasons and answers. It may look
 *     anything up, but it does not mint board work, staff it, or start runs off
 *     its own back. This is the default and the surface's resting state.
 *
 *   • `work`  — EXECUTIONAL. The Brain turns what it concludes into real work: it
 *     creates the ticket, scopes the resources, links it to the conversation,
 *     advances its status, and DISPATCHES an agent to run it. The conversation is
 *     the front end of an execution, not a discussion about one.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The work-linking directive ({@link chatWorkLinkingDirective}) used to ride EVERY
 * run unconditionally — so "what does this error mean?" was answered by a model that
 * had also been instructed to open, staff and status a ticket about it. There was no
 * way to just ask a question, and no way to tell an execution apart from a chat after
 * the fact. Mode is the discriminator for both: it gates the directive at runtime and
 * it is recorded on the conversation, so usage can finally be read as
 * "conversations vs executions" rather than one undifferentiated pile.
 *
 * The value is persisted on the conversation (`brain_chats.mode`, `creation_sessions.mode`,
 * migration 0409) rather than in the browser, so the choice follows the conversation
 * across surfaces and devices — the same reasoning as `capability` (0345).
 *
 * Kept framework-free (pure strings + unions) so it is safe in every bundle: the web
 * Brain, the VS Code webview, and the shared agent loop all import from here.
 */

import { chatWorkLinkingDirective } from './chatWorkLinking';

/** The modes a conversation can be in. Order is display order. */
export const CHAT_MODES = ['chat', 'work'] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

/**
 * The resting mode. A conversation is a conversation until someone says otherwise —
 * asking a question must never be the thing that opens a ticket.
 */
export const DEFAULT_CHAT_MODE: ChatMode = 'chat';

/** True for a value that is one of the known modes. */
export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === 'string' && (CHAT_MODES as readonly string[]).includes(value);
}

/**
 * Coerce an inbound/stored value to a mode, falling back to {@link DEFAULT_CHAT_MODE}.
 * Tolerant by design: an unknown value (an older row, a client ahead of the server)
 * resolves to a conversation rather than silently granting execution authority.
 */
export function normalizeChatMode(value: unknown): ChatMode {
  return isChatMode(value) ? value : DEFAULT_CHAT_MODE;
}

/**
 * The system-prompt block for CHAT mode.
 *
 * Deliberately a positive instruction rather than only a prohibition: a model told
 * merely "do not create tickets" tends to hedge and offer to create one every turn,
 * which is the same interruption in a politer costume. This tells it what its job IS
 * — answer the question — and makes the ONE escape hatch explicit (the user asking
 * outright), so the mode is a default rather than a cage.
 */
export function chatConversationDirective(): string {
  return (
    'MODE: CHAT. This conversation is a conversation. Your job is to understand the question and answer it.\n' +
    '• Read, search, inspect and reason as much as the question needs — every read-only tool is available to you and using them is encouraged. Ground the answer in what you actually looked up.\n' +
    '• Do NOT create, staff, re-status, or dispatch board work as a side effect of answering. Identifying that something ought to be done is part of a good answer; opening a ticket about it is not.\n' +
    '• If the work plainly ought to be tracked, END the answer with one short line naming it and telling the user they can switch this conversation to Work mode to have it opened and run. Offer it once; do not repeat the offer on later turns.\n' +
    '• The single exception: if the user explicitly asks you to create, assign, schedule or run something in THIS message, do it. An explicit instruction outranks the mode.'
  );
}

/**
 * The system-prompt block for WORK mode: the existing chat⇄work linking contract
 * PLUS the dispatch obligation that makes the mode mean execution rather than
 * paperwork.
 *
 * The dispatch half exists because creating a well-staffed ticket and stopping is
 * indistinguishable, from the user's side, from doing nothing: the measured reality
 * is that tickets opened and never dispatched sit in backlog indefinitely. So the
 * mode's closing obligation is to REPORT the dispatch verdict truthfully — `tasks.create`
 * and `tasks.update` already return `autoRun: { dispatched, reason, detail }`, and
 * `chats.dispatch_agent` starts a run directly when autonomy declined.
 *
 * Tool names here are the ADVERTISED (`builtin_*`) names the model actually sees on
 * the gateway relay — never the catalog ids, which appear nowhere in its tool list.
 */
export function chatWorkDirective(chatId: number): string {
  return (
    `MODE: WORK. This conversation exists to get something DONE, not to describe it. Take the work all the way to a running agent.\n` +
    `${chatWorkLinkingDirective(chatId)}\n` +
    `• FINISH BY DISPATCHING. A ticket that no agent is running has not started. Every create/update tool returns an \`autoRun\` verdict — read it. When \`autoRun.dispatched\` is true, say which agent picked the work up. When it is false, do not stop there: pick a capable agent (builtin_cloud_agents_list_mine, or builtin_tasks_assignees for the accountable roster) and start the run yourself with builtin_chats_dispatch_agent (chatId=${chatId}, agentRef=<the agent>, taskId=<the ticket>).\n` +
    `• If dispatch is genuinely refused — no capable agent, an execution kill-switch, an exhausted run cap, a human gate on the lane — report the EXACT reason the tool returned and what would clear it. Never imply work has begun when nothing was dispatched, and never describe a dispatch you did not make.`
  );
}

/**
 * The system-prompt block for a mode. This is the ONE place a mode becomes model-facing
 * behaviour, so the two surfaces (web Brain, VS Code webview) and the shared agent loop
 * cannot drift on what a mode means.
 */
export function chatModeDirective(mode: ChatMode, chatId: number): string {
  return mode === 'work' ? chatWorkDirective(chatId) : chatConversationDirective();
}
