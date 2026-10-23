/**
 * The deterministic-handler contract (cost lever D7).
 *
 * A handler answers ONE narrow kind of question without a model — or declines. It is
 * matched on the WHOLE user message, conservatively: precision over recall. A question
 * it is not certain about returns null and the request goes to a model exactly as it
 * would without the lever. Handlers are pure; "now" is injected for date questions.
 */

export interface DeterministicAnswer {
  /** The handler that answered (stamped on the response and the trace). */
  handler: string;
  /** The assistant text. */
  content: string;
}

export interface DeterministicHandler {
  id: string;
  /** The answer, or null when the question is not one this handler is sure of. */
  answer(question: string, now: Date): DeterministicAnswer | null;
}

/**
 * A computed number for display: integers verbatim, everything else to `significant`
 * significant digits with float noise removed (0.1 + 0.2 → 0.3). Null for a
 * non-finite value — a handler then declines rather than print "Infinity".
 */
export function formatNumber(n: number, significant = 12): string | null {
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const rounded = Number.parseFloat(n.toPrecision(significant));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Lower-cased, whitespace-collapsed, trailing "?" / "." removed — what every matcher reads. */
export function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, ' ').replace(/[?.!]+$/, '').trim().toLowerCase();
}
