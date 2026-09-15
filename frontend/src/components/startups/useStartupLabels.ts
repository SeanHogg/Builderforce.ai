'use client';

/**
 * The startup vocabulary, in the reader's language — ONE hook.
 *
 * The values are the contract package's (`FUNDING_STAGES`, `STARTUP_SECTORS`, …);
 * the words are the catalog's (`startups.vocab.*`). Every surface that prints a
 * stage — the directory card, the filter chip, the founder's form, the CFO's
 * runway view — reads this hook, so "Pre-Seed" is spelled once per locale and a
 * value the catalog does not know falls back to the raw key rather than to an
 * English string somebody typed inline.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

type Labeller = (value: string | null | undefined) => string;

export interface StartupLabels {
  stage: Labeller;
  businessStage: Labeller;
  sector: Labeller;
  seeking: Labeller;
  investmentType: Labeller;
  timeframe: Labeller;
  expertise: Labeller;
  sort: Labeller;
  health: Labeller;
  inquiryStatus: Labeller;
}

export function useStartupLabels(): StartupLabels {
  const t = useTranslations('startups.vocab');
  return useMemo(() => {
    const of = (group: string): Labeller => (value) => {
      if (!value) return '';
      const key = `${group}.${value}`;
      return t.has(key) ? t(key) : value;
    };
    return {
      stage: of('stage'),
      businessStage: of('businessStage'),
      sector: of('sector'),
      seeking: of('seeking'),
      investmentType: of('investmentType'),
      timeframe: of('timeframe'),
      expertise: of('expertise'),
      sort: of('sort'),
      health: of('health'),
      inquiryStatus: of('inquiryStatus'),
    };
  }, [t]);
}
