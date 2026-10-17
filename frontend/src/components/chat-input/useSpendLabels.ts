// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { SpendLabels } from '@seanhogg/builderforce-brain-ui';

/** The saving sources the shared spend readouts name, in the server's key space. */
const SOURCES = ['prompt_cache', 'memory_answer', 'evermind_answer', 'response_cache', 'context_trim', 'recall_overhead'] as const;

/**
 * The shared spend & savings readouts' copy (the chat's spend pill in the info strip,
 * and the Status tab's 30-day card), from the `spend` catalog.
 *
 * The shared components fill `{amount}`, `{tokens}`, `{pct}`, `{count}` and `{days}`
 * themselves, so each placeholder is handed through LITERALLY — formatting a message
 * with none of its values throws FORMATTING_ERROR in next-intl.
 */
export function useSpendLabels(): Partial<SpendLabels> {
  const t = useTranslations('spend');
  return useMemo<Partial<SpendLabels>>(() => ({
    spent: t('spent', { amount: '{amount}' }),
    saved: t('saved', { amount: '{amount}' }),
    savedApprox: t('savedApprox', { amount: '{amount}' }),
    tokens: t('tokens', { tokens: '{tokens}' }),
    pillTitle: t('pillTitle'),
    spendHeading: t('spendHeading'),
    platform: t('platform'),
    yourKey: t('yourKey'),
    yourKeyHint: t('yourKeyHint'),
    unpriced: t('unpriced', { tokens: '{tokens}' }),
    savedHeading: t('savedHeading'),
    savedShare: t('savedShare', { pct: '{pct}' }),
    estimated: t('estimated'),
    measured: t('measured'),
    events: t('events', { count: '{count}' }),
    nothingSaved: t('nothingSaved'),
    periodHeading: t('periodHeading', { days: '{days}' }),
    sources: Object.fromEntries(SOURCES.map((k) => [k, t(`sources.${k}`)])) as SpendLabels['sources'],
    sourceHints: Object.fromEntries(SOURCES.map((k) => [k, t(`sourceHints.${k}`)])) as SpendLabels['sourceHints'],
  }), [t]);
}
