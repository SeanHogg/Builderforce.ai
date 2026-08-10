/**
 * Chat MODE, server side — `chat` (a CONVERSATION) vs `work` (an EXECUTION).
 *
 * The model-facing MEANING of a mode lives in one place, `brain-embedded/src/chatMode.ts`,
 * because that is what the shared agent loop injects into the system prompt. The api
 * does not depend on that package (it is a React/browser bundle), so what lives here is
 * only what the SERVER has to decide: is this a legal value, and which mode does a given
 * chat actually run in. Both are small, closed questions over a two-value set — unlike
 * `capability`, whose catalogue is genuinely open and is therefore stored opaquely.
 *
 * See migration 0409.
 */

/** The modes a conversation can be in. Must match brain-embedded's `CHAT_MODES`. */
export const CHAT_MODES = ['chat', 'work'] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

/**
 * The mode a NEW conversation opens in. Work, because that is what the product is
 * for — a conversation that cannot dispatch produces a plan and stops. A user who
 * only wants to ask flips one switch in the composer's `/` menu.
 */
export const NEW_CHAT_MODE: ChatMode = 'work';

/**
 * What an unset or unrecognised STORED value resolves to: a conversation. Deliberately
 * NOT the same answer as {@link NEW_CHAT_MODE} — a row written before 0409 never opted
 * into execution authority and must not be granted it by a default that moved.
 */
export const RESTING_CHAT_MODE: ChatMode = 'chat';

/**
 * Chat ORIGINS that are always executional, whatever the column says.
 *
 * The team chat and the AI Manager's accountability chat are singletons whose entire
 * purpose is to record and drive work — a manager that answered "what did the team get
 * done?" without being able to open or dispatch anything would be a worse manager. They
 * predate the column and are created by get-or-create paths that never set it, so
 * pinning them here is what stops the 0409 default from silently demoting them.
 */
const ALWAYS_WORK_ORIGINS: ReadonlySet<string> = new Set(['team', 'manager']);

/** True for a value that is one of the known modes. */
export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === 'string' && (CHAT_MODES as readonly string[]).includes(value);
}

/**
 * Sanitize an inbound mode. Returns `null` for anything unrecognised so a caller can
 * tell "not supplied / not valid" (leave the column alone) apart from "set it to chat".
 */
export function normalizeChatMode(value: unknown): ChatMode | null {
  return isChatMode(value) ? value : null;
}

/**
 * The mode a chat ACTUALLY runs in: the stored value, with the always-work origins
 * pinned and anything unrecognised resting in {@link RESTING_CHAT_MODE}. This is the
 * single resolution every server read should go through, so "which mode is this chat
 * in?" cannot be answered two different ways in two different places.
 */
export function resolveChatMode(chat: { origin?: string | null; mode?: string | null }): ChatMode {
  if (chat.origin && ALWAYS_WORK_ORIGINS.has(chat.origin)) return 'work';
  return normalizeChatMode(chat.mode) ?? RESTING_CHAT_MODE;
}
