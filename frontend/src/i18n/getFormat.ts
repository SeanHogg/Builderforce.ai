import { getLocale } from 'next-intl/server';

import { isLocale, DEFAULT_LOCALE } from './config';
import { formatterFor, type Formatter } from './format';

/**
 * The active locale's date/number formatter, for SERVER components and route
 * handlers — the `getTranslations()` counterpart to `useFormat()`.
 *
 * Kept in its own module rather than exported alongside the hook because
 * `next-intl/server` is server-only: importing it from a `'use client'` module
 * is a build error, so the two binders cannot share a file. Both resolve to the
 * same cached `Formatter` from `format.ts`.
 *
 * @example
 *   const fmt = await getFormat();
 *   return <p>{fmt.dateLong(post.publishedAt)}</p>;
 */
export async function getFormat(): Promise<Formatter> {
  const locale = await getLocale();
  return formatterFor(isLocale(locale) ? locale : DEFAULT_LOCALE);
}
