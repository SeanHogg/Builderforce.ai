'use client';

import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import enMessages from '@/i18n/messages/en.json';
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
 * hydration by reading the NEXT_LOCALE cookie and lazy-loading that catalog.
 * Only the active non-default catalog is ever fetched. English users see no
 * swap; other users get their language right after hydration.
 */

const CATALOG_LOADERS: Record<Locale, () => Promise<Record<string, unknown>>> = {
  en: async () => enMessages as Record<string, unknown>,
  zh: () => import('@/i18n/messages/zh.json').then((m) => m.default),
  es: () => import('@/i18n/messages/es.json').then((m) => m.default),
  fr: () => import('@/i18n/messages/fr.json').then((m) => m.default),
  de: () => import('@/i18n/messages/de.json').then((m) => m.default),
};

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Start in the default locale so SSR + first client render match (no hydration
  // mismatch); swap to the cookie locale after mount.
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Record<string, unknown>>(enMessages as Record<string, unknown>);

  useEffect(() => {
    const target = readLocaleCookie() ?? DEFAULT_LOCALE;
    if (target === DEFAULT_LOCALE) return;
    let cancelled = false;
    CATALOG_LOADERS[target]()
      .then((m) => {
        if (cancelled) return;
        setMessages(m);
        setLocale(target);
        document.documentElement.lang = target;
      })
      .catch(() => { /* keep default locale on load failure */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} onError={ignoreEnvironmentFallback}>
      {children}
    </NextIntlClientProvider>
  );
}
