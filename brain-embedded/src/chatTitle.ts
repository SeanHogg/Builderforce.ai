/**
 * The Brain's chat titles: the placeholder an untitled chat carries and the pure, LLM-free derivation of a real one from the first
 * user message. Extracted from `useBrainChats` (the chat list + CRUD hook), which only needs to ask whether a chat is still untitled.
 */

/** The placeholder title `create()` stamps on an untitled chat. A chat still carrying
 *  it has never been named, so {@link deriveChatTitle}-based auto-titling may replace it
 *  (a user/seed-provided title never matches this and is left alone). */
export const DEFAULT_CHAT_TITLE = 'New chat';

/**
 * Derive a short, human chat title from the first user message — "what the chat is
 * about" — so a conversation stops showing as "New chat" the moment it starts. Pure and
 * LLM-free (no cost, instant, deterministic): first non-empty line, whitespace
 * collapsed, trimmed to ~60 chars on a word boundary. Returns '' when there's nothing
 * usable (so the caller leaves the placeholder in place).
 */
export function deriveChatTitle(text: string): string {
  const firstLine = (text.split('\n').find((l) => l.trim()) ?? '').replace(/\s+/g, ' ').trim();
  if (!firstLine) return '';
  if (firstLine.length <= 60) return firstLine;
  const cut = firstLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}
