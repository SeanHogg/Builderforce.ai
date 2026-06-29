/**
 * Model-authored "next step" buttons for Brain replies.
 *
 * The static "Generate PRD / Generate Tasks" buttons are generic and rarely
 * match what the assistant actually proposed (e.g. it offered to create OKRs or
 * Epics, but only PRD/Tasks showed). To make the buttons representative, the
 * Brain co-pilot ends a reply that sets up concrete next actions with a fenced
 *
 *   ```suggested-actions
 *   [{ "label": "Create the OKRs", "prompt": "Create those OKRs on the board" }]
 *   ```
 *
 * block (see PLATFORM_BRAIN_SYSTEM_PROMPT). This parser lifts that block out of
 * the message: it returns the visible markdown with the block removed, plus the
 * parsed actions. Clicking a button sends its `prompt` back to the Brain, which
 * carries the action out with its tools.
 */

export interface SuggestedAction {
  /** Short button text. */
  label: string;
  /** The message sent back to the Brain when the button is clicked. */
  prompt: string;
}

export interface ParsedSuggestedActions {
  /** The message content with the suggested-actions block stripped out. */
  content: string;
  actions: SuggestedAction[];
}

// A complete fenced block: ```suggested-actions … ``` (or the shorter ```actions).
const FENCE_RE = /```(?:suggested-actions|actions)[ \t]*\r?\n?([\s\S]*?)```/i;
// Just the opening fence — used to hide a still-streaming, not-yet-closed block.
const OPEN_FENCE_RE = /```(?:suggested-actions|actions)\b/i;

/**
 * Split a suggested-actions block out of an assistant message. Tolerant by
 * design: a malformed/partial block is hidden from the rendered text (so raw
 * JSON never flashes mid-stream) and simply yields no buttons.
 */
export function parseSuggestedActions(content: string): ParsedSuggestedActions {
  if (!content) return { content: content ?? '', actions: [] };

  const match = content.match(FENCE_RE);
  if (!match) {
    // Mid-stream: an opening fence with no close yet — drop the partial tail.
    const open = content.match(OPEN_FENCE_RE);
    if (open && open.index != null) {
      return { content: content.slice(0, open.index).trimEnd(), actions: [] };
    }
    return { content, actions: [] };
  }

  let actions: SuggestedAction[] = [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      actions = parsed
        .map((a) => ({
          label: String((a as { label?: unknown })?.label ?? '').trim(),
          prompt: String((a as { prompt?: unknown })?.prompt ?? '').trim(),
        }))
        .filter((a) => a.label && a.prompt)
        .slice(0, 4);
    }
  } catch {
    /* malformed JSON → no buttons, but still strip the block below */
  }

  const start = match.index ?? 0;
  const cleaned = (content.slice(0, start) + content.slice(start + match[0].length)).trim();
  return { content: cleaned, actions };
}
