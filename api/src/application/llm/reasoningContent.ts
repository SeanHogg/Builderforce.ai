/**
 * Reasoning text off an assistant turn — the ONE reader every loop uses.
 *
 * Vendors surface the model's reasoning path in four shapes, none of which the
 * gateway's chat-completion parsers read before this module existed:
 *
 * - `message.reasoning_content` — DeepSeek and most OpenAI-compatible servers
 *   (and what the direct-Anthropic normaliser emits for `thinking` blocks).
 * - `message.reasoning` — OpenRouter's flat field.
 * - `message.reasoning_details[]` — OpenRouter's structured field
 *   (`{ type: 'reasoning.text', text }` items; encrypted/summary items are skipped).
 * - inline `<think>…</think>` in `message.content` — Qwen / DeepSeek-style models
 *   on servers that do not split it out. Stripped from the content so the visible
 *   reply never carries the scratchpad.
 *
 * Pure. Returns the reasoning as one string ('' when absent) plus the content
 * with any inline think segments removed.
 */

const THINK_RE = /<think>([\s\S]*?)<\/think>/gi;

export interface ChoiceMessageLike {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
  reasoning_details?: unknown;
}

export interface ReasoningSplit {
  /** Visible assistant text with inline think segments removed. */
  content: string;
  /** The model's reasoning path, '' when the turn carried none. */
  reasoning: string;
}

function detailsText(details: unknown): string {
  if (!Array.isArray(details)) return '';
  return details
    .map((d) => {
      const item = d as { type?: unknown; text?: unknown } | null;
      return item && (item.type === undefined || item.type === 'reasoning.text') && typeof item.text === 'string'
        ? item.text
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Split an assistant choice message into visible content and reasoning. */
export function splitReasoning(message: ChoiceMessageLike | null | undefined): ReasoningSplit {
  const rawContent = typeof message?.content === 'string' ? message.content : '';
  const inline: string[] = [];
  const content = rawContent.replace(THINK_RE, (_m, inner: string) => {
    if (inner.trim()) inline.push(inner.trim());
    return '';
  });
  const structured = [
    typeof message?.reasoning_content === 'string' ? message.reasoning_content : '',
    typeof message?.reasoning === 'string' ? message.reasoning : '',
    detailsText(message?.reasoning_details),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const reasoning = [...structured, ...inline].join('\n\n').trim();
  return { content: inline.length ? content.trim() : content, reasoning };
}
