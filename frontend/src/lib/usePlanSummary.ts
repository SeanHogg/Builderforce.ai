// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useTranslations } from 'next-intl';
import { useConsumption } from '@/lib/useConsumption';

/** The plan funding this workspace, as every plan control presents it. */
export interface PlanSummary {
  /** The tier's name, localised ("Free", "Pro"). */
  label: string;
  isFree: boolean;
  /** Tokens left on a metered plan; null when unmetered or unknown. */
  remaining: number | null;
  /** Free and out of allowance — the one state that must read as a problem. */
  exhausted: boolean;
  /** What the plan means, for a tooltip. */
  title: string;
  /** Where changing it happens. */
  href: string;
  /** Theme-token colour: error when exhausted, accent on free, muted on a paid plan. */
  tone: string;
}

/**
 * The plan, read once for every control that shows it (`PlanBadge`, Studio's
 * account pill). Null until the shared cached snapshot knows a plan, so nothing
 * ever shows a misleading "Free" while loading.
 */
export function usePlanSummary(): PlanSummary | null {
  const t = useTranslations('planBadge');
  const snapshot = useConsumption();
  if (!snapshot) return null;

  const tier = snapshot.plan.effective;
  const isFree = tier === 'free';
  const meter = snapshot.meters.find((m) => m.key === 'ai_tokens');
  // "Tokens left" only means something on a metered plan; an unlimited or absent
  // meter shows the tier alone rather than inventing a number.
  const remaining = meter && !meter.unlimited && meter.remaining >= 0 ? meter.remaining : null;
  const exhausted = remaining !== null && remaining <= 0;

  // A tier the catalog doesn't know (a plan added server-side ahead of the copy)
  // must not throw in a header — fall back to the raw key, title-cased.
  const tierKey = `tier.${tier}` as 'tier.free';
  const label = t.has(tierKey) ? t(tierKey) : tier.replace(/^./, (ch) => ch.toUpperCase());

  return {
    label,
    isFree,
    remaining,
    exhausted,
    title: isFree ? t('freeHint') : t('paidHint', { plan: label }),
    href: isFree ? '/pricing?upgrade=pro' : '/pricing',
    tone: exhausted ? 'var(--error-text)' : isFree ? 'var(--accent)' : 'var(--text-muted)',
  };
}
