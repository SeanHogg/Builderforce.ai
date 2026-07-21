/**
 * Email consent — read, write, and the gate every LIFECYCLE send passes through.
 *
 * The transactional/lifecycle split is the whole point of this module:
 *
 *   TRANSACTIONAL (welcome, magic link, verification code, invites, admin reset,
 *   ops alerts, subscribed digests) — the recipient triggered it. CAN-SPAM
 *   exempts these from opt-out, and offering one would be actively harmful (you
 *   cannot "unsubscribe" from your own password reset). These NEVER consult this
 *   module; they go through `sendTransactionalEmail` in ./sendEmail.
 *
 *   LIFECYCLE (tips drips, "what's new", re-engagement, anything promotional) —
 *   we chose to send it. These MUST pass `canSendLifecycleEmail` and MUST carry a
 *   working unsubscribe link. `sendLifecycleEmail` in ./sendEmail enforces both so
 *   a caller cannot accidentally skip the check.
 *
 * A MISSING preferences row reads as all-allowed, identical to the column
 * defaults — so "never expressed a preference" and "explicitly left everything on"
 * behave the same and no backfill was ever needed.
 *
 * Reads go through the canonical read-through cache: this sits on the send path of
 * every future bulk lifecycle run (one lookup per recipient), which is exactly the
 * read-heavy shape `getOrSetCached` exists for. Every write invalidates the same
 * key, so a user toggling a preference takes effect on the next send rather than
 * after a TTL.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { emailPreferences, users } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';

/**
 * The categories a recipient can opt out of INDIVIDUALLY. Each one maps to a
 * column on `email_preferences` (migration 0352) — the mapping is total by
 * construction below, so a new category cannot be added here without a column,
 * and therefore can never silently default to "allowed".
 */
export const LIFECYCLE_CATEGORIES = ['product_updates', 'onboarding_tips', 'digests'] as const;

export type LifecycleCategory = (typeof LIFECYCLE_CATEGORIES)[number];

export function isLifecycleCategory(value: unknown): value is LifecycleCategory {
  return typeof value === 'string' && (LIFECYCLE_CATEGORIES as readonly string[]).includes(value);
}

/** The consent state for one address, in the shape both the API and the gate use. */
export interface EmailPreferenceState {
  productUpdates: boolean;
  onboardingTips: boolean;
  digests: boolean;
  /** CAN-SPAM global opt-out. Overrides every category above. */
  unsubscribedAll: boolean;
}

/** What a never-seen address gets: everything on, nothing globally opted out. */
export const DEFAULT_EMAIL_PREFERENCES: EmailPreferenceState = {
  productUpdates: true,
  onboardingTips: true,
  digests: true,
  unsubscribedAll: false,
};

/** Addresses are compared lowercased everywhere — the consent key must not be
 *  case-sensitive or `Ada@x.com` could opt out while `ada@x.com` keeps receiving. */
export function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Cache key for one address's consent. Exported so a writer outside this module
 *  invalidates the SAME key — one format, no drift. */
export function emailPreferencesCacheKey(email: string): string {
  return `email-prefs:${normalizeEmailKey(email)}`;
}

/**
 * Consent for an address. Returns the all-allowed default when no row exists, so
 * callers never branch on "row missing" versus "row with defaults".
 */
export async function getEmailPreferences(
  env: Env,
  db: Db,
  email: string,
): Promise<EmailPreferenceState> {
  const key = normalizeEmailKey(email);
  return getOrSetCached(env, emailPreferencesCacheKey(key), async () => {
    const [row] = await db
      .select({
        productUpdates:  emailPreferences.productUpdates,
        onboardingTips:  emailPreferences.onboardingTips,
        digests:         emailPreferences.digests,
        unsubscribedAll: emailPreferences.unsubscribedAll,
      })
      .from(emailPreferences)
      .where(eq(emailPreferences.email, key))
      .limit(1);
    return row ?? DEFAULT_EMAIL_PREFERENCES;
  });
}

/** Map a category to its field on the state. Total over LifecycleCategory, so the
 *  compiler rejects a new category that has nowhere to read from. */
const CATEGORY_FIELD: Record<LifecycleCategory, keyof EmailPreferenceState> = {
  product_updates: 'productUpdates',
  onboarding_tips: 'onboardingTips',
  digests:         'digests',
};

/**
 * The consent gate. `false` means DO NOT SEND. A global unsubscribe wins over any
 * per-category flag — that is what a footer unsubscribe click has to mean.
 *
 * Never call this from a transactional send: a transactional mail is not optional
 * and suppressing one would break account access.
 */
export async function canSendLifecycleEmail(
  env: Env,
  db: Db,
  email: string,
  category: LifecycleCategory,
): Promise<boolean> {
  const prefs = await getEmailPreferences(env, db, email);
  if (prefs.unsubscribedAll) return false;
  return prefs[CATEGORY_FIELD[category]];
}

/**
 * Upsert consent for an address and invalidate the cached copy. `userId` links the
 * row to an account when one is known; it is never the key, so a later account
 * deletion (ON DELETE SET NULL) cannot resurrect consent for the address.
 *
 * `unsubscribedAt` is stamped on the transition into a global opt-out and cleared
 * on the way back out, giving an auditable answer to "when did they unsubscribe".
 */
export async function setEmailPreferences(
  env: Env,
  db: Db,
  email: string,
  patch: Partial<EmailPreferenceState>,
  opts?: { userId?: string | null },
): Promise<EmailPreferenceState> {
  const key = normalizeEmailKey(email);
  const current = await getEmailPreferences(env, db, key);
  const next: EmailPreferenceState = { ...current, ...patch };

  const unsubscribedAt = next.unsubscribedAll
    ? sql`COALESCE(${emailPreferences.unsubscribedAt}, now())`
    : null;

  await db
    .insert(emailPreferences)
    .values({
      email: key,
      userId: opts?.userId ?? null,
      productUpdates: next.productUpdates,
      onboardingTips: next.onboardingTips,
      digests: next.digests,
      unsubscribedAll: next.unsubscribedAll,
      unsubscribedAt: next.unsubscribedAll ? sql`now()` : null,
    })
    .onConflictDoUpdate({
      target: emailPreferences.email,
      set: {
        // Only overwrite the link when we actually know one — an unsubscribe taken
        // from a cold invite must not blank an existing account association.
        ...(opts?.userId ? { userId: opts.userId } : {}),
        productUpdates: next.productUpdates,
        onboardingTips: next.onboardingTips,
        digests: next.digests,
        unsubscribedAll: next.unsubscribedAll,
        unsubscribedAt,
        updatedAt: sql`now()`,
      },
    });

  await invalidateCached(env, emailPreferencesCacheKey(key));
  return next;
}

/**
 * One-click global opt-out — what the footer unsubscribe link does. Deliberately
 * NOT "turn every category off": the global flag is separate so re-enabling a
 * single category later cannot silently undo it.
 */
export async function unsubscribeAll(
  env: Env,
  db: Db,
  email: string,
  opts?: { userId?: string | null },
): Promise<void> {
  await setEmailPreferences(env, db, email, { unsubscribedAll: true }, opts);
}

/** The account a signed-in user's preferences hang off, resolved to their address. */
export async function emailForUser(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}
