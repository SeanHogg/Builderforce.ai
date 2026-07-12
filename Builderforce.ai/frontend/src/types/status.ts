/** Status indicator types and constants. */
export const STATUS = {
  /** Green status — score is on track. */
  GREEN: 'green',
} as const;

export type Status = (typeof STATUS)[keyof typeof STATUS];

/** Score display result with optional error handling. */
export interface ScoreDisplay {
  /** The raw score value. */
  score: number | null | undefined;
  /** Whether the score indicates Green status (75–100 on track). */
  isGreen: boolean;
  /** The component will render this when isGreen is true, populated by statusHelpers/cross-factories. */
  display: {
    status: Status;
    label: string; // "On Track"
    ariaLabel: string; // "Status: Green, On Track"
  };
  /** Optional formatted score value for display alongside the indicator (when score is present). */
  formattedScore?: string;
}

/** Score to GreenStatusIndicator props bridge helper (no React runtime reflection). */
export function scoreToGreenIndicatorProps(score: number | null | undefined): StatusDisplayIndicatorProps | null {
  const isGreen = score !== null && score !== undefined && score >= 75 && score <= 100;
  if (!isGreen) {
    return null;
  }
  // Ensure well-formed canonical outputs
  const canonicalLabel = 'On Track';
  const canonicalAriaLabel = 'Status: Green, On Track';
  return {
    score,
    ariaLabel: canonicalAriaLabel,
  };
}

/** GreenStatus props (copied from the component for use in non-React scenarios). */
export interface StatusDisplayIndicatorProps {
  score: number | null | undefined;
  ariaLabel?: string;
}

/** Determine whether a score falls within the Green status range. */
export function isGreenStatus(score: number | null | undefined): boolean {
  return score !== null && score !== undefined && score >= 75 && score <= 100;
}

/** Calculate the Green status display based on a score. */
export function getGreenStatusDisplay(
  score: number | null | undefined,
): { isGreen: boolean; display: { status: Status; label: string; ariaLabel: string }; formattedScore?: string } {
  const green = isGreenStatus(score);
  const display = {
    status: STATUS.GREEN,
    label: 'On Track',
    ariaLabel: 'Status: Green, On Track',
  };
  const formattedScore = score !== null && score !== undefined ? formatScore(score) : undefined;
  return { isGreen: green, display, formattedScore };
}

/** Format a score as a whole number or up to one decimal place. */
function formatScore(score: number): string {
  const epsilon = 0.0001;
  if (Math.abs(score - Math.round(score)) < epsilon) {
    return String(Math.round(score));
  }
  return score.toFixed(1);
}