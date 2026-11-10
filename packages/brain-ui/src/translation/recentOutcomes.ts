/**
 * The in-memory note of recent failed / needs-a-translator outcomes, so scrolling back does not
 * re-ask. Module-level (shared across every `<TranslatableText>`), so the provider clears it
 * together with the device cache when the signed-in identity changes.
 */
import type { TranslatedTextState } from './useTranslatedText';

/** How long a failed / needs-a-translator outcome is remembered in memory, so scrolling back does not re-ask. */
export const FAILED_OUTCOME_TTL_MS = 60_000;

export type Outcome = Extract<TranslatedTextState, { status: 'needs-device' | 'failed' }>;
const recentOutcomes = new Map<string, { until: number; outcome: Outcome }>();

export const recentOutcome = (key: string): Outcome | undefined => {
  const hit = recentOutcomes.get(key);
  if (!hit) return undefined;
  if (hit.until < Date.now()) { recentOutcomes.delete(key); return undefined; }
  return hit.outcome;
};

/** Forget the remembered failures (a test seam, and what a sign-out does). */
export const clearRecentOutcomes = (): void => recentOutcomes.clear();

export const rememberOutcome = (key: string, outcome: Outcome): void => {
  if (recentOutcomes.size > 500) recentOutcomes.clear();
  recentOutcomes.set(key, { until: Date.now() + FAILED_OUTCOME_TTL_MS, outcome });
};
