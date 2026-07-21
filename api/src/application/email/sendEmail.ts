/**
 * The two send seams. EVERY email in the product goes through exactly one of them,
 * and which one you pick IS the declaration of what kind of mail it is:
 *
 *   sendTransactionalEmail — the recipient triggered it (welcome, magic link,
 *     verification code, invite, admin reset, ops alert, a digest they subscribed
 *     to). No consent check, no unsubscribe link: CAN-SPAM exempts these, and an
 *     opt-out on a password reset would lock people out of their own accounts.
 *
 *   sendLifecycleEmail — WE decided to send it (tips drip, "what's new",
 *     re-engagement, anything promotional). Consent-checked against
 *     `email_preferences` and handed a working unsubscribe URL that it MUST render.
 *     Returns 'suppressed' when consent is absent so the caller can count it.
 *
 * Both resolve the recipient's locale through the single shared resolver, so
 * neither a template nor a call site ever decides a language for itself.
 *
 * The callback receives a context rather than positional args so adding something
 * (a preheader, a brand) later does not churn every send site. `unsubscribeUrl` is
 * `string` for lifecycle and `undefined` for transactional — the type is what stops
 * a transactional template from rendering an unsubscribe link it must not have.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { EmailLocale } from '../../infrastructure/email/emailLocale';
import { signState, verifyState } from '../../infrastructure/auth/oauthState';
import {
  canSendLifecycleEmail,
  normalizeEmailKey,
  type LifecycleCategory,
} from './emailPreferences';
import {
  resolveEmailLocale,
  type LocaleHeaderHints,
} from './emailLocaleResolver';

/** What a template is handed once the locale (and consent) are settled. */
export interface TransactionalSendContext {
  locale: EmailLocale;
  /** Always undefined — a transactional mail must not offer an opt-out. */
  unsubscribeUrl?: undefined;
}

export interface LifecycleSendContext {
  locale: EmailLocale;
  /** Always present. The template is required to render it. */
  unsubscribeUrl: string;
}

export interface SendOptions {
  /** Request hints for locale resolution. Omit for cron/scheduled senders. */
  headers?: LocaleHeaderHints;
  /** An already-loaded `users.locale`, to skip the lookup. */
  storedLocale?: string | null;
}

/**
 * Send a mail the recipient asked for. Resolves locale, then calls `send`. No
 * consent check by design — see the module docblock.
 */
export async function sendTransactionalEmail(
  env: Env,
  db: Db,
  to: string,
  send: (ctx: TransactionalSendContext) => Promise<void>,
  opts?: SendOptions,
): Promise<void> {
  const locale = await resolveEmailLocale(env, db, {
    email: to,
    stored: opts?.storedLocale,
    headers: opts?.headers,
  });
  await send({ locale });
}

/**
 * Send a mail WE initiated. Checks consent first and returns 'suppressed' without
 * sending when the recipient has opted out of this category (or globally). When it
 * does send, the template gets a signed unsubscribe URL it is obliged to render.
 */
export async function sendLifecycleEmail(
  env: Env,
  db: Db,
  to: string,
  category: LifecycleCategory,
  send: (ctx: LifecycleSendContext) => Promise<void>,
  opts?: SendOptions,
): Promise<'sent' | 'suppressed'> {
  if (!(await canSendLifecycleEmail(env, db, to, category))) return 'suppressed';

  const [locale, unsubscribeUrl] = await Promise.all([
    resolveEmailLocale(env, db, { email: to, stored: opts?.storedLocale, headers: opts?.headers }),
    buildUnsubscribeUrl(env, to),
  ]);

  await send({ locale, unsubscribeUrl });
  return 'sent';
}

// ---------------------------------------------------------------------------
// Unsubscribe links
// ---------------------------------------------------------------------------

/**
 * How long a footer unsubscribe link stays valid. Long by design: someone can
 * unsubscribe from a two-year-old email sitting in their archive, and CAN-SPAM
 * requires the mechanism to keep working for at least 30 days after the send.
 * A link that has expired would be a compliance failure, not a security win.
 */
const UNSUBSCRIBE_TOKEN_MAX_AGE_MS = 5 * 365 * 24 * 60 * 60 * 1000;

/**
 * A tamper-proof unsubscribe token. Reuses the shared HMAC state primitives rather
 * than minting a second crypto scheme — same signing key handling, one place to
 * audit. The address is IN the token, so the endpoint needs no session (a person
 * clicking unsubscribe is usually not logged in) and cannot be used to opt out an
 * address the sender did not actually mail.
 */
export async function signUnsubscribeToken(secret: string, email: string): Promise<string> {
  return signState(secret, { email: normalizeEmailKey(email), purpose: 'unsubscribe' });
}

/** Verify a token and recover the address, or null when it is bad/expired. */
export async function verifyUnsubscribeToken(secret: string, token: string): Promise<string | null> {
  const payload = await verifyState<{ email?: string; purpose?: string }>(
    secret,
    token,
    UNSUBSCRIBE_TOKEN_MAX_AGE_MS,
  );
  // The purpose check stops a token minted for another flow (e.g. OAuth state)
  // from being replayed here to opt someone out.
  if (!payload || payload.purpose !== 'unsubscribe' || !payload.email) return null;
  return normalizeEmailKey(payload.email);
}

/**
 * The URL a lifecycle footer links to. Points at the API origin, not the app: the
 * endpoint must work with no session and no JavaScript so that one click actually
 * unsubscribes, which is what CAN-SPAM requires. Routing it through the app would
 * make the opt-out depend on the SPA booting.
 */
export async function buildUnsubscribeUrl(env: Env, email: string): Promise<string> {
  const token = await signUnsubscribeToken(env.JWT_SECRET, email);
  const apiOrigin = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';
  return `${apiOrigin.replace(/\/$/, '')}/api/email-preferences/unsubscribe?token=${encodeURIComponent(token)}`;
}
