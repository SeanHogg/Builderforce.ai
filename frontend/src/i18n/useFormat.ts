'use client';

import { useLocale } from 'next-intl';
import { useMemo } from 'react';

import { isLocale, DEFAULT_LOCALE } from './config';
import { formatterFor, type Formatter } from './format';

/**
 * The active locale's date/number formatter, for client components.
 *
 * This is the client half of the seam described in `format.ts`: it reads the
 * locale next-intl already resolved for the tree and hands back the shared,
 * cached `Formatter`. There is nothing to configure at the call site, which is
 * the point — every `toLocaleDateString()` that took no locale argument was a
 * call site deciding, silently and wrongly, that the OS language wins over the
 * one the user picked.
 *
 * @example
 *   const fmt = useFormat();
 *   <td>{fmt.dateTime(row.createdAt)}</td>
 *   <td>{fmt.number(row.tokens)}</td>
 */
export function useFormat(): Formatter {
  const locale = useLocale();
  return useMemo(
    () => formatterFor(isLocale(locale) ? locale : DEFAULT_LOCALE),
    [locale],
  );
}
