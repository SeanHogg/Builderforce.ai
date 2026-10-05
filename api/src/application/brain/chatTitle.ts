/**
 * Chat TITLE, server side — the one rule for what a `brain_chats.title` may hold.
 *
 * The column is `varchar(500)`. Titles arrive from several writers (the REST
 * create/rename routes, the `brain.create` / `brain.update` MCP tools) and from
 * several clients — some of which derive a title from the first prompt, which
 * has no length bound. Clamping here, at the server, is what keeps an over-long
 * rename from reaching Postgres as "value too long" and surfacing as a 500.
 */

/** `brain_chats.title` is `varchar(500)` (schema/canvas.ts). */
export const CHAT_TITLE_MAX_LENGTH = 500;

/** The title a chat falls back to when given none (matches the column default). */
export const DEFAULT_CHAT_TITLE = 'New chat';

/**
 * Trim, fall back to {@link DEFAULT_CHAT_TITLE} when blank, and clamp to the column
 * width. Counted in code points — what Postgres' `varchar(n)` counts — so an emoji
 * is never split into a lone surrogate at the cut.
 */
export function normalizeChatTitle(raw: string | null | undefined): string {
  const title = (raw ?? '').trim() || DEFAULT_CHAT_TITLE;
  const chars = Array.from(title);
  return chars.length > CHAT_TITLE_MAX_LENGTH
    ? chars.slice(0, CHAT_TITLE_MAX_LENGTH - 1).join('').trimEnd() + '…'
    : title;
}
