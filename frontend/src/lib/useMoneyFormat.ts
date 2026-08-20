'use client';

import { useMemo } from 'react';

import { useFormat } from '@/i18n/useFormat';
import { formatCents, formatMoney, formatMoneyField } from './canvasMoney';

/**
 * The money formatters of `canvasMoney`, pre-bound to the ACTIVE locale.
 *
 * ── WHY A HOOK RATHER THAN A DEFAULT ────────────────────────────────────────
 * `formatCents` and `formatMoney` already had the right seam: both take a
 * `locale` option. The defect was that almost nobody passed it — 25 of 42 call
 * sites omitted it, leaving `Intl.NumberFormat(undefined)`, which resolves to the
 * BROWSER's locale rather than the one the reader chose. Grouping and symbol
 * placement then followed the machine (`1,250.00 $` vs `1.250,00 $`) instead of
 * the UI language.
 *
 * Giving the parameter a hardcoded default would only move the wrong answer into
 * the library. Instead the locale is bound once per component and the functions
 * keep their names and signatures, so **no call site changed**:
 *
 *   const { formatCents } = useMoneyFormat();
 *   <span>{formatCents(row.priceCents, { currency: row.currency })}</span>
 *
 * The pure functions remain exported from `canvasMoney` for non-React callers
 * (tests, tools, server code) — they simply have to name a locale, which is the
 * honest requirement for a pure function that formats.
 */
export interface MoneyFormatters {
  formatCents: typeof formatCents;
  formatMoney: typeof formatMoney;
  formatMoneyField: typeof formatMoneyField;
}

export function useMoneyFormat(): MoneyFormatters {
  const { locale } = useFormat();
  return useMemo<MoneyFormatters>(() => ({
    formatCents: (cents, options) => formatCents(cents, { locale, ...options }),
    formatMoney: (value, options) => formatMoney(value, { locale, ...options }),
    formatMoneyField: (input, options) => formatMoneyField(input, { locale, ...options }),
  }), [locale]);
}
