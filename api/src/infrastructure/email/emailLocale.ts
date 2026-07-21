/**
 * Locale primitives for server-rendered email — PURE (no DB, no env, no Hono).
 *
 * The supported set is deliberately the SAME five locales the frontend serves via
 * next-intl (`frontend/src/i18n/config.ts`). If the two ever diverge, a user picks
 * a UI language we cannot write an email in, so treat this list and that one as a
 * single decision expressed twice — never widen one alone.
 *
 * Everything here narrows an arbitrary BCP-47 tag down to that set. The narrowing
 * is by BASE LANGUAGE, so `en-GB`, `zh-Hans-CN` and `de-AT` all resolve rather
 * than falling through to English — a region we do not translate for is still a
 * language we do.
 *
 * The DB/cache-backed resolver that actually decides a recipient's locale lives in
 * `application/email/emailLocaleResolver.ts`; it composes these functions. Keep the
 * pure half here so templates and tests can use it without a database.
 */

/** The locales email can be rendered in. Mirrors the frontend's next-intl LOCALES. */
export const EMAIL_LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/** Used whenever nothing better is known. Mirrors the frontend's DEFAULT_LOCALE. */
export const DEFAULT_EMAIL_LOCALE: EmailLocale = 'en';

/** The cookie the frontend writes when a user picks a language (LanguageSwitcher). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/**
 * Header the frontend's `apiClient` stamps with the active locale.
 *
 * This exists because the API is a DIFFERENT ORIGIN from the app
 * (api.builderforce.ai vs builderforce.ai): the NEXT_LOCALE cookie is set without
 * a domain attribute, so it is never sent here, and a browser's Accept-Language
 * reflects the OS setting rather than the language the user actually picked in the
 * UI. Without this header the server can see the *default* language but never the
 * *chosen* one — which is precisely the case that matters.
 *
 * The cookie is still read (`LOCALE_COOKIE`) for same-origin callers and for the
 * `/gateway/*` route that runs this worker on the apex.
 */
export const LOCALE_HEADER = 'x-builderforce-locale';

export function isEmailLocale(value: unknown): value is EmailLocale {
  return typeof value === 'string' && (EMAIL_LOCALES as readonly string[]).includes(value);
}

/**
 * Narrow an arbitrary language tag to a supported locale, or null when it is not
 * one we can write. Case-insensitive and region-tolerant: `EN`, `en-GB` and
 * `zh-Hans-CN` all resolve. Returns null (not 'en') so callers can distinguish
 * "unsupported" from "explicitly English" and keep looking down the chain.
 */
export function normalizeLocale(raw: string | null | undefined): EmailLocale | null {
  if (!raw) return null;
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return isEmailLocale(base) ? base : null;
}

/**
 * Read the locale a REQUEST is expressing, most-explicit signal first:
 *
 *   1. `X-Builderforce-Locale` — the app telling us what the user actually picked.
 *   2. The NEXT_LOCALE cookie — the same choice, when the caller is same-origin.
 *   3. `Accept-Language` — the browser/OS default. A hint, not a choice.
 *
 * Takes a plain header-bag rather than a Hono context or a `Request` so cron jobs,
 * tests and route handlers can all call it the same way.
 */
export function localeFromHeaders(headers: {
  explicit?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): EmailLocale | null {
  return normalizeLocale(headers.explicit)
    ?? localeFromCookieHeader(headers.cookie)
    ?? parseAcceptLanguage(headers.acceptLanguage);
}

/** Pull NEXT_LOCALE out of a raw `Cookie:` header value. */
function localeFromCookieHeader(cookie: string | null | undefined): EmailLocale | null {
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== LOCALE_COOKIE) continue;
    return normalizeLocale(decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return null;
}

/**
 * Best supported locale from an `Accept-Language` header, honouring q-weights
 * (RFC 9110 §12.5.4) so `de;q=0.2, zh;q=0.9` picks Chinese rather than the first
 * token. Entries with `q=0` are an explicit REFUSAL and are dropped.
 */
export function parseAcceptLanguage(header: string | null | undefined): EmailLocale | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p))
        .find((m) => m !== null)?.[1];
      return { locale: normalizeLocale(tag), q: q === undefined ? 1 : Number.parseFloat(q) };
    })
    .filter((e): e is { locale: EmailLocale; q: number } =>
      e.locale !== null && Number.isFinite(e.q) && e.q > 0)
    .sort((a, b) => b.q - a.q);

  return ranked[0]?.locale ?? null;
}
