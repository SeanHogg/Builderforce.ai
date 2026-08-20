/**
 * Passkeys — registration and authentication as USE CASES.
 *
 * The byte formats and the WebCrypto calls live in
 * `infrastructure/auth/webauthn.ts`. What lives here is everything that is a
 * decision rather than a parse: what a challenge means, how long it is good for,
 * what makes an assertion acceptable, and what a sign-count regression is worth.
 *
 * ── THE THREE THINGS THAT MAKE THIS SAFE ────────────────────────────────────
 * 1. **The challenge is consumed exactly once.** `webauthn_challenges` (migration
 *    0428) is a table and not a cache entry precisely so consumption can be a
 *    conditional UPDATE. A replayed challenge is an authentication bypass, so the
 *    claim "this challenge was unused" must be settled by the database, not by a
 *    read followed by a write.
 * 2. **The origin is checked against OUR origin.** This is the property that makes
 *    a passkey unphishable, and it only holds if the server actually enforces it.
 *    `clientDataJSON.origin` must equal the app's own origin and the authenticator
 *    data's RP-ID hash must equal `SHA-256(rpId)`.
 * 3. **User presence is required.** An assertion produced without the human
 *    touching the authenticator is refused.
 *
 * ── THE SIGN COUNTER, AND WHY IT IS NOT A GATE ──────────────────────────────
 * The spec offers `signCount` as clone detection: a counter that goes backwards
 * suggests two copies of a credential in the wild. In practice every synced
 * passkey — which is most of them — reports 0 forever, so a strict check would
 * refuse nothing real and lock out people whose authenticator simply does not
 * count. The honest handling is to RECORD a regression against the credential and
 * surface it, so an administrator can revoke on evidence, and to let the sign-in
 * proceed. That decision is stated here rather than buried, because "we checked
 * the counter" and "we refuse on the counter" are very different claims.
 */

import { and, eq, isNull, gt, lt } from 'drizzle-orm';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { users, webauthnCredentials } from '../../infrastructure/database/schema';
import { webauthnChallenges } from '../../infrastructure/database/schema/governance';
import {
  SUPPORTED_COSE_ALGORITHMS,
  base64UrlToBytes,
  bytesEqual,
  bytesToBase64Url,
  coseAlgorithmOf,
  parseAttestationObject,
  parseAuthenticatorData,
  parseClientData,
  rpIdFromOrigin,
  rpIdHash,
  verifyWebAuthnSignature,
} from '../../infrastructure/auth/webauthn';
import { randomUrlToken } from '../../infrastructure/auth/jws';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { issueWebSession, type IssuedWebSession } from './webSessionStore';
import type { Db } from '../../infrastructure/database/connection';

const SOURCE = 'application/auth/PasskeyService.ts';

/** How long a challenge is good for. Long enough to find a security key in a bag. */
const CHALLENGE_TTL_SECONDS = 300;

/** Beyond this a person is managing a keyring, not signing in. */
export const MAX_PASSKEYS_PER_USER = 20;

export type PasskeyPurpose = 'registration' | 'authentication';

export class PasskeyError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = 'PasskeyError';
  }
}

export interface PasskeyRelyingParty {
  /** The registrable domain a credential is scoped to. */
  id: string;
  name: string;
  /** The exact origin `clientDataJSON.origin` must equal. */
  origin: string;
}

export interface StoredPasskey {
  id: number;
  name: string;
  credentialId: string;
  aaguid: string | null;
  transports: string[];
  backedUp: boolean;
  signCountRegressed: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Resolve the relying party from the app's own base URL. One source, no guessing. */
export function relyingPartyFor(appBaseUrl: string, name = 'Builderforce'): PasskeyRelyingParty {
  const origin = appBaseUrl.replace(/\/$/, '');
  return { id: rpIdFromOrigin(origin), name, origin };
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

async function mintChallenge(
  db: Db,
  purpose: PasskeyPurpose,
  rp: PasskeyRelyingParty,
  opts: { userId?: string | null; tenantId?: number | null; ipAddress?: string | null } = {},
): Promise<string> {
  const challenge = randomUrlToken(32);
  await db.insert(webauthnChallenges).values({
    challenge,
    purpose,
    rpId: rp.id,
    userRef: opts.userId ?? null,
    tenantId: opts.tenantId ?? null,
    ipAddress: opts.ipAddress ?? null,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
  });
  return challenge;
}

/**
 * Claim a challenge. The UPDATE is the check: `consumed_at IS NULL` in the WHERE
 * clause means two concurrent requests carrying the same challenge cannot both
 * win, whatever the isolation level. A returned row is proof of first use.
 */
async function consumeChallenge(
  db: Db,
  challenge: string,
  purpose: PasskeyPurpose,
): Promise<{ userRef: string | null; rpId: string | null }> {
  // Declared cross-tenant: the challenge value is itself the credential, unique
  // platform-wide, and an AUTHENTICATION challenge is minted before there is a
  // user — let alone a workspace — to scope it to. Filtering by tenant here would
  // mean knowing who is signing in before they have proved it.
  const [claimed] = await db
    .update(webauthnChallenges)
    .set({ consumedAt: new Date() })
    .where(acrossTenants(
      webauthnChallenges,
      'global_uniqueness',
      eq(webauthnChallenges.challenge, challenge),
      eq(webauthnChallenges.purpose, purpose),
      isNull(webauthnChallenges.consumedAt),
      gt(webauthnChallenges.expiresAt, new Date()),
    ))
    .returning({ userRef: webauthnChallenges.userRef, rpId: webauthnChallenges.rpId });

  if (!claimed) {
    throw new PasskeyError('That sign-in attempt has expired or was already used. Start again.', 401);
  }
  return claimed;
}

/**
 * Drop challenges that are past their expiry. Consumed rows are kept for a while
 * as evidence — a burst of consumed-then-failed challenges is a signal — but an
 * unclaimed expired row is only clutter.
 */
export async function purgeExpiredPasskeyChallenges(db: Db, olderThan = new Date()): Promise<number> {
  const removed = await db
    .delete(webauthnChallenges)
    .where(acrossTenants(webauthnChallenges, 'scheduled_sweep', lt(webauthnChallenges.expiresAt, olderThan)))
    .returning({ id: webauthnChallenges.id });
  return removed.length;
}

// ---------------------------------------------------------------------------
// Shared verification — the part registration and authentication have in common
// ---------------------------------------------------------------------------

interface CommonVerification {
  authenticatorData: Uint8Array;
  clientDataJson: Uint8Array;
}

/**
 * Everything both flows must check: the challenge matches what the browser was
 * given, the ceremony type is the expected one, the origin is ours, the RP-ID hash
 * matches, and the human was present.
 */
async function verifyCeremony(
  input: CommonVerification,
  expected: { challenge: string; type: 'webauthn.create' | 'webauthn.get'; rp: PasskeyRelyingParty },
): Promise<ReturnType<typeof parseAuthenticatorData>> {
  const clientData = parseClientData(input.clientDataJson);

  if (clientData.type !== expected.type) {
    throw new PasskeyError('This credential was produced for a different kind of request.', 400);
  }
  if (clientData.challenge !== expected.challenge) {
    throw new PasskeyError('This credential answers a different challenge.', 401);
  }
  if (clientData.origin !== expected.rp.origin) {
    // The unphishable property, enforced. A credential minted for this app cannot
    // be asserted from anywhere else, and this line is why.
    throw new PasskeyError('This credential was produced for a different site.', 401);
  }

  const authData = parseAuthenticatorData(input.authenticatorData);
  const expectedRpHash = await rpIdHash(expected.rp.id);
  if (!bytesEqual(authData.rpIdHash, expectedRpHash)) {
    throw new PasskeyError('This credential belongs to a different site.', 401);
  }
  if (!authData.userPresent) {
    throw new PasskeyError('The authenticator did not confirm you were present.', 401);
  }
  return authData;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation: 'none';
  excludeCredentials: { type: 'public-key'; id: string }[];
  authenticatorSelection: { residentKey: 'preferred'; userVerification: 'preferred' };
}

export async function beginPasskeyRegistration(
  db: Db,
  rp: PasskeyRelyingParty,
  user: { id: string; email: string; username: string | null; displayName: string | null },
  opts: { tenantId?: number | null; ipAddress?: string | null } = {},
): Promise<RegistrationOptions> {
  const existing = await db
    .select({ credentialId: webauthnCredentials.credentialId })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, user.id));

  if (existing.length >= MAX_PASSKEYS_PER_USER) {
    throw new PasskeyError(`You already have ${MAX_PASSKEYS_PER_USER} passkeys. Remove one before adding another.`, 409);
  }

  const challenge = await mintChallenge(db, 'registration', rp, {
    userId: user.id,
    tenantId: opts.tenantId ?? null,
    ipAddress: opts.ipAddress ?? null,
  });

  return {
    challenge,
    rp: { id: rp.id, name: rp.name },
    // The user handle is the account id: an opaque, stable value the authenticator
    // stores so a discoverable credential can name the account without a username.
    user: {
      id: bytesToBase64Url(new TextEncoder().encode(user.id)),
      name: user.email,
      displayName: user.displayName ?? user.username ?? user.email,
    },
    pubKeyCredParams: SUPPORTED_COSE_ALGORITHMS.map((alg) => ({ type: 'public-key' as const, alg })),
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    // See webauthn.ts: attestation statements carry no trust signal we could act
    // on without an FIDO metadata service, so we ask for none rather than
    // collecting one we would not check.
    attestation: 'none',
    // Stops the browser silently enrolling the same authenticator twice.
    excludeCredentials: existing.map((row) => ({ type: 'public-key' as const, id: row.credentialId })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  };
}

export interface RegistrationResponse {
  id: string;
  rawId: string;
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
  name?: string;
}

export async function finishPasskeyRegistration(
  db: Db,
  rp: PasskeyRelyingParty,
  userId: string,
  body: RegistrationResponse,
): Promise<StoredPasskey> {
  const clientDataJson = base64UrlToBytes(body.response.clientDataJSON);
  const attestation = parseAttestationObject(base64UrlToBytes(body.response.attestationObject));

  const clientData = parseClientData(clientDataJson);
  const claimed = await consumeChallenge(db, clientData.challenge, 'registration');
  if (claimed.userRef && claimed.userRef !== userId) {
    throw new PasskeyError('That enrolment belongs to a different account.', 403);
  }

  const authData = await verifyCeremony(
    { authenticatorData: attestation.rawAuthenticatorData, clientDataJson },
    { challenge: clientData.challenge, type: 'webauthn.create', rp },
  );

  if (!authData.credentialId || !authData.credentialPublicKey) {
    throw new PasskeyError('The authenticator did not return a credential.', 400);
  }

  const algorithm = coseAlgorithmOf(authData.credentialPublicKey);
  if (!SUPPORTED_COSE_ALGORITHMS.includes(algorithm as (typeof SUPPORTED_COSE_ALGORITHMS)[number])) {
    throw new PasskeyError('That authenticator uses a signature algorithm this site does not accept.', 400);
  }

  const credentialId = bytesToBase64Url(authData.credentialId);
  const [existing] = await db
    .select({ userId: webauthnCredentials.userId })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, credentialId))
    .limit(1);
  if (existing) {
    throw new PasskeyError(
      existing.userId === userId
        ? 'That passkey is already registered on this account.'
        : 'That passkey is already registered to another account.',
      409,
    );
  }

  const [row] = await db
    .insert(webauthnCredentials)
    .values({
      userId,
      credentialId,
      publicKey: bytesToBase64Url(authData.credentialPublicKey),
      algorithm,
      signCount: authData.signCount,
      aaguid: authData.aaguid,
      transports: (body.response.transports ?? []).join(',').slice(0, 120) || null,
      backupEligible: authData.backupEligible,
      backedUp: authData.backedUp,
      name: (body.name ?? '').trim().slice(0, 120) || 'Passkey',
    })
    .returning();

  if (!row) throw new PasskeyError('The passkey could not be saved.', 400);
  return toStoredPasskey(row);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export interface AuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: 'preferred';
  allowCredentials: { type: 'public-key'; id: string }[];
}

/**
 * `email` is optional on purpose. Without it the browser offers whatever
 * discoverable credential it holds for this site — the usernameless flow — and
 * `allowCredentials` stays empty. With it we narrow to that account's credentials.
 *
 * A missing or unknown email deliberately still returns a well-formed challenge
 * with an empty allow-list rather than a 404: answering "no such account" here
 * would turn the sign-in form into an account-existence oracle.
 */
export async function beginPasskeyAuthentication(
  db: Db,
  rp: PasskeyRelyingParty,
  opts: { email?: string | null; ipAddress?: string | null } = {},
): Promise<AuthenticationOptions> {
  let allow: { credentialId: string }[] = [];

  const email = opts.email?.trim().toLowerCase();
  if (email) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (user) {
      allow = await db
        .select({ credentialId: webauthnCredentials.credentialId })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, user.id));
    }
  }

  const challenge = await mintChallenge(db, 'authentication', rp, { ipAddress: opts.ipAddress ?? null });

  return {
    challenge,
    rpId: rp.id,
    timeout: CHALLENGE_TTL_SECONDS * 1000,
    userVerification: 'preferred',
    allowCredentials: allow.map((row) => ({ type: 'public-key' as const, id: row.credentialId })),
  };
}

export interface AuthenticationResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
}

export interface PasskeyAssertion {
  userId: string;
  credentialId: string;
  /** True when the authenticator itself verified the user (PIN, biometric). */
  userVerified: boolean;
  /** True when the counter went backwards. Recorded, never a refusal — see header. */
  signCountRegressed: boolean;
}

export async function verifyPasskeyAssertion(
  db: Db,
  rp: PasskeyRelyingParty,
  body: AuthenticationResponse,
): Promise<PasskeyAssertion> {
  const clientDataJson = base64UrlToBytes(body.response.clientDataJSON);
  const authenticatorData = base64UrlToBytes(body.response.authenticatorData);
  const clientData = parseClientData(clientDataJson);

  await consumeChallenge(db, clientData.challenge, 'authentication');

  const authData = await verifyCeremony(
    { authenticatorData, clientDataJson },
    { challenge: clientData.challenge, type: 'webauthn.get', rp },
  );

  const credentialId = body.rawId || body.id;
  const [credential] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, credentialId))
    .limit(1);

  if (!credential) throw new PasskeyError('That passkey is not registered here.', 401);

  // A discoverable credential also names the account. When it does, the two must
  // agree — a mismatch means the assertion and the stored credential disagree
  // about whose it is, which is never a benign state.
  const handle = body.response.userHandle;
  if (handle) {
    const claimedUserId = new TextDecoder().decode(base64UrlToBytes(handle));
    if (claimedUserId !== credential.userId) {
      throw new PasskeyError('That passkey does not match the account it names.', 401);
    }
  }

  const valid = await verifyWebAuthnSignature({
    coseKey: base64UrlToBytes(credential.publicKey),
    signature: base64UrlToBytes(body.response.signature),
    authenticatorData,
    clientDataJson,
  });
  if (!valid) throw new PasskeyError('That passkey signature did not verify.', 401);

  // Counter of 0 on both sides is the normal synced-passkey case, not a regression.
  const regressed = authData.signCount > 0 && authData.signCount <= credential.signCount;

  await db
    .update(webauthnCredentials)
    .set({
      signCount: Math.max(authData.signCount, credential.signCount),
      backedUp: authData.backedUp,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
      ...(regressed ? { lastSignCountRegressedAt: new Date() } : {}),
    })
    .where(eq(webauthnCredentials.id, credential.id));

  if (regressed) {
    // Not a refusal, but it must not be silent — an administrator revokes on this.
    reportCaughtError(new Error('WebAuthn sign counter regressed'), {
      source: SOURCE,
      operation: 'verifyPasskeyAssertion.signCount',
      context: { credentialId, stored: credential.signCount, presented: authData.signCount },
    });
  }

  return {
    userId: credential.userId,
    credentialId,
    userVerified: authData.userVerified,
    signCountRegressed: regressed,
  };
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

function toStoredPasskey(row: typeof webauthnCredentials.$inferSelect): StoredPasskey {
  return {
    id: row.id,
    name: row.name,
    credentialId: row.credentialId,
    aaguid: row.aaguid,
    transports: row.transports ? row.transports.split(',').filter(Boolean) : [],
    backedUp: row.backedUp,
    signCountRegressed: row.lastSignCountRegressedAt != null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPasskeys(db: Db, userId: string): Promise<StoredPasskey[]> {
  const rows = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, userId));
  return rows.map(toStoredPasskey);
}

export async function renamePasskey(db: Db, userId: string, id: number, name: string): Promise<StoredPasskey> {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) throw new PasskeyError('A passkey needs a name.', 400);
  const [row] = await db
    .update(webauthnCredentials)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, userId)))
    .returning();
  if (!row) throw new PasskeyError('That passkey is not on this account.', 404);
  return toStoredPasskey(row);
}

/**
 * Remove a passkey. Deliberately no "last credential" guard: this platform always
 * has a password or an OAuth identity behind the account, so removing the final
 * passkey cannot lock anybody out — and refusing here would strand a person whose
 * device is lost, which is exactly when they most need to remove it.
 */
export async function deletePasskey(db: Db, userId: string, id: number): Promise<void> {
  const removed = await db
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, userId)))
    .returning({ id: webauthnCredentials.id });
  if (!removed.length) throw new PasskeyError('That passkey is not on this account.', 404);
}

// ---------------------------------------------------------------------------
// Sign-in — the whole use case, so the route stays a translator
// ---------------------------------------------------------------------------

const SUPERADMIN_EMAIL = 'seanhogg@gmail.com';

/**
 * Verify an assertion and, if it stands up, hand back a session.
 *
 * This lives here rather than in the route because it is a sequence of DECISIONS
 * — is this account still allowed to sign in, does a single-factor assertion
 * satisfy an MFA-enabled account, what does the resulting session claim — and a
 * route that made them would be reading the users table to do it.
 *
 * ── WHY A PASSKEY SKIPS TOTP, AND WHEN IT DOES NOT ──────────────────────────
 * A user-VERIFIED assertion is already multi-factor: possession of the
 * authenticator, plus the PIN or biometric that unlocked it — and unlike TOTP it
 * is phishing-resistant, so treating it as weaker than a code the user could read
 * aloud to an attacker would be backwards.
 *
 * A bare touch on a key with no PIN is a single factor, and an MFA-enabled account
 * still owes the second step. Rather than growing a second MFA challenge here, it
 * is refused with a sentence pointing at the password flow that already implements
 * one. One MFA implementation on the platform.
 */
export async function signInWithPasskey(
  db: Db,
  jwtSecret: string,
  rp: PasskeyRelyingParty,
  body: AuthenticationResponse,
  session: { sessionName?: string | null; userAgent?: string | null; ipAddress?: string | null },
): Promise<IssuedWebSession> {
  const assertion = await verifyPasskeyAssertion(db, rp, body);

  const [row] = await db.select().from(users).where(eq(users.id, assertion.userId)).limit(1);
  if (!row) throw new PasskeyError('That passkey belongs to an account that no longer exists.', 401);
  if (row.isSuspended) throw new PasskeyError('Account suspended. Contact support.', 403);

  if (row.mfaEnabled && !assertion.userVerified) {
    throw new PasskeyError(
      'This account requires a second factor and your authenticator did not verify you. Sign in with your password to complete the second step.',
      401,
    );
  }

  return issueWebSession(
    db,
    jwtSecret,
    {
      id: row.id,
      email: row.email,
      username: row.username ?? '',
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      accountType: row.accountType ?? 'standard',
      accountTypeSelected: !!row.accountTypeSelectedAt,
      availableForHire: row.availableForHire ?? false,
      isSuperadmin: row.isSuperadmin && row.email.trim().toLowerCase() === SUPERADMIN_EMAIL,
      mfaEnabled: row.mfaEnabled,
    },
    {
      amr: assertion.userVerified ? ['webauthn', 'uv'] : ['webauthn'],
      mfa: row.mfaEnabled && assertion.userVerified,
    },
    { sessionName: session.sessionName ?? 'Passkey', userAgent: session.userAgent, ipAddress: session.ipAddress },
  );
}

/** Resolve the account and mint enrolment options. Keeps the users read off the route. */
export async function beginPasskeyRegistrationForUser(
  db: Db,
  rp: PasskeyRelyingParty,
  userId: string,
  opts: { tenantId?: number | null; ipAddress?: string | null } = {},
): Promise<RegistrationOptions> {
  const [user] = await db
    .select({ id: users.id, email: users.email, username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new PasskeyError('Account not found.', 404);
  return beginPasskeyRegistration(db, rp, user, opts);
}
