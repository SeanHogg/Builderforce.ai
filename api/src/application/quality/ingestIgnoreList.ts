/**
 * Events the quality ingest DROPS before they are metered, grouped or stored.
 *
 * A declared list, not branches in the engine: each entry names WHY the event is
 * noise, so adding one is a reviewed decision with its reason beside it, and the
 * engine asks one question (`ignoredEventReason`) rather than accreting `if`s.
 *
 * The bar for an entry is "a browser/runtime notice that is never a bug of ours
 * and that nobody can act on". Anything that might be a real failure — however
 * noisy — stays in, because a dropped event is invisible everywhere.
 */

import type { NormalizedErrorEvent } from './errorSpec';

export interface IgnoredErrorPattern {
  /** Stable id, for logs and tests. */
  id: string;
  /** Why this is safe to drop. */
  reason: string;
  /** Matched against `message` and against `type: message`. */
  match: RegExp;
}

export const IGNORED_ERROR_PATTERNS: ReadonlyArray<IgnoredErrorPattern> = [
  {
    id: 'resize-observer-loop',
    // 1,440 of 2,541 ingested events in the 14 days to 2026-10-10. The spec
    // says the browser reports this when a ResizeObserver callback changes layout
    // and delivery is deferred to the next frame — nothing is lost, nothing is
    // broken, and the stack (if any) points into the browser, not our code.
    reason: 'Benign browser notice: ResizeObserver notifications deferred to the next frame.',
    match: /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i,
  },
];

/** The id of the ignore-list entry this event matches, or null when it should be ingested. */
export function ignoredEventReason(e: Pick<NormalizedErrorEvent, 'type' | 'message'>): string | null {
  const message = e.message ?? '';
  const qualified = e.type ? `${e.type}: ${message}` : message;
  for (const pattern of IGNORED_ERROR_PATTERNS) {
    if (pattern.match.test(message) || pattern.match.test(qualified)) return pattern.id;
  }
  return null;
}
