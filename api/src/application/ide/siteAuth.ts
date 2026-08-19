/**
 * End users of a GENERATED app — sign-in for the thing a tenant built.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * A published site could accept a form post and nothing else. `siteData.ts` is
 * public-WRITE / no-public-READ by design and that design is right, but it meant
 * the only app shape reachable end to end was a brochure with a signup form. No
 * identity, no read path, no "my account" — so every generated app that needed a
 * user could not be finished here. This is the layer Base44 ships as its whole
 * proposition and Lovable reaches Supabase for.
 *
 * ── A SEPARATE IDENTITY SPACE, DELIBERATELY ─────────────────────────────────
 * `site_users` are NOT `users`. A person signing into someone's recipe app has
 * no Builderforce account, no tenant membership and no platform permissions.
 * Conflating them would make every generated app a door into the platform's own
 * identity, and the blast radius of one badly-generated app would be the
 * platform. A site user's entire reach is: their own rows, in one site.
 *
 * ── PASSWORDLESS BY CONSTRUCTION ────────────────────────────────────────────
 * There is no password column and no password hash anywhere in this feature. A
 * generated app is authored by a language model, and a badly-stored password is
 * the one mistake that cannot be walked back for the person who trusted it.
 * Sign-in is a six-digit code sent to the address; the app never holds a reusable
 * secret, and this table never holds anything a leak could replay.
 *
 * Only HASHES are stored. `codeHash` lives while a code is outstanding and is
 * CLEARED on redemption, so an unredeemed request cannot be replayed into a
 * session, and a live session row carries no credential at all.
 */

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { siteUsers, siteUserSessions } from '../../infrastructure/database/schema';
import { fireEventTriggers } from '../workflow/eventTriggers';
import type { Env } from '../../env';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { isSendableEmail, normalizeEmail } from '../shared/dnsVerification';

/** How long a one-time code is good for. Long enough to switch to an inbox. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/** How long a redeemed session lasts before the user signs in again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Wrong-code attempts before the request is dead and a new code is needed. */
export const MAX_CODE_ATTEMPTS = 5;

/** The cookie a signed-in end user's browser carries on the SITE's own origin. */
export const SITE_SESSION_COOKIE = 'bf_site_session';

/** SHA-256 hex. The only form a secret is ever persisted in. */
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A six-digit code, from the CSPRNG.
 *
 * Six digits is one-in-a-million per guess and is bounded further by
 * {@link MAX_CODE_ATTEMPTS} and a ten-minute life — the two controls that
 * actually decide the security of a code this short. `% 1_000_000` over a 32-bit
 * draw has negligible modulo bias at this size.
 */
function newCode(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String(buffer[0]! % 1_000_000).padStart(6, '0');
}

/** An opaque 256-bit session token. Never stored, only its hash. */
function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type RequestSignInResult =
  | { ok: true; email: string; code: string; expiresAt: Date }
  | { ok: false; status: 400; error: string };

/**
 * Start a sign-in: find or create the end user, mint a code, and return it for
 * DELIVERY BY THE CALLER.
 *
 * The code is returned rather than sent from here on purpose — this module owns
 * identity, not transport, and the site route decides whether that means the
 * tenant's connected mailbox or the platform sender. It is never returned to the
 * browser.
 */
export async function requestSiteSignIn(
  db: Db,
  siteId: number,
  tenantId: number,
  rawEmail: unknown,
  /** Worker env, when the caller has one — lets a genuinely NEW site user fire the
   *  workspace's `signup` workflow triggers. Omitting it skips that fan-out. */
  env?: Env,
): Promise<RequestSignInResult> {
  const email = normalizeEmail(String(rawEmail ?? ''));
  if (!email || !isSendableEmail(email)) {
    return { ok: false, status: 400, error: 'Enter a valid email address.' };
  }

  const [user] = await db
    .insert(siteUsers)
    .values({ siteId, tenantId, email })
    .onConflictDoUpdate({
      target: [siteUsers.siteId, siteUsers.email],
      set: { updatedAt: sql`NOW()` },
    })
    // `xmax = 0` is Postgres' canonical "this row was INSERTED, not updated" answer
    // for an upsert. Without it a returning-row from `onConflictDoUpdate` cannot tell
    // a first-ever visitor from someone signing in for the hundredth time — and
    // "signup" must mean the former, or every sign-in would fire it.
    .returning({ id: siteUsers.id, status: siteUsers.status, isNew: sql<boolean>`(xmax = 0)` });
  if (!user) return { ok: false, status: 400, error: 'Could not start sign-in.' };
  if (user.status !== 'active') {
    // Deliberately the same shape of answer as success would be at the route, so
    // a blocked address cannot be distinguished from an unknown one by probing.
    return { ok: false, status: 400, error: 'Could not start sign-in.' };
  }

  if (user.isNew) {
    await fireEventTriggers(db, {
      tenantId, env,
      eventType: 'signup',
      payload: { siteId, siteUserId: user.id, email },
    }).catch(() => undefined);
  }

  const code = newCode();
  const token = newSessionToken();
  const now = Date.now();
  await db.insert(siteUserSessions).values({
    siteUserId: user.id,
    siteId,
    tenantId,
    tokenHash: await hash(token),
    codeHash: await hash(`${email}:${code}`),
    codeExpiresAt: new Date(now + CODE_TTL_MS),
    expiresAt: new Date(now + SESSION_TTL_MS),
  });

  return { ok: true, email, code, expiresAt: new Date(now + CODE_TTL_MS) };
}

export type VerifyResult =
  | { ok: true; token: string; userId: number; email: string; expiresAt: Date }
  | { ok: false; status: 400 | 429; error: string };

/**
 * Redeem a code for a session token.
 *
 * The outstanding request is found by its code hash, which is salted with the
 * address — so a code minted for one address can never redeem for another even
 * if two are outstanding at the same moment.
 */
export async function verifySiteSignIn(
  db: Db,
  siteId: number,
  tenantId: number,
  rawEmail: unknown,
  rawCode: unknown,
): Promise<VerifyResult> {
  const email = normalizeEmail(String(rawEmail ?? ''));
  const code = String(rawCode ?? '').trim();
  if (!email || !/^\d{6}$/.test(code)) return { ok: false, status: 400, error: 'Enter the 6-digit code.' };

  const [user] = await db
    .select({ id: siteUsers.id, status: siteUsers.status })
    .from(siteUsers)
    .where(scopedToTenant(siteUsers, tenantId, eq(siteUsers.siteId, siteId), eq(siteUsers.email, email)))
    .limit(1);
  if (!user || user.status !== 'active') return { ok: false, status: 400, error: 'That code is not valid.' };

  const codeHash = await hash(`${email}:${code}`);
  const [pending] = await db
    .select({ id: siteUserSessions.id, attempts: siteUserSessions.attempts, expiresAt: siteUserSessions.expiresAt })
    .from(siteUserSessions)
    .where(scopedToTenant(
      siteUserSessions,
      tenantId,
      eq(siteUserSessions.siteUserId, user.id),
      eq(siteUserSessions.codeHash, codeHash),
      isNull(siteUserSessions.redeemedAt),
      gt(siteUserSessions.codeExpiresAt, new Date()),
    ))
    .limit(1);

  if (!pending) {
    // Burn an attempt against every outstanding request for this user, so a
    // wrong guess costs the attacker their budget rather than nothing.
    await db
      .update(siteUserSessions)
      .set({ attempts: sql`${siteUserSessions.attempts} + 1` })
      .where(scopedToTenant(siteUserSessions, tenantId, eq(siteUserSessions.siteUserId, user.id), isNull(siteUserSessions.redeemedAt)));
    return { ok: false, status: 400, error: 'That code is not valid.' };
  }
  if (pending.attempts >= MAX_CODE_ATTEMPTS) {
    return { ok: false, status: 429, error: 'Too many attempts. Request a new code.' };
  }

  // A fresh token at redemption: the token minted alongside the code was never
  // handed out, so issuing the same one would tie the live session's secret to a
  // row that existed while the code was still guessable.
  const token = newSessionToken();
  await db
    .update(siteUserSessions)
    .set({
      tokenHash: await hash(token),
      // Clearing the code is what makes a redemption single-use.
      codeHash: null,
      codeExpiresAt: null,
      redeemedAt: sql`NOW()`,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .where(scopedToTenant(siteUserSessions, tenantId, eq(siteUserSessions.id, pending.id)));
  await db.update(siteUsers).set({ lastSeenAt: sql`NOW()` }).where(scopedToTenant(siteUsers, tenantId, eq(siteUsers.id, user.id)));

  return { ok: true, token, userId: user.id, email, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
}

export interface SiteUserIdentity {
  userId: number;
  email: string;
  displayName: string | null;
}

/**
 * Resolve a session token to the end user, or null.
 *
 * Requires `redeemedAt` to be set: an unredeemed row is a sign-in REQUEST, and
 * treating one as a session would let a token that was minted beside a code —
 * and never delivered — act as though the code had been entered.
 */
export async function resolveSiteUser(db: Db, siteId: number, tenantId: number, token: string | null | undefined): Promise<SiteUserIdentity | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const [row] = await db
    .select({ userId: siteUsers.id, email: siteUsers.email, displayName: siteUsers.displayName, status: siteUsers.status })
    .from(siteUserSessions)
    .innerJoin(siteUsers, eq(siteUsers.id, siteUserSessions.siteUserId))
    .where(scopedToTenant(
      siteUserSessions,
      tenantId,
      eq(siteUserSessions.siteId, siteId),
      eq(siteUserSessions.tokenHash, await hash(token)),
      gt(siteUserSessions.expiresAt, new Date()),
    ))
    .limit(1);
  if (!row || row.status !== 'active') return null;
  return { userId: row.userId, email: row.email, displayName: row.displayName };
}

/** End a session. Idempotent: an unknown token is already signed out. */
export async function signOutSiteUser(db: Db, siteId: number, tenantId: number, token: string | null | undefined): Promise<void> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return;
  await db
    .delete(siteUserSessions)
    .where(scopedToTenant(siteUserSessions, tenantId, eq(siteUserSessions.siteId, siteId), eq(siteUserSessions.tokenHash, await hash(token))));
}

/** Read the session token out of the site's own cookie header. */
export function siteSessionCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SITE_SESSION_COOKIE) return rest.join('=') || null;
  }
  return null;
}

/**
 * The `Set-Cookie` for a session. `HttpOnly` so the generated app's own
 * JavaScript — which a model wrote — can never read it, `SameSite=Lax` so a
 * cross-site form post cannot act as the user, and `Secure` because every
 * published site is HTTPS.
 */
export function siteSessionCookieHeader(token: string | null, maxAgeSeconds: number): string {
  const value = token ?? '';
  return `${SITE_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? maxAgeSeconds : 0}`;
}
