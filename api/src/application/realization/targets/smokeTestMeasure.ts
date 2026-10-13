/**
 * The smoke test's MEASURE (PRD 33 §5.3.1) — the charter's numbers as the
 * `ProofMeasure` Insights grades it by, and the names the landing page reports
 * under (its success event and its source tag). Kept beside `smokeTest.ts`,
 * which renders the page that emits them, so the page and the measure read the
 * same constants and cannot drift.
 */

import type { ProofMeasure } from '@builderforce/interaction-contract';

/** The charter's window: "14 days from first traffic". */
export const SMOKE_WINDOW_DAYS = 14;

/**
 * The success the landing page reports (`BFReplay.event`) — the built-in
 * "sign up" smart event, so it reads under the same name in every Insights view.
 */
export const SMOKE_SUCCESS_EVENT = 'sign up';
/** The tag the landing page carries: where the visit came from. */
export const SMOKE_SOURCE_TAG = 'source';
/** A visit with no named source. The charter's sample is visitors FROM a named source. */
export const SMOKE_UNNAMED_SOURCE = 'direct';

/**
 * The charter, as a measure: at least `sample` landing-page visits from a named
 * source, judged on ≥ `target` sign-ups within the window. Every number is one the
 * charter already states — nothing here is invented to make the proof gradeable.
 */
export function smokeTestMeasure(target: number, sample: number): ProofMeasure {
  return {
    sample: {
      filter: {
        all: [
          { field: 'visitedPath', op: 'in', value: ['/', '/index.html'] },
          { field: 'tag', op: 'neq', value: `${SMOKE_SOURCE_TAG}=${SMOKE_UNNAMED_SOURCE}` },
        ],
      },
      min: sample,
    },
    success: { kind: 'smartEvent', ref: SMOKE_SUCCESS_EVENT },
    threshold: { op: '>=', value: target, unit: 'count' },
    windowDays: SMOKE_WINDOW_DAYS,
  };
}
