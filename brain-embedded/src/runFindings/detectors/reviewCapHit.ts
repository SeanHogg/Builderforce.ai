/**
 * `review_cap_hit` — a ship call (push / PR / review record) refused because the run hit the review-round cap:
 * its result is `{ ok: false, error: '… review round 3 …' }`, the capped-refusal marker. Info: the run is telling
 * the truth about a policy gate, not doing anything wrong.
 */
import { finding, callEvidence } from '../findingParts';
import type { RunFinding, RunView, ViewCall } from '../types';

/** The exact capped-refusal marker in a failed ship call's error text (the agreed marker, nothing else). */
const CAP_MARKER = 'review round 3';

/** Ship calls whose cap refusal is a finding. */
const SHIP_TOOLS: ReadonlySet<string> = new Set(['git_push', 'open_pull_request', 'builtin_reviews_record']);

/** The call's error text when it is a cap refusal, else null. */
function capError(c: ViewCall): string | null {
  if (!SHIP_TOOLS.has(c.name) || !c.error) return null;
  return c.error.includes(CAP_MARKER) ? c.error : null;
}

export function reviewCapHit(view: RunView): RunFinding[] {
  const capped = view.calls.map((c) => ({ call: c, error: capError(c) })).filter((r): r is { call: ViewCall; error: string } => r.error !== null);
  if (capped.length === 0) return [];
  return [finding('review_cap_hit', 'info', { count: capped.length },
    capped.map(({ call, error }) => callEvidence(call, undefined, error)))];
}
