import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

// The locales supported by the application.
export const locales = ['en', 'fr'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

// Name of the cookie used to persist the user's chosen locale.
export const LOCALE_COOKIE = 'HIRED_LOCALE';

function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

/**
 * Resolve the active locale for a request.
 *
 * Precedence:
 *   1. Explicit choice persisted in the locale cookie (set via the toggle).
 *   2. The browser `Accept-Language` header on first visit.
 *   3. The default locale (`en`).
 */
export async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) {
    return cookieLocale;
  }

  const acceptLanguage = (await headers()).get('accept-language') ?? '';
  for (const part of acceptLanguage.split(',')) {
    const tag = part.trim().split(';')[0].toLowerCase();
    const base = tag.split('-')[0];
    if (isLocale(base)) {
      return base;
    }
  }

  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
