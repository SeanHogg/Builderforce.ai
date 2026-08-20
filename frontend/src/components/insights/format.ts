'use client';

import { useMemo } from 'react';

import { type Formatter, EMPTY_VALUE } from '@/i18n/format';
import { useFormat } from '@/i18n/useFormat';

/**
 * Shared value formatting for the insight lenses (DRY — used by every lens).
 *
 * ── WHY THESE ARE BOUND RATHER THAN IMPORTED ────────────────────────────────
 * Three of these — `usd`, `int`, `compactTokens` — group digits, and grouping is
 * a LOCALE decision (`1,234.5` / `1.234,5` / `1 234,5`). They used to call
 * `toLocaleString()` with no locale, which formats in the browser's language
 * rather than the one the reader picked, so every lens in the product showed
 * English-grouped numbers inside a Chinese or German UI.
 *
 * Binding them to the active locale means they can no longer be free functions.
 * They are handed out by `useInsightFormat()` instead — a hook, so it resolves
 * the locale once per component, and a destructure, so **not one of the ~220
 * call sites had to change**:
 *
 *   const { usd, int } = useInsightFormat();
 *   <StatCard value={usd(row.spend)} />        // unchanged
 *
 * `pct`, `hrs`, `days` and `score2` are locale-INDEPENDENT (fixed decimals and
 * an ASCII unit), so they stay plain exports and callers may keep importing them
 * directly. They are re-exposed on the hook only so a component that needs a mix
 * can take one destructure instead of one import and one destructure.
 */

export const pct = (n: number | null | undefined): string =>
  n == null ? EMPTY_VALUE : `${n.toFixed(0)}%`;

export const hrs = (n: number | null | undefined): string =>
  n == null ? EMPTY_VALUE : `${n.toFixed(1)}h`;

export const days = (n: number | null | undefined): string =>
  n == null ? EMPTY_VALUE : `${n.toFixed(1)}d`;

export const score2 = (n: number | null | undefined): string =>
  n == null ? EMPTY_VALUE : n.toFixed(2);

export interface InsightFormatters {
  /** Money, no trailing `.00` on a whole amount. */
  usd(n: number | null | undefined): string;
  /** Whole number, locale-grouped. */
  int(n: number | null | undefined): string;
  /** Compact token/unit count: 1_240_000 → "1.2M", 12_400 → "12.4K". */
  compactTokens(n: number | null | undefined): string;
  pct(n: number | null | undefined): string;
  hrs(n: number | null | undefined): string;
  days(n: number | null | undefined): string;
  score2(n: number | null | undefined): string;
}

/**
 * The lens formatters bound to one locale. Pure — takes the `Formatter` rather
 * than reaching for a hook — so tests and any future server lens can use it.
 */
export function insightFormatters(fmt: Formatter): InsightFormatters {
  return {
    usd: (n) => (n == null ? EMPTY_VALUE : fmt.money(n)),
    int: (n) => (n == null ? EMPTY_VALUE : fmt.number(Math.round(n))),
    compactTokens: (n) => {
      if (n == null) return EMPTY_VALUE;
      const abs = Math.abs(n);
      // The compact branches are deliberately NOT locale-formatted: "1.2M" is a
      // fixed one-decimal token, and running it through a grouping formatter
      // would turn it into "1,2M" in de for no gain in legibility.
      if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return fmt.number(Math.round(n));
    },
    pct,
    hrs,
    days,
    score2,
  };
}

/** The lens formatters bound to the ACTIVE locale. One resolve per component. */
export function useInsightFormat(): InsightFormatters {
  const fmt = useFormat();
  return useMemo(() => insightFormatters(fmt), [fmt]);
}
