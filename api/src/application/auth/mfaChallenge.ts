/**
 * MFA enrolment + challenge — the ONE implementation behind both the self-service
 * (`/api/auth/mfa/*`) and admin-on-behalf (`/api/admin/security/users/:id/mfa/*`)
 * routes. Each pair of handlers carried byte-identical TOTP/recovery-code logic and
 * differed only in how the target user was named (and the authenticator issuer label).
 *
 * Hono-free: takes a `Db` + env, returns a tagged result the route maps to HTTP.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { userMfaRecoveryCodes, users } from '../../infrastructure/database/schema';
import {
  buildOtpAuthUrl,
  decryptSecretFromStorage,
  encryptSecretForStorage,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotpCode,
} from '../../infrastructure/auth/MfaService';
import { credentialSecret } from '../integrations/credentialCrypto';

export const MFA_SETUP_TTL_SECONDS = 600;
const RECOVERY_CODE_COUNT = 10;

type UserRow = typeof users.$inferSelect;

/** Verify a TOTP code or consume a one-shot recovery code for an MFA-enabled user. */
export async function verifyMfaChallenge(
  db: Db,
  env: Env,
  user: Pick<UserRow, 'id' | 'mfaEnabled' | 'mfaSecretEnc'>,
  code?: string | null,
  recoveryCode?: string | null,
): Promise<boolean> {
  if (!user.mfaEnabled || !user.mfaSecretEnc) return false;

  if (code) {
    // M2: read under the dedicated credential secret, JWT_SECRET as legacy fallback
    // (versioned dual-read) so pre-migration MFA rows still decrypt.
    const secret = await decryptSecretFromStorage(user.mfaSecretEnc, credentialSecret(env), { legacySecret: env.JWT_SECRET });
    if (await verifyTotpCode(secret, code)) return true;
  }

  if (recoveryCode) {
    const hash = await hashRecoveryCode(normalizeRecoveryCode(recoveryCode));
    const [stored] = await db
      .select({ id: userMfaRecoveryCodes.id })
      .from(userMfaRecoveryCodes)
      .where(and(
        eq(userMfaRecoveryCodes.userId, user.id),
        eq(userMfaRecoveryCodes.codeHash, hash),
        isNull(userMfaRecoveryCodes.usedAt),
      ))
      .limit(1);

    if (stored) {
      await db.update(userMfaRecoveryCodes).set({ usedAt: sql`now()` }).where(eq(userMfaRecoveryCodes.id, stored.id));
      return true;
    }
  }

  return false;
}

export async function replaceRecoveryCodes(db: Db, userId: string, codes: string[]): Promise<void> {
  await db.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
  const hashed = await Promise.all(codes.map(async (code) => ({ userId, codeHash: await hashRecoveryCode(code) })));
  await db.insert(userMfaRecoveryCodes).values(hashed);
}

export type MfaSetupResult =
  | { ok: true; otpauthUrl: string; manualEntryKey: string; expiresIn: number }
  | { ok: false; status: 404 | 409; error: string };

/** Start enrolment: stash a sealed temp secret for 10 minutes and hand back the QR payload. */
export async function beginMfaSetup(db: Db, env: Env, userId: string, issuer: string): Promise<MfaSetupResult> {
  const [user] = await db
    .select({ id: users.id, email: users.email, mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (user.mfaEnabled) return { ok: false, status: 409, error: 'MFA is already enabled' };

  const secret = generateTotpSecret();
  const encrypted = await encryptSecretForStorage(secret, credentialSecret(env), { upgrade: true });
  await db
    .update(users)
    .set({
      mfaTempSecretEnc: encrypted,
      mfaTempExpiresAt: new Date(Date.now() + MFA_SETUP_TTL_SECONDS * 1000),
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, user.id));

  return {
    ok: true,
    otpauthUrl: buildOtpAuthUrl({ accountName: user.email, secret, issuer }),
    manualEntryKey: secret,
    expiresIn: MFA_SETUP_TTL_SECONDS,
  };
}

export type MfaEnableResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; status: 400 | 401 | 404 | 409; error: string };

/** Finish enrolment: verify the first code against the temp secret, then switch MFA on. */
export async function confirmMfaEnable(db: Db, env: Env, userId: string, code: string): Promise<MfaEnableResult> {
  const [user] = await db
    .select({
      id: users.id,
      mfaEnabled: users.mfaEnabled,
      mfaTempSecretEnc: users.mfaTempSecretEnc,
      mfaTempExpiresAt: users.mfaTempExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (user.mfaEnabled) return { ok: false, status: 409, error: 'MFA is already enabled' };
  if (!user.mfaTempSecretEnc || !user.mfaTempExpiresAt || user.mfaTempExpiresAt <= new Date()) {
    return { ok: false, status: 400, error: 'MFA setup session expired. Start setup again.' };
  }

  const secret = await decryptSecretFromStorage(user.mfaTempSecretEnc, credentialSecret(env), { legacySecret: env.JWT_SECRET });
  if (!(await verifyTotpCode(secret, code))) return { ok: false, status: 401, error: 'Invalid MFA code' };

  const encryptedSecret = await encryptSecretForStorage(secret, credentialSecret(env), { upgrade: true });
  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await replaceRecoveryCodes(db, user.id, recoveryCodes);
  await db
    .update(users)
    .set({
      mfaEnabled: true,
      mfaSecretEnc: encryptedSecret,
      mfaEnabledAt: sql`now()`,
      mfaTempSecretEnc: null,
      mfaTempExpiresAt: null,
      mfaRecoveryGeneratedAt: sql`now()`,
      mfaLastVerifiedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, user.id));

  return { ok: true, recoveryCodes };
}

export type MfaChallengeResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 401 | 404; error: string };

/** Turn MFA off after a valid challenge. Already-off is a successful no-op. */
export async function disableMfa(
  db: Db, env: Env, userId: string, code?: string | null, recoveryCode?: string | null,
): Promise<MfaChallengeResult<{ enabled: false }>> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (!user.mfaEnabled) return { ok: true, value: { enabled: false } };
  if (!(await verifyMfaChallenge(db, env, user, code, recoveryCode))) return { ok: false, status: 401, error: 'Invalid MFA code' };

  await db.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, user.id));
  await db
    .update(users)
    .set({
      mfaEnabled: false,
      mfaSecretEnc: null,
      mfaTempSecretEnc: null,
      mfaTempExpiresAt: null,
      mfaEnabledAt: null,
      mfaRecoveryGeneratedAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, user.id));
  return { ok: true, value: { enabled: false } };
}

/** Replace the recovery codes after a valid challenge. */
export async function regenerateRecoveryCodes(
  db: Db, env: Env, userId: string, code?: string | null, recoveryCode?: string | null,
): Promise<MfaChallengeResult<{ recoveryCodes: string[] }>> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (!user.mfaEnabled) return { ok: false, status: 400, error: 'MFA is not enabled' };
  if (!(await verifyMfaChallenge(db, env, user, code, recoveryCode))) return { ok: false, status: 401, error: 'Invalid MFA code' };

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await replaceRecoveryCodes(db, user.id, recoveryCodes);
  await db.update(users).set({ mfaRecoveryGeneratedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(users.id, user.id));
  return { ok: true, value: { recoveryCodes } };
}
