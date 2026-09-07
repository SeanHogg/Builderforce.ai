/**
 * ADMITTING AN INVITED PERSON TO A BOARD — the workspace membership a shared canvas
 * needs in order to resolve at all.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * A canvas is tenant-scoped by construction (`sessionAccess.ts` resolves a board
 * through a `creation_session_members` row inside a tenant), so a collaborator holds
 * a `tenant_members` row whether they were shared a link or sent an email. The LINK
 * path seats them directly — capacity check, then `seatAsCollaborator`. The EMAIL
 * path did not: it relied entirely on the companion `kind: 'tenant'` invitation that
 * the canvas invite writes alongside the board one being found, still pending, still
 * carrying `seat_kind = 'collaborator'`, and landing through `acceptPendingInvitations`
 * before the accept route looked. Every one of those is a way for the redemption to
 * fail, and when it did the route answered `409 TENANT_SEAT_LIMIT` — telling the
 * invitee their host was out of seats, on plans whose seat cap has nothing to do with
 * canvas sharing and is filled by the owner alone.
 *
 * So the two doors now agree: the thing that authorizes admission is the redeemed
 * invitation itself — an unguessable single-use token, addressed to the email the
 * redeemer signed in with — and the cap that governs it is
 * `maxCreationSessionCollaborators`, never `maxSeats`. See `domain/tenant/SeatKind.ts`
 * for why those are different numbers, and `Tenant.admitCollaborator` for why board
 * ownership is the authority here rather than a workspace role.
 *
 * The companion workspace invitation is still written and still lands — this is the
 * floor underneath it, not a replacement for it.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenantMembers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { seatAsCollaborator } from './canvasGuestAccount';
import {
  collaboratorCapacity,
  collaboratorLimitForTenant,
  type CollaboratorCapacityRefusal,
} from './canvasCollaboratorCapacity';
import { tenantRoleForSessionRole, type SessionRole } from './sessionAccess';

export interface BoardAdmission {
  tenantId: number;
  /** The canvas the invitation grants access to. */
  sessionId: string;
  /** The board's object-registry id, for the pending-invitation tally. Null = none. */
  objectId: string | null;
  /** The person redeeming the invitation. */
  userId: string;
  /** The BOARD role they were invited at — the ceiling for the workspace role they get. */
  sessionRole: SessionRole;
  /** The invited address, excluded from the pending tally so their own invitation is
   *  not counted against them. */
  email?: string;
}

/**
 * Ensure `userId` holds the workspace membership their board access requires.
 *
 * Returns `null` once they do — including when they already did, which costs nothing
 * and is checked before the cap so an existing member is never refused by it — or the
 * `403` refusal body when the board is genuinely at its collaborator limit.
 */
export async function admitToBoard(
  db: Db,
  env: Env,
  input: BoardAdmission,
): Promise<CollaboratorCapacityRefusal | null> {
  const [member] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(scopedToTenant(
      tenantMembers,
      input.tenantId,
      eq(tenantMembers.userId, input.userId),
      eq(tenantMembers.isActive, true),
    ))
    .limit(1);
  if (member) return null;

  const refusal = await collaboratorCapacity(db, env, {
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    objectId: input.objectId,
    limit: await collaboratorLimitForTenant(env, input.tenantId, db),
    arrival: { alreadyMember: false, email: input.email },
  });
  if (refusal) return refusal;

  await seatAsCollaborator(db, {
    tenantId: input.tenantId,
    userId: input.userId,
    role: tenantRoleForSessionRole(input.sessionRole),
  });
  return null;
}
