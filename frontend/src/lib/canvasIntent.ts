/**
 * THE way a marketing surface hands a visitor to the canvas WITH THEIR INTENT.
 *
 * ── WHY THIS IS ONE FUNCTION ────────────────────────────────────────────────
 * "Every CTA must carry intent into a seeded session" is the navigation rule
 * that keeps somebody from landing on an empty board wearing an acquisition
 * cost. It was being followed — and re-implemented at every call site. Four
 * separate hand-built `\`/create/new?prompt=${encodeURIComponent(...)}\`` strings
 * existed (`/tools/<id>`, `/tutorials` twice, the model compare tray), each with
 * its own idea of encoding, and none of them clamping the prompt.
 *
 * That last part is the bug a shared helper removes rather than documents:
 * `/create/new` reads the parameter and slices it to {@link CANVAS_PROMPT_MAX}.
 * A caller passing more produced a URL whose tail was silently discarded — and
 * a truncated prompt is worse than no prompt, because it reads as a complete
 * instruction that happens to be wrong. The clamp now happens where the link is
 * BUILT, so the URL and the board always say the same thing.
 *
 * Signed-in surfaces use this too: `/create/new` decides for itself whether the
 * session it opens is local or tenant-backed, which is exactly the decision a
 * link should not be making.
 */

/**
 * The prompt ceiling, shared with the page that reads it.
 *
 * Declared here rather than in `app/create/new/page.tsx` so the builder and the
 * reader cannot disagree about where the cut is — the failure that motivated
 * this module is precisely the two of them holding different numbers.
 */
export const CANVAS_PROMPT_MAX = 4_000;

/** Extra query the canvas understands, beyond the prompt (e.g. model compare). */
export type CanvasIntentParams = Record<string, string> | URLSearchParams;

/**
 * A `/create/new` URL that opens a real board already holding `prompt`.
 *
 * Returns the bare route when there is nothing to say, so a caller with an
 * empty prompt still produces a working link rather than `?prompt=`.
 */
export function canvasIntentHref(prompt: string, extra?: CanvasIntentParams): string {
  const seeded = prompt.trim().slice(0, CANVAS_PROMPT_MAX);
  const params = new URLSearchParams(seeded ? { prompt: seeded } : {});
  if (extra) {
    // `append`, not `set`: the canvas takes REPEATED `model` parameters for a
    // comparison, and setting would collapse a three-way compare to one model.
    for (const [key, value] of extra instanceof URLSearchParams ? extra : Object.entries(extra)) {
      params.append(key, value);
    }
  }
  const query = params.toString();
  return query ? `/create/new?${query}` : '/create/new';
}
