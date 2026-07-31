/**
 * THE locale resolver. Every send path goes through this — there is deliberately
 * no per-call-site "if the user has a locale, else header, else en" conditional,
 * because five copies of that chain is five chances to order it differently and
 * mail a user in the wrong language depending on which template they hit.
 *
 * The chain, in priority order:
 *
 *   1. `users.locale` — an EXPLICIT stored choice (captured at signup, editable
 *      in /settings?sub=email). Beats everything: the user told us.
 *   2. The request's own hints — NEXT_LOCALE cookie, then Accept-Language. Only
 *      reachable when nothing is stored, which is why 0351 stores NULL rather
 *      than defaulting to 'en': a DEFAULT would have made step 2 dead code for
 *      every pre-existing account.
 *   3. 'en'.
 *
 * Step 1's lookup is cached (read-through, invalidated by `rememberUserLocale`),
 * because a bulk send resolves a locale per recipient and that is precisely the
 * read-heavy shape the canonical cache exists for. Steps 2 and 3 are pure.
 *
 * Cron/scheduled senders have no request at all — they simply omit `headers` and
 * get steps 1 and 3, which is correct: a digest goes out in the recipient's
 * stored language or English, never in whatever language the *cron trigger* was.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { users } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  DEFAULT_EMAIL_LOCALE,
  LOCALE_HEADER,
  localeFromHeaders,
  normalizeLocale,
  type EmailLocale,
} from '../../infrastructure/email/emailLocale';
import { normalizeEmailKey } from './emailPreferences';

/** Header hints a request carries. All optional — a cron has none. */
export interface LocaleHeaderHints {
  /** `X-Builderforce-Locale` — the app's explicit statement of the active locale. */
  explicit?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}

export interface ResolveEmailLocaleOptions {
  /** The recipient address. Used for the stored-locale lookup when known. */
  email?: string | null;
  /**
   * An already-loaded `users.locale`. Pass this when the caller has the user row
   * in hand (most auth routes do) to skip the lookup entirely — same answer, one
   * fewer round trip. Note `undefined` means "not loaded, go look" while `null`
   * means "loaded, and it is unset".
   */
  stored?: string | null;
  headers?: LocaleHeaderHints;
}

/** Cache key for one address's stored locale. Exported so writers invalidate the
 *  SAME key — one format, no drift. */
export function userLocaleCacheKey(email: string): string {
  return `user-locale:${normalizeEmailKey(email)}`;
}

/**
 * Resolve the locale a message to `email` should be written in. Never throws and
 * never returns null — the worst case is `DEFAULT_EMAIL_LOCALE`, so a send is
 * never blocked on locale resolution.
 */
export async function resolveEmailLocale(
  env: Env,
  db: Db,
  opts: ResolveEmailLocaleOptions,
): Promise<EmailLocale> {
  // 1a. Caller already had the row — no lookup needed.
  if (opts.stored !== undefined) {
    const explicit = normalizeLocale(opts.stored);
    if (explicit) return explicit;
  } else if (opts.email) {
    // 1b. Look it up (cached). A failure here degrades to the header hints rather
    //     than failing the send — locale is never worth losing a magic link over.
    const stored = await lookupStoredLocale(env, db, opts.email).catch(() => null);
    if (stored) return stored;
  }

  // 2. What the request itself is asking for.
  if (opts.headers) {
    const fromRequest = localeFromHeaders(opts.headers);
    if (fromRequest) return fromRequest;
  }

  // 3.
  return DEFAULT_EMAIL_LOCALE;
}

async function lookupStoredLocale(env: Env, db: Db, email: string): Promise<EmailLocale | null> {
  const key = normalizeEmailKey(email);
  // Cache the RAW stored value (including the "" miss marker) rather than the
  // narrowed locale, so the cached entry stays truthful if the supported set grows.
  const raw = await getOrSetCached(env, userLocaleCacheKey(key), async () => {
    const [row] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.email, key))
      .limit(1);
    // getOrSetCached treats a null KV value as a miss, so an absent/unset locale is
    // cached as '' — otherwise every send for a user who never picked a language
    // would re-query on every single message.
    return row?.locale ?? '';
  });
  return normalizeLocale(raw);
}

/**
 * Persist the locale a request expressed onto the user row, if it is worth
 * storing. Called from the signup paths so an account is created already knowing
 * its language — the gap this closes is precisely that there was nowhere to
 * capture it.
 *
 * Deliberately NON-destructive: it only ever fills an EMPTY `users.locale`. A user
 * who explicitly picked a language in Settings must not have that choice
 * overwritten just because they later signed in from a browser set to something
 * else. Returns the locale that ended up stored, or null when nothing was written.
 */
export async function rememberUserLocale(
  env: Env,
  db: Db,
  userId: string,
  headers: LocaleHeaderHints,
): Promise<EmailLocale | null> {
  const locale = localeFromHeaders(headers);
  if (!locale) return null;

  const [row] = await db
    .update(users)
    .set({ locale, updatedAt: sql`now()` })
    .where(sql`${users.id} = ${userId} AND (${users.locale} IS NULL OR ${users.locale} = '')`)
    .returning({ email: users.email });

  if (row) await invalidateCached(env, userLocaleCacheKey(row.email));
  return row ? locale : null;
}

/**
 * Set the locale from an explicit user action (the Settings surface). Unlike
 * `rememberUserLocale` this OVERWRITES — an explicit choice is the whole point.
 */
export async function setUserLocale(
  env: Env,
  db: Db,
  userId: string,
  locale: EmailLocale,
): Promise<void> {
  const [row] = await db
    .update(users)
    .set({ locale, updatedAt: sql`now()` })
    .where(eq(users.id, userId))
    .returning({ email: users.email });
  if (row) await invalidateCached(env, userLocaleCacheKey(row.email));
}

/** Pull the header hints out of anything request-shaped (Hono context, Request). */
export function headerHints(req: { header(name: string): string | undefined }): LocaleHeaderHints {
  return {
    explicit:       req.header(LOCALE_HEADER) ?? null,
    cookie:         req.header('cookie') ?? null,
    acceptLanguage: req.header('accept-language') ?? null,
  };
}
