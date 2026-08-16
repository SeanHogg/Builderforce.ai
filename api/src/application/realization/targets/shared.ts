/**
 * Small derivations every target needs from a brief.
 *
 * Each of these was about to be written twice with slightly different rules —
 * "the first five capabilities, title-cased" is the sort of thing that ends up
 * capitalised on one page and not on another, which reads as a bug in a proof
 * whose whole job is to look finished.
 */

import type { ChallengeSpec } from '../../challenge/parseBrief';

/** Human-readable name for a capability token: `inbound-webhook` → `Inbound webhook`. */
export function capabilityLabel(capability: string): string {
  const words = capability.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The handful of capabilities a proof should actually show.
 *
 * Capped because a demo that walks eleven features is a demo nobody watches to
 * the end, and a prototype with eleven screens is not testable in a session.
 * Falls back to one generic step so a brief that named nothing still produces a
 * proof with a shape rather than an empty page.
 */
export function headlineCapabilities(spec: ChallengeSpec, max = 4): string[] {
  const named = spec.capabilities.slice(0, max).map(capabilityLabel);
  return named.length ? named : ['The core flow'];
}

/** First sentence of the goal, for a headline. Falls back to the whole thing. */
export function goalHeadline(spec: ChallengeSpec): string {
  const sentence = spec.goal.split(/(?<=[.!?])\s/)[0]?.trim();
  return (sentence && sentence.length > 12 ? sentence : spec.goal).slice(0, 180);
}

/** The audience a proof is aimed at, named or generic. */
export function audienceOf(spec: ChallengeSpec): string {
  return spec.sponsor?.trim() || 'the people this is for';
}

/**
 * Criteria for the proof, preferring what the brief already committed to.
 *
 * A brief that stated its own success criteria has already had the argument
 * about what winning means; restating a generic version underneath it invites
 * the team to answer the easier one.
 */
export function criteriaFrom(spec: ChallengeSpec, fallback: readonly string[]): string[] {
  return spec.successCriteria.length ? [...spec.successCriteria, ...fallback] : [...fallback];
}

/**
 * The collection every console that computes a threshold verdict posts its
 * decisive call to.
 *
 * Shared by every target that has one AND by `application/realization/realizationVerdict.ts`,
 * which reads it back — written once, here, so the name and the payload shape
 * a console sends can never drift from what the platform's rollup expects.
 */
export const VERDICT_COLLECTION = 'proof-verdict';

/**
 * `<script>` fragment providing `recordVerdict(buttonId, verdict, metricLabel, metricValue, target, extra)`.
 *
 * ── WHY A BUTTON, NOT AN AUTOMATIC POST ──────────────────────────────────────
 * A live count crossing the target is decisive the moment it happens; a count
 * still short of it is NOT decisively a miss — the window may not have closed
 * yet. Only a person watching the console knows whether it is time to call it
 * (day 14 of the charter, all trials judged), so this waits for a click. What
 * it removes is the OTHER half of the job: reading the number off the screen
 * and typing it somewhere. The click reads it out of the console's own live
 * variables and sends exactly that — the figure that reaches the record is
 * never retyped.
 *
 * ── WHY THE SAME WRITE ENDPOINT AS THE SIGNUP FORM ──────────────────────────
 * `/__api/collections/<name>` is already same-origin, public and key-free for
 * exactly this reason — no new backend surface, no auth to wire into a page
 * that has none. The write lands in `site_records` next to every other
 * submission this proof collects, and `realizationVerdict.ts` is the one
 * trusted reader that turns it into the row's `verdict`.
 */
export function verdictRecorderScript(): string {
  return `  function recordVerdict(buttonId, verdict, metricLabel, metricValue, target, extra) {
    var btn = document.getElementById(buttonId);
    if (btn) { btn.disabled = true; btn.textContent = 'Recording…'; }
    fetch('/__api/collections/${VERDICT_COLLECTION}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({
        verdict: verdict, metricLabel: metricLabel, metricValue: metricValue, target: target,
      }, extra || {})),
    }).then(function (res) {
      if (!btn) return;
      btn.textContent = res.ok ? 'Recorded — refresh will not lose it' : 'Could not record — try again';
      btn.disabled = res.ok;
    }).catch(function () {
      if (btn) { btn.textContent = 'Could not record — try again'; btn.disabled = false; }
    });
  }`;
}
