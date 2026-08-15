'use client';

import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import { defaultMessages, loadCatalog, type Messages } from '@/i18n/catalog';
import { DEFAULT_LOCALE, readLocaleCookie, type Locale } from '@/i18n/config';
import { ignoreEnvironmentFallback } from '@/i18n/onError';

/**
 * Client-side locale provider.
 *
 * The app uses COOKIE-based locale with no `/[locale]/` routing. Reading that
 * cookie on the server (getLocale/getMessages in the root layout) calls
 * `cookies()`, which opts EVERY route out of static generation — turning all
 * marketing/public pages into per-request dynamic renders (an SEO/perf
 * regression) and forcing every route (incl. /_not-found) onto the Edge Runtime
 * for the Cloudflare build.
 *
 * Instead we render statically in the default locale (English) — great for SEO
 * and prerendering — and switch to the user's chosen locale on the client after
 * hydration by reading the NEXT_LOCALE cookie and lazy-loading that catalog
 * through the shared loader in `@/i18n/catalog`. Only the active non-default
 * catalog is ever fetched. English users see no swap; other users get their
 * language right after hydration.
 */

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Start in the default locale so SSR + first client render match (no hydration
  // mismatch); swap to the cookie locale after mount.
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Messages>(defaultMessages);

  useEffect(() => {
    const target = readLocaleCookie() ?? DEFAULT_LOCALE;
    if (target === DEFAULT_LOCALE) return;
    let cancelled = false;
    // `loadCatalog` degrades to the default catalog rather than rejecting, so a
    // failed fetch leaves the page in English instead of throwing at mount.
    void loadCatalog(target).then((loaded) => {
      if (cancelled || loaded === defaultMessages) return;
      setMessages(loaded);
      setLocale(target);
      document.documentElement.lang = target;
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} onError={ignoreEnvironmentFallback}>
      {children}
    </NextIntlClientProvider>
  );
}
