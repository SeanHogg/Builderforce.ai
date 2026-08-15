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
