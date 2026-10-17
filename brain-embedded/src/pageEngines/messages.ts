/**
 * Message content as the in-page engines read it. None of them takes an image (vision
 * input is out of scope, PRD 34 §4), and WebLLM and the Prompt API both want a plain
 * string where OpenAI allows an array of text parts — so the flattening lives here once.
 */

/** Plain text of a message's content, or null when it carries anything but text. */
export function messageText(content: unknown): string | null {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown };
    if (type !== 'text' || typeof text !== 'string') return null;
    parts.push(text);
  }
  return parts.join('\n');
}
