import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale } from './config';

/**
 * Per-request locale + message resolution for next-intl (App Router, no i18n
 * routing). Reads the active locale from the `NEXT_LOCALE` cookie and loads
 * ONLY that locale's catalog. The dynamic import is statically analysable by
 * the bundler, so each locale JSON is a separate chunk and only the active one
 * is shipped.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get('NEXT_LOCALE')?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
