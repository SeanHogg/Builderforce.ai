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

/**
 * Header carrying the active locale to the API.
 *
 * The API is a DIFFERENT ORIGIN (api.builderforce.ai): `NEXT_LOCALE` is set
 * without a domain attribute so it is never sent there, and `Accept-Language`
 * reflects the OS rather than the language the user picked here. Without this
 * header the server can only ever guess — which is why every transactional email
 * was English. `apiClient` stamps it on every request; the API reads it in
 * `infrastructure/email/emailLocale.ts` (LOCALE_HEADER).
 */
export const LOCALE_HEADER = 'X-Builderforce-Locale';

/**
 * The active locale as written in the cookie, or null on the server / before the
 * cookie exists. Client-only by nature (reads `document.cookie`) — the ONE reader,
 * shared by LocaleProvider and apiClient so the parsing lives in a single place.
 */
export function readLocaleCookie(): Locale | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`));
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  return isLocale(value) ? value : null;
}
