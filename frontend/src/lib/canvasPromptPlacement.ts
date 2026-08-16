/**
 * Where the prompt lives — floating over the board, docked into Brain, or closed.
 *
 * ── WHY THIS IS A CHOICE AND NOT A LAYOUT ────────────────────────────────────────
 * The composer was pinned above the bottom of the canvas, always, at a fixed width, and
 * it could not be moved or dismissed. That is right when you are prompting and wrong the
 * rest of the time: it covers the bottom third of a board you are trying to arrange, and
 * the one thing everybody tries — dragging it out of the way — did nothing.
 *
 * Three placements, because there are exactly three things a person wants from it:
 *
 *   `float`  — over the board, near the work. The default, and what it always was.
 *   `docked` — inside the Brain panel, under the transcript. What you want once the
 *              conversation matters more than the board: one column, prompt at the
 *              bottom, exactly like every chat.
 *   `closed` — gone, with the board whole. Reachable again from the command bar's
 *              prompt toggle, which is why closing it is safe rather than a trap.
 *
 * ── WHY IT IS REMEMBERED ─────────────────────────────────────────────────────────
 * Same reason the surface and the folded bar are: it is a place somebody chose to work,
 * and re-floating a prompt they docked on every reload is the app overruling a decision
 * they already made. Persisted per browser, not per board — the preference is about how
 * this person works, not about this canvas.
 *
 * `float` is the default for a first-time visitor: a canvas whose prompt is hidden behind
 * a toggle they have never seen is a canvas with no visible way to ask for anything.
 */

export const CANVAS_PROMPT_PLACEMENTS = ['float', 'docked', 'closed'] as const;

export type CanvasPromptPlacement = (typeof CANVAS_PROMPT_PLACEMENTS)[number];

export const DEFAULT_CANVAS_PROMPT_PLACEMENT: CanvasPromptPlacement = 'float';

export const CANVAS_PROMPT_PLACEMENT_KEY = 'builderforce:create:promptPlacement';

function isPlacement(value: unknown): value is CanvasPromptPlacement {
  return typeof value === 'string' && (CANVAS_PROMPT_PLACEMENTS as readonly string[]).includes(value);
}

export function readCanvasPromptPlacement(): CanvasPromptPlacement {
  if (typeof window === 'undefined') return DEFAULT_CANVAS_PROMPT_PLACEMENT;
  try {
    const saved = window.localStorage.getItem(CANVAS_PROMPT_PLACEMENT_KEY);
    return isPlacement(saved) ? saved : DEFAULT_CANVAS_PROMPT_PLACEMENT;
  } catch {
    return DEFAULT_CANVAS_PROMPT_PLACEMENT;
  }
}

export function writeCanvasPromptPlacement(placement: CanvasPromptPlacement): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CANVAS_PROMPT_PLACEMENT_KEY, placement);
  } catch { /* storage can be unavailable in hardened contexts */ }
}

/**
 * What the command bar's prompt toggle does.
 *
 * It is a two-state control over a three-state value: press it and the prompt is either
 * back where you last had it, or gone. Closing remembers nothing, so re-opening restores
 * `float` rather than a placement the person may have set months ago — the toggle is for
 * "get this out of my way for a minute", and the dock is a decision made deliberately in
 * the prompt's own header.
 */
export function toggledCanvasPromptPlacement(current: CanvasPromptPlacement): CanvasPromptPlacement {
  return current === 'closed' ? DEFAULT_CANVAS_PROMPT_PLACEMENT : 'closed';
}
