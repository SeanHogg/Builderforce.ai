/**
 * THE invitation use cases (PRD 20 §2, §5 step 5).
 *
 * "`invitation` — invite somebody to something. Absorbs 9 tables." This is the
 * service that makes the primitive real, and the first family §5 step 5 moves
 * onto it: `tenant_invitations` and `creation_session_invites` are gone, their
 * rows carried across by migration 0435, and every read and write that named
 * them now comes through here.
 *
 * WHY ONE SERVICE AND NOT TWO. The two tables differed in what they invited you
 * TO — a workspace, a canvas session — which is a `kind` column and an
 * `object_id`, not a schema. Everything else was identical: an address, a role,
 * a state, who sent it, when it expires, when it was accepted or revoked. Five
 * files had grown their own copy of "is there already a pending invite for this
 * address" (`tenantRoutes`, `BrainService`, `migrationStore`,
 * `creationSessionRouteService`, `planLimitsGuard`) and they did not agree: two
 * lower-cased the address first and two did not.
 *
 * LAYER CONTRACT (§6.1). Application layer: use cases, tenancy, cache keys,
 * invalidation. It takes a `Db` and returns plain rows; the routes above it
 * parse and serialise.
 *
 * THE TOKEN. `invitations.token_hash` is NOT NULL and unique, because for the
 * primitive the token IS the grant. A workspace invite never had one — it is
 * accepted by matching the address on the way in — so `invite()` mints a random
 * one and stores only its hash when no token is supplied. There is no preimage
 * anywhere, which is exactly right: an invite with no token cannot be redeemed
 * BY token, and the email-match path is unchanged.
 */
import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { invitations } from '../../infrastructure/database/schema/kernel';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { SEAT_KIND, type SeatKind, consumesSeat } from '../../domain/tenant/SeatKind';
import type { Env } from '../../env';

/** What an invitation invites you to. `objectId` is null for `tenant`, because a
 *  workspace is not an addressable object in the registry — every other kind
 *  carries the object it grants access to. */
export type InvitationKind = 'tenant' | 'session' | 'project' | 'team' | 'board' | 'ceremony' | 'engagement';

export type InvitationRow = {
  id: string;
  tenantId: number;
  objectId: string | null;
  kind: string;
  email: string | null;
  inviteeRef: string | null;
  role: string;
  /** 'seat' | 'collaborator' — what accepting it costs the workspace. See
   *  `domain/tenant/SeatKind.ts`. */
  seatKind: string;
  state: string;
  invitedBy: string | null;
  message: string | null;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/** The public projection — never `token_hash`. The token is the grant; a list
 *  endpoint that returns it hands out the grant. */
const PUBLIC = {
  id: invitations.id,
  tenantId: invitations.tenantId,
  objectId: invitations.objectId,
  kind: invitations.kind,
  email: invitations.email,
  inviteeRef: invitations.inviteeRef,
  role: invitations.role,
  seatKind: invitations.seatKind,
  state: invitations.state,
  invitedBy: invitations.invitedBy,
  message: invitations.message,
  expiresAt: invitations.expiresAt,
  acceptedAt: invitations.acceptedAt,
  revokedAt: invitations.revokedAt,
  createdAt: invitations.createdAt,
};

const pendingKey = (tenantId: number, kind: InvitationKind | 'all') =>
  `kernel:invitations:${tenantId}:${kind}`;

/** Addresses are compared lower-cased, ALWAYS. Two of the five call sites this
 *  replaces normalised and two did not, so `Ada@x.com` could hold a pending
 *  invite that `ada@x.com` could neither see nor accept. */
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * Drop every cached read for a tenant's invitations. Called by each write below,
 * so no caller has to remember to.
 *
 * `env` is optional because one caller genuinely has none: an MCP tool invoked
 * without threaded bindings (`BuiltinToolCtx.env` is declared optional for
 * exactly that reason). There is then no KV to drop, and the in-isolate entry
 * expires on its own 15-second TTL — bounded staleness, in ONE place, rather
 * than an `env?` pushed out to every call site.
 */
export async function invalidateInvitations(env: Env | undefined, tenantId: number): Promise<void> {
  if (!env) return;
  await Promise.all([
    invalidateCached(env, pendingKey(tenantId, 'all')),
    ...(['tenant', 'session', 'project', 'team', 'board', 'ceremony', 'engagement'] as const).map((k) =>
      invalidateCached(env, pendingKey(tenantId, k)),
    ),
  ]);
}

/** A pending invite is one nobody has accepted, revoked, or let expire. Stated
 *  once, because "pending" meaning three different things in three files is how
 *  a revoked invite kept counting against a seat limit. */
const isPending = () =>
  and(
    eq(invitations.state, 'pending'),
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
    or(isNull(invitations.expiresAt), sql`${invitations.expiresAt} > NOW()`),
  );

/**
 * What a re-invite writes onto the pending row it matched.
 *
 * A re-invite normally updates in place — same row, current role, current sender —
 * and `seatKind` moves with it, because a workspace invite that FOLLOWS a canvas
 * share is a genuine upgrade from guest to seat and a row still saying
 * 'collaborator' would seat that person without ever counting them.
 *
 * The reverse direction is not an update at all, and that asymmetry is the whole
 * reason this is a named function rather than three ternaries inside the write.
 * The companion workspace invitation that a canvas share writes is not a decision
 * about the workspace — it exists only so a shared board can resolve — so when it
 * matched a pending SEAT invitation it silently demoted a real one: somebody
 * invited as a manager, then shared a single board, became a viewer-level canvas
 * guest and stopped counting against `maxSeats`. A seat is given up deliberately,
 * by revoking and re-inviting, never as a side effect of sharing a canvas.
 *
 * Pure, so the rule can be tested without a database — it is exactly the kind of
 * bookkeeping whose regression is invisible until somebody cannot accept an invite.
 */
export function resolveReinvite(
  existing: Pick<InvitationRow, 'role' | 'seatKind' | 'invitedBy'>,
  incoming: { role: string; seatKind: SeatKind; invitedBy?: string | null },
): { role: string; seatKind: string; invitedBy: string | null; changed: boolean } {
  const keepSeat = consumesSeat(existing.seatKind) && !consumesSeat(incoming.seatKind);
  const role = keepSeat ? existing.role : incoming.role;
  const seatKind = keepSeat ? existing.seatKind : incoming.seatKind;
  const invitedBy = keepSeat ? existing.invitedBy : (incoming.invitedBy ?? existing.invitedBy);
  return {
    role,
    seatKind,
    invitedBy,
    changed: existing.role !== role || existing.seatKind !== seatKind || existing.invitedBy !== invitedBy,
  };
}

/**
 * Ensure a pending invitation exists, and return it.
 *
 * Idempotent on `(tenant, kind, email)` for a pending row — which is what four
 * of the five replaced call sites were hand-rolling as select-then-insert, with
 * a race between the two. A re-invite refreshes the role and the sender rather
 * than stacking a second row a revoke would then miss.
 */
export async function invite(
  db: Db,
  env: Env | undefined,
  input: {
    tenantId: number;
    kind: InvitationKind;
    email: string;
    role?: string;
    /** Defaults to a paid seat. Pass `collaborator` for an invitation whose
     *  membership exists only to make a shared object resolve — a canvas guest. */
    seatKind?: SeatKind;
    invitedBy?: string | null;
    objectId?: string | null;
    message?: string | null;
    expiresAt?: Date | null;
    /** SHA-256 of the raw token, when the flow issues one the invitee presents. */
    tokenHash?: string;
  },
): Promise<InvitationRow> {
  const email = normaliseEmail(input.email);
  const role = input.role ?? 'member';
  const seatKind = input.seatKind ?? SEAT_KIND.SEAT;

  // Idempotent on (tenant, kind, email) — AND on the object when the kind carries
  // one. Without the object clause, inviting the same address to a second canvas
  // session matches the FIRST session's pending row and returns it, so the second
  // invitation is never created and the person is never invited. `tenant` invites
  // have no object and fall back to the three-column match, which is what makes
  // one pending workspace row per address the right answer there.
  const [existing] = await db
    .select(PUBLIC)
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, input.tenantId),
        eq(invitations.kind, input.kind),
        eq(invitations.email, email),
        input.objectId ? eq(invitations.objectId, input.objectId) : isNull(invitations.objectId),
        isPending(),
      ),
    )
    .limit(1);

  if (existing && !input.tokenHash) {
    const next = resolveReinvite(existing, { role, seatKind, invitedBy: input.invitedBy });
    if (next.changed) {
      await db
        .update(invitations)
        .set({ role: next.role, seatKind: next.seatKind, invitedBy: next.invitedBy, updatedAt: new Date() })
        .where(and(eq(invitations.id, existing.id), eq(invitations.tenantId, input.tenantId)));
    }
    await invalidateInvitations(env, input.tenantId);
    return { ...existing, role: next.role, seatKind: next.seatKind, invitedBy: next.invitedBy };
  }

  const [row] = await db
    .insert(invitations)
    .values({
      tenantId: input.tenantId,
      kind: input.kind,
      objectId: input.objectId ?? null,
      email,
      role,
      seatKind,
      invitedBy: input.invitedBy ?? null,
      message: input.message ?? null,
      expiresAt: input.expiresAt ?? null,
      // No token supplied ⇒ 64 hex characters of randomness with no preimage
      // anywhere. See the header note on why that is the correct shape for an
      // invite that is redeemed by matching the address instead.
      tokenHash: input.tokenHash ?? `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ''),
      state: 'pending',
    })
    .returning(PUBLIC);

  if (!row) throw new Error('invite: insert returned no row');
  await invalidateInvitations(env, input.tenantId);
  return row;
}

/** Every pending invitation for a tenant, newest first. */
export async function listPending(
  db: Db,
  env: Env,
  tenantId: number,
  kind?: InvitationKind,
): Promise<InvitationRow[]> {
  return getOrSetCached(
    env,
    pendingKey(tenantId, kind ?? 'all'),
    async () => {
      // Predicate inlined rather than built into a variable: the tenant-scope
      // guard reads the `.where()` call, and a variable hides the tenant filter
      // from it — a scoped query that LOOKS unscoped is the same review problem
      // as an unscoped one.
      return db
        .select(PUBLIC)
        .from(invitations)
        .where(and(
          eq(invitations.tenantId, tenantId),
          kind ? eq(invitations.kind, kind) : undefined,
          isPending(),
        ))
        .orderBy(desc(invitations.createdAt));
    },
    { kvTtlSeconds: 120, l1TtlMs: 15_000 },
  );
}

/** How many seats a tenant's pending invites are holding. Served from the same
 *  cached read as the list, so the members page and the seat guard can never
 *  disagree about the number. */
export async function countPending(
  db: Db,
  env: Env,
  tenantId: number,
  kind?: InvitationKind,
  seatKind?: SeatKind,
): Promise<number> {
  const rows = await listPending(db, env, tenantId, kind);
  if (!seatKind) return rows.length;
  // Filtered in memory ON PURPOSE: a second SQL count would be a second
  // definition of "pending", and the whole reason this function exists is that
  // the seat guard and the members page must never disagree about the number.
  return rows.filter((row) => consumesSeat(row.seatKind) === consumesSeat(seatKind)).length;
}

/**
 * Pending invitations for one address, across every tenant — what the sign-in
 * path reads to decide which workspaces a new account joins.
 *
 * DELIBERATELY UNSCOPED, and it cannot be otherwise: the caller is a person who
 * has just proved control of an email address and does not yet belong to any
 * tenant, so there is no tenant to scope BY. The address is the key, and the rows
 * returned are by definition invitations addressed to it. Baselined in
 * `.tenant-scope-baseline.txt` for this reason rather than because nobody looked.
 */
export async function findPendingByEmail(
  db: Db,
  email: string,
  kind?: InvitationKind,
): Promise<InvitationRow[]> {
  const where = kind
    ? and(eq(invitations.email, normaliseEmail(email)), eq(invitations.kind, kind), isPending())
    : and(eq(invitations.email, normaliseEmail(email)), isPending());
  return db.select(PUBLIC).from(invitations).where(where);
}

/**
 * Resolve an invitation by the hash of the token its holder presented.
 *
 * DELIBERATELY UNSCOPED: the token IS the credential, exactly as in
 * `resolveShareToken`. The holder is establishing which tenant they are being
 * admitted to, so requiring a tenant to look it up inverts the flow — and every
 * caller re-scopes to `row.tenantId` immediately afterwards. Baselined for this
 * reason.
 */
export async function findByTokenHash(db: Db, tokenHash: string): Promise<InvitationRow | null> {
  const [row] = await db
    .select(PUBLIC)
    .from(invitations)
    .where(and(eq(invitations.tokenHash, tokenHash), isPending()))
    .limit(1);
  return row ?? null;
}

/**
 * The same lookup for an invitation this exact person has ALREADY accepted.
 *
 * `findByTokenHash` is pending-only, which is right — a consumed token is not a
 * grant. But it made the invite link a one-shot: opening it a second time (a
 * bookmarked email, a reload, a first attempt that failed downstream and was
 * retried) answered "invalid, expired, or already used" to somebody who is a
 * member of the thing the link points at. `inviteeRef` is the whole safety
 * property here: this returns a row only to the account that redeemed it, so it
 * re-opens nothing for anybody else.
 */
export async function findAcceptedByTokenHash(
  db: Db,
  tokenHash: string,
  inviteeRef: string,
): Promise<InvitationRow | null> {
  const [row] = await db
    .select(PUBLIC)
    .from(invitations)
    .where(acrossTenants(
      invitations,
      'share_token',
      // The token is the credential, exactly as in `findByTokenHash` — the holder
      // is establishing which workspace admitted them, so there is no tenant to
      // scope BY. `inviteeRef` narrows it further than a tenant filter could: to
      // the single account that redeemed this single token.
      eq(invitations.tokenHash, tokenHash),
      eq(invitations.state, 'accepted'),
      eq(invitations.inviteeRef, inviteeRef),
    ))
    .limit(1);
  return row ?? null;
}

/** Does this tenant already have a pending invite for this address? */
export async function hasPendingInvite(db: Db, tenantId: number, email: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.email, normaliseEmail(email)), isPending()))
    .limit(1);
  return Number(row?.n ?? 0) > 0;
}

/** Accept an invitation. Records WHO accepted it, which the two legacy tables
 *  disagreed about: one stored `accepted_by`, the other stored nothing. */
export async function acceptInvitation(
  db: Db,
  env: Env,
  input: { id: string; tenantId: number; inviteeRef?: string | null },
): Promise<InvitationRow | null> {
  const now = new Date();
  const [row] = await db
    .update(invitations)
    .set({ state: 'accepted', acceptedAt: now, inviteeRef: input.inviteeRef ?? null, updatedAt: now })
    .where(and(eq(invitations.id, input.id), eq(invitations.tenantId, input.tenantId), isPending()))
    .returning(PUBLIC);
  if (row) await invalidateInvitations(env, input.tenantId);
  return row ?? null;
}

/** THE revocation path — one, per §2. A revoked invite stops counting against
 *  the seat limit in the same read that stops listing it. */
export async function revokeInvitation(
  db: Db,
  env: Env,
  input: { id: string; tenantId: number },
): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .update(invitations)
    .set({ state: 'revoked', revokedAt: now, updatedAt: now })
    .where(and(eq(invitations.id, input.id), eq(invitations.tenantId, input.tenantId), isPending()))
    .returning({ id: invitations.id });
  if (row) await invalidateInvitations(env, input.tenantId);
  return !!row;
}

/**
 * The accept UPDATE, returned rather than awaited.
 *
 * `acceptInvitation` above is the normal path. The canvas accept route is the one
 * caller that cannot use it: it commits the membership row and the acceptance in a
 * single `db.batch`, because a membership granted while the invitation stays
 * pending is a link that can be redeemed twice. Handing back the statement keeps
 * that atomicity while keeping `isPending()` — the definition of what may still be
 * accepted — in this file rather than copied into the route.
 *
 * The caller owns cache invalidation for this path; `invalidateInvitations` is
 * exported for exactly that.
 */
export function acceptInvitationStatement(
  db: Db,
  input: { id: string; tenantId: number; inviteeRef?: string | null },
) {
  const now = new Date();
  return db
    .update(invitations)
    .set({ state: 'accepted', acceptedAt: now, inviteeRef: input.inviteeRef ?? null, updatedAt: now })
    .where(and(eq(invitations.id, input.id), eq(invitations.tenantId, input.tenantId), isPending()));
}

/** Every invitation on one object, whatever its state — the canvas session's
 *  "who has been invited" panel. */
export async function listForObject(db: Db, tenantId: number, objectId: string): Promise<InvitationRow[]> {
  return db
    .select(PUBLIC)
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.objectId, objectId)))
    .orderBy(desc(invitations.createdAt));
}
