/**
 * How a canvas `kind.action` lands on the outcome ledger.
 *
 * ── WHY THIS IS NOT A BRANCH IN THE RUNNER ──────────────────────────────────
 * The runner used to apply a patch and a notice and stop. Recording then grew
 * one `if (kind === 'form' && action === 'publish')` per act, which is the same
 * "new branch per case" the act registry was built to kill — and the one that
 * forgets a branch is the one that silently drops correlation coverage.
 *
 * So the mapping is data. The runner looks up `{kind}.{action}` and emits
 * `started` + one terminal per row, same `correlationId`. An act that is not
 * special-cased still records as `{kind}.{action}` so coverage never depends
 * on remembering to add a case.
 *
 * ── WHAT QUALIFIES AS A PROOF ───────────────────────────────────────────────
 * A draft object is not a proof. The cheap canvas path (talk to someone, ask a
 * crowd, publish a form, grade what came back) maps onto the same four
 * proof-lifecycle actions the realization API writes, so the north-star
 * "ideas reaching a graded proof" counts a founder who never left the board.
 * Publishing a form is both a real deliverable (`artifact.publish`) and a
 * built proof (`proof.build`) because the join URL is an address a person
 * can open. Grading is `proof.grade` with `metricValue` 1 or 0.
 *
 * An experiment whose numbers were typed (`evidence.authored`) can still be
 * graded — that is a measurement of authored counts, and the metadata says
 * so. Binding live traffic is a different ticket.
 */

export type CanvasOutcomeSuccessPhase = 'succeeded' | 'validated' | 'reused';

export interface CanvasOutcomeEventSpec {
  /** Ledger `action` — a proof-lifecycle verb, a delivery verb, or `{kind}.{action}`. */
  action: string;
  successPhase: CanvasOutcomeSuccessPhase;
  /** Patch field holding a public URL. When set, `metadata.reachable` is derived from it. */
  reachableField?: string;
  /** Realization target this cheap proof corresponds to. */
  targetKey?: string;
}

/**
 * Special-cased canvas acts. Missing keys fall back to `{kind}.{action}`.
 *
 * Proof-lifecycle verbs (`idea.read`, `proof.choose`, `proof.build`, `proof.grade`)
 * and delivery verbs (`artifact.publish`) are spelled here exactly as
 * `outcomeMetricContract` counts them — a second spelling would be a second
 * north star.
 */
export const CANVAS_ACTION_OUTCOMES: Record<string, readonly CanvasOutcomeEventSpec[]> = {
  'idea.explore': [{ action: 'idea.read', successPhase: 'succeeded' }],
  'idea.test': [{ action: 'proof.choose', successPhase: 'succeeded', targetKey: 'smoke-test' }],
  'idea.reveal': [{ action: 'proof.grade', successPhase: 'validated' }],
  'form.publish': [
    { action: 'artifact.publish', successPhase: 'succeeded', reachableField: 'joinUrl' },
    { action: 'proof.build', successPhase: 'succeeded', reachableField: 'joinUrl', targetKey: 'smoke-test' },
  ],
  'form.collect': [{ action: 'form.collect', successPhase: 'succeeded' }],
  'form.close': [{ action: 'form.close', successPhase: 'succeeded' }],
  'poll.publish': [
    { action: 'artifact.publish', successPhase: 'succeeded', reachableField: 'joinUrl' },
    { action: 'proof.build', successPhase: 'succeeded', reachableField: 'joinUrl' },
  ],
};

/** The ledger events one canvas act should emit. Never empty. */
export function canvasActionOutcomes(kind: string, action: string): readonly CanvasOutcomeEventSpec[] {
  const key = `${kind}.${action}`;
  return CANVAS_ACTION_OUTCOMES[key] ?? [{ action: key, successPhase: 'succeeded' }];
}

/**
 * Whether a published address is one a person can actually open.
 *
 * Matches the realization writer's `https?://` rule, and also accepts a
 * same-origin path (`/f/{slug}`, `/p/{slug}`) because the canvas join URL is
 * built from `window.location.origin` and a test (or an SSR miss) can leave
 * the origin empty while the path is still the public route.
 */
export function canvasOutcomeReachable(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  return trimmed.startsWith('/') && trimmed.length > 1;
}
