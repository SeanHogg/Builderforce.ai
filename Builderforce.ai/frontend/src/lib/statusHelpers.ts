import { STATUS } from '@/types/status';

/**
 * Classification helper for Green status (75-100 on track).
 *
 * This module uses the same threshold logic as the Green status indicator
 * and provides the canonical source of truth for all classification operations.
 */

/**
 * Determines whether a score falls within the Green status range (75-100, inclusive).
 *
 * @param score - The raw score value (integer or float)
 * @returns True if 75 ≤ score ≤ 100, false otherwise
 *
 * Boundary behavior:
 * - score = 75 → true (inclusive)
 * - score = 100 → true (inclusive)
 * - score = 74.9 → false
 * - score = 100.1 → false
 */
export function isGreenStatus(score: number | null | undefined): boolean {
  return score !== null && score !== undefined && score >= 75 && score <= 100;
}

/**
 * Calculates the Green status display information for a score.
 *
 * @param score - The raw score value
 * @returns ScoreDisplay object with classification, display metadata, and optional formatted score
 *
 * Returns:
 * - isGreen = true when 75 ≤ score ≤ 100
 * - display.status = STATUS.GREEN ("green")
 * - display.label = "On Track"
 * - display.ariaLabel = "Status: Green, On Track"
 * - formattedScore = score formatted to whole number or one decimal place (if score is present)
 */
export function getGreenStatusDisplay(
  score: number | null | undefined,
): {
  isGreen: boolean;
  display: {
    status: (typeof STATUS)[keyof typeof STATUS];
    label: string;
    ariaLabel: string;
  };
  formattedScore?: string;
} {
  const green = isGreenStatus(score);
  const display = {
    status: STATUS.GREEN,
    label: 'On Track',
    ariaLabel: 'Status: Green, On Track',
  };

  // Format score to whole number or one decimal place
  const formattedScore = score !== null && score !== undefined ? formatScore(score) : undefined;

  return {
    isGreen: green,
    display,
    formattedScore,
  };
}

/**
 * Formats a score as a whole number or up to one decimal place.
 *
 * @param score - The score to format
 * @returns Formatted string representation
 *
 * Examples:
 * - 87.5 → "87.5"
 * - 87.51 → "87.5"
 * - 87 → "87"
 * - 0 → "0"
 */
function formatScore(score: number): string {
  // Use a small epsilon to avoid floating point precision issues
  const epsilon = 0.0001;
  // If the score is effectively an integer (within epsilon), show as integer
  if (Math.abs(score - Math.round(score)) < epsilon) {
    return String(Math.round(score));
  }
  // Otherwise, show up to one decimal place
  return score.toFixed(1);
}