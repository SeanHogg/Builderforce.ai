import { biApi, type ValidationEngagementsResult } from '@/lib/builderforceApi';
import { useSharedSource, type SharedAsync } from '@/lib/widgets/sharedSource';

/*
 * No `'use client'`: a hook module marks no boundary.
 */

/** The ONE cache identity for `/api/bi/validation-engagements`, beside
 *  `bi:burn-rate` — so a card here and a pinned widget later share one read. */
export const VALIDATION_ENGAGEMENTS_SOURCE = 'bi:validation-engagements';

/**
 * The segment's validation results, validation dashboards and feedback
 * collectors, through the shared single-flight source every BI card uses.
 */
export function useValidationEngagements(): SharedAsync<ValidationEngagementsResult> {
  return useSharedSource(VALIDATION_ENGAGEMENTS_SOURCE, () => biApi.getValidationEngagements());
}

export type EngagementKind = 'validation' | 'dashboard' | 'feedback_collector';

/** Group the engagement list by what it is, so the card can say "3 experiments,
 *  1 dashboard, 2 collectors" before it lists any of them. Any validation type
 *  the API names (it passes `validation_type` through) counts as `validation`. */
export function countEngagementKinds(result: ValidationEngagementsResult | null): Record<EngagementKind, number> {
  const counts: Record<EngagementKind, number> = { validation: 0, dashboard: 0, feedback_collector: 0 };
  for (const engagement of result?.engagements ?? []) {
    if (engagement.kind === 'dashboard') counts.dashboard += 1;
    else if (engagement.kind === 'feedback_collector') counts.feedback_collector += 1;
    else counts.validation += 1;
  }
  return counts;
}
