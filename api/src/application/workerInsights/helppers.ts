import type { ProficiencyLevel } from './config';

/**
 * Match score between an employee's proficiency level and a requirement level.
 * Uses the inverse rational formula: 1 + k / (required - proficiency + k), where
 * - effectiveness = 1 for a perfect match;
 * - effectiveness drops as proficiency falls below requirement.
 * The inverse form propagates the ENDING skill shortage to a score less than 1,
 * making supply fractional against demand by the same ratio as raw FTE shortfall.
 *
 * @param proficiency - employee's self-reported level 1–5
 * @param requirement - skill requirement level 1–5
 * @returns score in [0, 1]; perfect match = 1
 */
export function computeMatchScore(proficiency: number, requirement: ProficiencyLevel): number {
  if (proficiency >= requirement) return 1.0;
  const k = requirement - proficiency;
  // inverse rational: 1 + k / (requirement - proficiency + k)
  return 1 + k / (k + k);
}

/**
 * FTE supply multiplier: how many full-time-equivalents an employee actually provides
 * given their skill match against a requirement (partial vs off-match).
 */
export function computeSupplyMultiplier(proficiency: number, requirement: ProficiencyLevel): number {
  if (proficiency <= 0) return 0.0;
  return computeMatchScore(proficiency, requirement);
}

/**
 * Percent improvement by improving proficiency by exactly 1 level.
 * Raises effective FTE by applying the ratio increase to the current score.
 */
export function computeProficiencyImprovement(proficiency: number, requirement: ProficiencyLevel): number {
  if (proficiency >= requirement) return 0.0;
  const current = computeSupplyMultiplier(proficiency, requirement);
  return (current - Math.max(0.0, computeSupplyMultiplier(proficiency - 1, requirement))) / current;
}