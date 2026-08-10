/**
 * Email-ownership verification (OTP) for password signups.
 *
 * Flow: on register (and when an unverified account tries to log in) a 6-digit code
 * is emailed and its SHA-256 hash stored. The user enters the code to activate the
 * account and obtain a session. Codes are single-use, short-lived, attempt-capped,
 * and superseded whenever a newer code is issued — the raw code is never persisted.
 *
 * Shared by /web/register, /web/register/verify, /web/register/resend and the
 * /web/login unverified-account gate so the issue/verify rules never drift.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { emailOtpChallenges } from '../../infrastructure/database/schema';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { sendVerificationCodeEmail } from '../../infrastructure/email/EmailService';
import { sendTransactionalEmail } from '../email/sendEmail';
import type { LocaleHeaderHints } from '../email/emailLocaleResolver';
import type { Env } from '../../env';

/**
 * The `email_otp_challenges.purpose` this service owns.
 *
 * The table is the ONE one-time email code store (PRD 20 §0) — it absorbed
 * `email_verification_codes`, which was the same shape at 0.62 column overlap.
 * Every read here is scoped by this purpose so a newsletter double opt-in can
 * never satisfy an account-activation check, which is the one risk consolidating
 * them introduced and the one line that removes it.
 */
const SIGNUP_VERIFICATION = 'signup_verification';

const CODE_TTL_MS = 15 * 60 * 1000; // matches the "expires in 15 minutes" email copy
const RESEND_COOLDOWN_MS = 60 * 1000;

/** Cryptographically-random zero-padded 6-digit code. */
export function generateVerificationCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return n.toString().padStart(6, '0');
}

type VerificationUser = {
  id: string;
  email: string;
  displayName?: string | null;
  username?: string | null;
  /** `users.locale` when the caller already loaded it — lets the shared resolver
   *  skip its lookup. `undefined` means "not loaded", `null` means "unset". */
  locale?: string | null;
};

export type IssueResult = { sent: boolean; cooldownSeconds?: number; deliveryFailed?: boolean };

/**
 * Issue a fresh code: supersede any outstanding one, store the new hash, email it.
 * Rate-limited by RESEND_COOLDOWN_MS unless `force` (the initial register issue).
 * Returns `{ sent: false, cooldownSeconds }` when throttled so callers can surface
 * a "try again in Ns" hint.
 */
export async function issueVerificationCode(
  db: Db,
  env: Env,
  user: VerificationUser,
  opts: { force?: boolean; anonId?: string | null; headers?: LocaleHeaderHints } = {},
): Promise<IssueResult> {
  if (!opts.force) {
    const [recent] = await db
      .select({ createdAt: emailOtpChallenges.createdAt })
      .from(emailOtpChallenges)
      .where(and(
        eq(emailOtpChallenges.userRef, user.id),
        eq(emailOtpChallenges.purpose, SIGNUP_VERIFICATION),
        isNull(emailOtpChallenges.consumedAt),
      ))
      .orderBy(desc(emailOtpChallenges.createdAt))
      .limit(1);
    if (recent) {
      const elapsed = Date.now() - recent.createdAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        return { sent: false, cooldownSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000) };
      }
    }
  }

  // Supersede all outstanding codes for this user — only the newest can verify.
  await db
    .update(emailOtpChallenges)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(emailOtpChallenges.userRef, user.id),
      eq(emailOtpChallenges.purpose, SIGNUP_VERIFICATION),
      isNull(emailOtpChallenges.consumedAt),
    ));

  const code = generateVerificationCode();
  const codeHash = await hashSecret(code);
  const [inserted] = await db.insert(emailOtpChallenges).values({
    purpose: SIGNUP_VERIFICATION,
    // maxAttempts defaults to 5 on the column — the cap lives with the row it
    // caps, so a verify path cannot check a different number from the one the
    // issue path promised.
    userRef: user.id,
    email: user.email,
    codeHash,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  }).returning({ id: emailOtpChallenges.id });

  // TRANSACTIONAL — the user just asked for this code; there is nothing to opt out
  // of. Goes through the shared seam purely so the locale is resolved the same way
  // every other send resolves it.
  const delivery = await sendTransactionalEmail(
    env,
    db,
    user.email,
    ({ locale }) => sendVerificationCodeEmail(
      env,
      user.email,
      user.displayName ?? user.username ?? user.email,
      code,
      opts.anonId,
      locale,
    ),
    {
      storedLocale: user.locale,
      headers: opts.headers,
      deliveryType: 'verification_code',
      onDeliveryFailure: 'return',
    },
  );
  if (delivery === 'failed') {
    // Do not make a provider rejection consume the one-minute resend window.
    // Only retire the row created by this attempt; an unrelated newer request is
    // left untouched.
    if (inserted) {
      await db
        .update(emailOtpChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(emailOtpChallenges.id, inserted.id));
    }
    return { sent: false, deliveryFailed: true };
  }
  return { sent: true };
}

export type VerifyResult = 'ok' | 'invalid' | 'expired' | 'too_many' | 'none';

/**
 * Check a submitted code against the user's newest outstanding code. On a wrong
 * code the attempt counter is bumped (locks out at the row's own `maxAttempts`); on success the
 * code is consumed. Never reveals which specific reason to the caller beyond the enum.
 */
export async function verifyVerificationCode(db: Db, userId: string, code: string): Promise<VerifyResult> {
  const [row] = await db
    .select()
    .from(emailOtpChallenges)
    .where(and(
      eq(emailOtpChallenges.userRef, userId),
      eq(emailOtpChallenges.purpose, SIGNUP_VERIFICATION),
      isNull(emailOtpChallenges.consumedAt),
    ))
    .orderBy(desc(emailOtpChallenges.createdAt))
    .limit(1);

  if (!row) return 'none';
  if (row.expiresAt <= new Date()) return 'expired';
  if (row.attempts >= row.maxAttempts) return 'too_many';

  const codeHash = await hashSecret(code.trim());
  if (codeHash !== row.codeHash) {
    await db
      .update(emailOtpChallenges)
      .set({ attempts: row.attempts + 1 })
      .where(eq(emailOtpChallenges.id, row.id));
    return 'invalid';
  }

  await db
    .update(emailOtpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(emailOtpChallenges.id, row.id));
  return 'ok';
}
