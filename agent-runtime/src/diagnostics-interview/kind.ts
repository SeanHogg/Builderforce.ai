/**
 * Rating conversion from user-provided phrasing into Likelihood/Impact.
 *
 * This module extracts a Rating phrase and maps it to RatingLevel,
 * aligning with FR-2b (Risk) and FR-2c (Priority). The implementation
 * normalizes unsureness/uncertainty into 'Medium'.
 */

import {
  type Likelihood,
  type Impact,
  type Rating,
  type RatingLevel,
} from './types';

/**
 * Convert a single-purpose rating phrase (e.g., "High risk") into Level.
 * Normalizes uncertainty (unlikely/uncertain) to 'Medium' because safe
 * defaults when the user cannot or should not provide a strict value.
 *
 * If no recognizable level is found, returns 'Medium' by design.
 */
export function parseRatingLevel(phrase: string): RatingLevel {
  const clean = phrase.toLowerCase().trim();

  // Explicit levels
  if (/^low\b/.test(clean)) return RatingLevel.Low;
  if (/^medium\b/.test(clean)) return RatingLevel.Medium;
  if (/^high\b/.test(clean)) return RatingLevel.High;

  // Unsures/that are uncertain, unsure
  if (/^not\s+(?:too|\bsure\s*)|not\s+know|\?$/.test(clean)) return RatingLevel.Medium;

  return RatingLevel.Medium;
}

/**
 * Build a Rating object from a raw input phrase.
 */
export function makeRating(phrase: string): Rating {
  return {
    level: parseRatingLevel(phrase),
    phrase,
  };
}

/**
 * Parse a Likelihood rating from the interview engine.
 */
export function parseLikelihood(phrase: string): Likelihood {
  return makeRating(phrase);
}

/**
 * Parse an Impact rating from the interview engine.
 */
export function parseImpact(phrase: string): Impact {
  return makeRating(phrase);
}