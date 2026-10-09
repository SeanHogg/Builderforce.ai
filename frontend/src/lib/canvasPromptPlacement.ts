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

/**
 * WHERE THE ONE COMPOSER GOES, after the host, the surface and the lens have had their say.
 *
 * When Brain IS the surface (chat) there is no dock to join and no board to hand the
 * space back to, so it stays floating and open whatever the stored preference says.
 * `docked` renders it INSIDE the Brain panel's column, so it only holds while that panel
 * is on screen — otherwise the preference is untouched and the prompt floats until the
 * panel comes back.
 *
 * A LENS may force a placement (`lib/canvasLens.ts` — Studio docks the prompt under its
 * conversation, the Lovable/Replit reading). It wins over the stored preference only
 * while the Brain dock is drawn, for the same reason `docked` does: with no panel there
 * is nowhere to dock into, and the person's own preference is what applies. It never
 * writes that preference.
 *
 * A surface the EMBEDDING HOST supplies owns its whole centre, input included: its
 * runtime is somewhere this component cannot reach (in VS Code, the extension host),
 * so a composer wired to the in-page `evaluateCanvas` would be a second, quieter way
 * to start a turn that behaves differently from the one the reader can see.
 *
 * Moved here from `CanvasPromptComposer.tsx`: it is a pure rule over this module's type,
 * and a rule worth a unit test should not need a component tree to import.
 */
export function effectiveCanvasPromptPlacement({ hostOwnsSurface, brainIsSurface, preference, brainDockDrawn, lensPlacement = null }: {
  hostOwnsSurface: boolean;
  brainIsSurface: boolean;
  preference: CanvasPromptPlacement;
  brainDockDrawn: boolean;
  /** The placement the active lens forces, or null. */
  lensPlacement?: CanvasPromptPlacement | null;
}): CanvasPromptPlacement {
  if (hostOwnsSurface) return 'closed';
  if (brainIsSurface) return 'float';
  if (lensPlacement && brainDockDrawn) return lensPlacement;
  return preference === 'docked' && !brainDockDrawn ? 'float' : preference;
}
