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
import type { Env } from '../../env';

/** What an invitation invites you to. `objectId` is null for `tenant`, because a
 *  workspace is not an addressable object in the registry — every other kind
 *  carries the object it grants access to. */
export type InvitationKind = 'tenant' | 'session' | 'project' | 'team' | 'board' | 'ceremony' | 'engagement';

export type InvitationState = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

export type InvitationRow = {
  id: string;
  tenantId: number;
  objectId: string | null;
  kind: string;
  email: string | null;
  inviteeRef: string | null;
  role: string;
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

  const [existing] = await db
    .select(PUBLIC)
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, input.tenantId),
        eq(invitations.kind, input.kind),
        eq(invitations.email, email),
        isPending(),
      ),
    )
    .limit(1);

  if (existing && !input.tokenHash) {
    // A re-invite with no new token updates in place: same row, current role.
    if (existing.role !== role || (input.invitedBy && existing.invitedBy !== input.invitedBy)) {
      await db
        .update(invitations)
        .set({ role, invitedBy: input.invitedBy ?? existing.invitedBy, updatedAt: new Date() })
        .where(eq(invitations.id, existing.id));
    }
    await invalidateInvitations(env, input.tenantId);
    return { ...existing, role };
  }

  const [row] = await db
    .insert(invitations)
    .values({
      tenantId: input.tenantId,
      kind: input.kind,
      objectId: input.objectId ?? null,
      email,
      role,
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
      const where = kind
        ? and(eq(invitations.tenantId, tenantId), eq(invitations.kind, kind), isPending())
        : and(eq(invitations.tenantId, tenantId), isPending());
      return db.select(PUBLIC).from(invitations).where(where).orderBy(desc(invitations.createdAt));
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
): Promise<number> {
  return (await listPending(db, env, tenantId, kind)).length;
}

/** Pending invitations for one address, across every tenant — what the sign-in
 *  path reads to decide which workspaces a new account joins. */
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

/** Resolve an invitation by the hash of the token its holder presented. */
export async function findByTokenHash(db: Db, tokenHash: string): Promise<InvitationRow | null> {
  const [row] = await db
    .select(PUBLIC)
    .from(invitations)
    .where(and(eq(invitations.tokenHash, tokenHash), isPending()))
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

/** Every invitation on one object, whatever its state — the canvas session's
 *  "who has been invited" panel. */
export async function listForObject(db: Db, objectId: string): Promise<InvitationRow[]> {
  return db
    .select(PUBLIC)
    .from(invitations)
    .where(eq(invitations.objectId, objectId))
    .orderBy(desc(invitations.createdAt));
}
