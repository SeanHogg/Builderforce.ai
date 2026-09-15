/**
 * The founder's listing wizard — its steps as DATA.
 *
 * BurnRateOS's `OnboardingStepper` (871 lines) hard-coded seven steps and
 * branched on the user's role inside each. Three of them are what a startup
 * listing needs and they are declared here: the company's basics, its declared
 * money, and the decision to be found. A fourth step is a row, not a branch.
 *
 * No `'use client'`: a data module with no hooks.
 */

export const LISTING_STEP_IDS = ['basics', 'finance', 'visibility'] as const;
export type ListingStepId = (typeof LISTING_STEP_IDS)[number];

export interface ListingStepSpec {
  id: ListingStepId;
  /** Icon name from `components/ui/Icon`. */
  icon: 'workspace' | 'insights' | 'megaphone';
  /** i18n key under `investor.listing.steps`. */
  labelKey: string;
}

export const LISTING_STEPS: readonly ListingStepSpec[] = [
  { id: 'basics', icon: 'workspace', labelKey: 'basics' },
  { id: 'finance', icon: 'insights', labelKey: 'finance' },
  { id: 'visibility', icon: 'megaphone', labelKey: 'visibility' },
];

export function nextStep(current: ListingStepId): ListingStepId | null {
  const index = LISTING_STEP_IDS.indexOf(current);
  return LISTING_STEP_IDS[index + 1] ?? null;
}

export function previousStep(current: ListingStepId): ListingStepId | null {
  const index = LISTING_STEP_IDS.indexOf(current);
  return index > 0 ? LISTING_STEP_IDS[index - 1] : null;
}
