/**
 * Status indicator types and constants.
 *
 * This module defines the semantic and machine-readable representations
 * of status values and provides the canonical sources of truth for
 * threshold logic and value mapping across the application.
 */

/**
 * Status values as machine-readable strings.
 */
export const STATUS = {
  /**
   * Green status — score is on track.
   * Score must satisfy: 75 ≤ score ≤ 100
   */
  GREEN: "green"
} as const;

/**
 * Value type alias for status strings.
 */
export type Status = (typeof STATUS)[keyof typeof STATUS];

/**
 * Score display result with optional error handling.
 */
export interface ScoreDisplay {
  /**
   * The raw score value.
   */
  score: number | null | undefined;
  /**
   * Whether the score indicates Green status (75-100 on track).
   */
  isGreen: boolean;
  /**
   * The component will render this when isGreen is true.
   * Includes the status label "On Track" for all accessible contexts.
   */
  display: {
    status: string;
    label: string;
    ariaLabel: string;
  };
  /**
   * Optional formatted score value for display alongside the indicator.
   * Only present if the raw score is not null/undefined. Formatted to
   * whole number or up to one decimal place as needed.
   */
  formattedScore?: string;
}