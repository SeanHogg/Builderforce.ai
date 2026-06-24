/**
 * i18n configuration — single source of truth for supported locales.
 *
 * Routing model: COOKIE / preference based (no `/[locale]/` URL segment). The
 * active locale is stored in the `NEXT_LOCALE` cookie, detected from
 * `Accept-Language` on first app visit (middleware) and changed explicitly via
 * the LanguageSwitcher. This keeps the existing flat `app/` tree and middleware
 * untouched — the localization audience is international users of the
 * authenticated product, not marketing SEO.
 *
 * Performance: only the ACTIVE locale's catalog is ever sent to the client (see
 * layout.tsx / request.ts). Catalogs are static JSON imported at build time —
 * zero runtime DB/network cost.
 */
export const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie that pins the active locale. Read in request.ts + middleware. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Endonyms (each language named in its own script) for the switcher UI. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
