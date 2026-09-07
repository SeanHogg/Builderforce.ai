/**
 * THE passwordless identity somebody gets when they open a canvas invite link and
 * decline to sign up.
 *
 * ── WHY AN ACCOUNT AT ALL, FOR SOMEBODY WHO REFUSED ONE ──────────────────────────
 * Because a durable canvas is tenant-scoped by construction. `sessionAccess.ts`
 * resolves a board through a `creation_session_members` row, presence writes a cursor
 * against a user id, comments carry an author, and the realtime relay stamps a
 * principal onto every frame. A person with no identity can be shown a board and can
 * do nothing on it, which is not what "join" means.
 *
 * The alternative was a parallel anonymous credential — a signed pass the canvas routes
 * learn to accept beside the tenant JWT — and that is a second authorization scheme
 * across ~60 endpoints, which is the shape where one endpoint forgets. So a guest gets
 * the SAME identity every collaborator has, minted without a password, an inbox or a
 * choice: `account_type = 'guest'` is the one field that says so, and every seat count,
 * plan cap and role ceiling that already governs an invited collaborator governs them
 * unchanged.
 *
 * ── WHAT IT COSTS THE WORKSPACE ──────────────────────────────────────────────────
 * Nothing billable. The membership is a `collaborator` (see `domain/tenant/SeatKind.ts`),
 * capped by `maxCreationSessionCollaborators` like every other canvas guest, and the
 * workspace role is the BOARD role's ceiling (`tenantRoleForSessionRole`) — sharing one
 * canvas by link must not hand over the workspace, and a link reaches further than an
 * addressed email does.
 *
 * ── UPGRADING ────────────────────────────────────────────────────────────────────
 * The row is a real `users` row, so keeping the work is setting an email and a password
 * on the account that already holds it — not a migration of somebody else's data into a
 * new one. That is why the guest is not a throwaway token.
 */

import { and, eq } from 'drizzle-orm';
import { tenantMembers, users } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { SEAT_KIND } from '../../domain/tenant/SeatKind';
import type { TenantRole } from '../../domain/shared/types';

/** The `users.account_type` value that marks an identity minted by a link claim. */
export const GUEST_ACCOUNT_TYPE = 'guest';

/**
 * `.invalid` is reserved by RFC 2606 and can never resolve, so a guest address can
 * never be mailed, can never collide with a real one, and can never be mistaken for a
 * verified inbox by a reader that only has the string.
 */
const GUEST_EMAIL_DOMAIN = 'guest.invalid';

export interface CanvasGuestIdentity {
  id: string;
  email: string;
  name: string;
  isGuest: true;
}

/** The display name a guest typed, bounded and never empty. */
export function cleanGuestName(raw: unknown, fallback = 'Guest'): string {
  const value = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
  return value || fallback;
}

/** Is this an identity minted by a link claim rather than a real signup? */
export function isGuestAccount(accountType: string | null | undefined): boolean {
  return accountType === GUEST_ACCOUNT_TYPE;
}

/**
 * Mint the guest `users` row. Nothing else: seating them in a workspace is a separate
 * decision made by whoever knows which workspace and at what ceiling, and folding it in
 * here would make "create a person" and "grant them access" one irreversible step.
 */
export async function createGuestUser(db: Db, displayName: string): Promise<CanvasGuestIdentity> {
  const id = crypto.randomUUID();
  const email = `guest-${id}@${GUEST_EMAIL_DOMAIN}`;
  const name = cleanGuestName(displayName);
  await db.insert(users).values({
    id,
    email,
    displayName: name,
    accountType: GUEST_ACCOUNT_TYPE,
    // Stamped so the one-time "Build or Hired?" onboarding gate never traps somebody
    // who was never offered the choice; a guest is neither, and asking would be a
    // signup form wearing a different hat.
    accountTypeSelectedAt: new Date(),
  });
  return { id, email, name, isGuest: true };
}

/** Read back a guest identity by id, or null when the id is not a guest account. */
export async function findGuestUser(db: Db, userId: string): Promise<CanvasGuestIdentity | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.displayName, accountType: users.accountType })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || !isGuestAccount(row.accountType)) return null;
  return { id: row.id, email: row.email, name: row.name ?? 'Guest', isGuest: true };
}

/**
 * Seat somebody in a workspace as a CANVAS COLLABORATOR — the membership that exists
 * only so a shared board resolves, and that `maxSeats` deliberately does not count.
 *
 * Idempotent on (tenant, user) — the unique index migration 1138 added is what makes
 * that an upsert rather than a select-then-insert race — and it never DOWNGRADES an
 * existing membership: somebody who is already a developer in the workspace and then
 * opens a viewer link keeps the access they had.
 */
export async function seatAsCollaborator(
  db: Db,
  input: { tenantId: number; userId: string; role: TenantRole },
): Promise<void> {
  const [existing] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, input.tenantId), eq(tenantMembers.userId, input.userId)))
    .limit(1);
  if (existing) {
    await db.update(tenantMembers).set({ isActive: true }).where(eq(tenantMembers.id, existing.id));
    return;
  }
  await db.insert(tenantMembers).values({
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
    isActive: true,
    joinedAt: new Date(),
    seatKind: SEAT_KIND.COLLABORATOR,
  }).onConflictDoNothing();
}
