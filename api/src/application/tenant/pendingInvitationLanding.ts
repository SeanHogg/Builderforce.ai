/**
 * Landing a pending workspace invitation — the moment a person who was invited
 * BEFORE they had an account becomes a real member of the workspace.
 *
 * WHY THIS IS A USE CASE AND NOT A ROUTE HELPER. It used to live inside
 * `presentation/routes/tenantRoutes.ts` and was called from exactly one handler,
 * `GET /api/tenants/mine` — a route no client has ever called. Every surface
 * lists the caller's workspaces through a DIFFERENT endpoint (the web app and
 * the agent-runtime CLI via `GET /api/auth/my-tenants`, the editor via
 * `GET /api/vscode/tenants`), so a cold invitee signed up, saw zero workspaces,
 * was pushed into "create a workspace" onboarding, and the invitation stayed
 * pending forever while the manager's members page listed it as sent.
 *
 * The landing is not a property of one endpoint; it is what "list the workspaces
 * I belong to" MEANS for someone who was invited by address. So it lives here,
 * in the tenant bounded context, and every workspace-list entry point calls it.
 *
 * Best-effort by construction: a single tenant failing must never block the
 * caller's login or the other tenants' invites, so the row is left pending and
 * retries on the next visit.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { users } from '../../infrastructure/database/schema';
import { acceptInvitation, findPendingByEmail } from '../kernel/InvitationService';
import { tenantRoleOf } from './tenantRoles';
import { seatCapacityForTenant } from './seatCapacity';
import { canAddSeat } from '../../domain/tenant/PlanLimits';
import { asSeatKind, consumesSeat } from '../../domain/tenant/SeatKind';
import type { SeatKind } from '../../domain/tenant/SeatKind';
import type { TenantPlan, TenantRole } from '../../domain/shared/types';
import { invalidateTaskAssignees } from '../task/taskAssigneeCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/**
 * The narrow slice of `TenantService` this use case needs: two ways to make a
 * membership real. Declared structurally so the use case depends on the
 * capability, not on the 700-line service that happens to provide it (and so a
 * test can hand it a stub).
 */
export type MembershipSeating = {
  addMember(
    tenantId: number,
    actorUserId: string,
    newUserId: string,
    role: TenantRole,
    seatKind?: SeatKind,
  ): Promise<unknown>;
  admitCollaborator(tenantId: number, newUserId: string, role: TenantRole): Promise<unknown>;
};

/**
 * Convert any still-pending invitation addressed to this account's email into a
 * real membership.
 *
 * `email` is optional: callers that already hold the account's address pass it
 * (the creation-session accept path does) and callers that do not — every
 * workspace-list endpoint — let this resolve it in one read rather than each
 * repeating the same `users` select.
 *
 * Each accepted row is stamped accepted/accepted_at, and the tenant's assignee
 * and invitation caches are dropped. If the user is already a member (invited
 * twice, or added manually in between) the row is still resolved to 'accepted'
 * rather than retried forever.
 */
export async function landPendingInvitations(
  db: Db,
  env: Env,
  seating: MembershipSeating,
  userId: string,
  email?: string,
): Promise<void> {
  let address = email?.toLowerCase().trim();
  if (!address) {
    const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    address = account?.email?.toLowerCase().trim();
  }
  if (!address) return;

  // One definition of "pending" (kernel `InvitationService`), so a revoked or
  // expired row cannot be accepted here while the members page shows it gone.
  const pending = (await findPendingByEmail(db, address, 'tenant')).map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    role: row.role as TenantRole,
    seatKind: asSeatKind(row.seatKind),
    invitedByUserId: row.invitedBy,
  }));
  if (pending.length === 0) return;

  // Per-tenant live seat tally, fetched lazily on first use and incremented as we
  // seat invites within this run, so a batch of invites for the same tenant can't
  // collectively overshoot the cap.
  const seatState = new Map<number, { plan: TenantPlan; seated: number }>();

  for (const invite of pending) {
    try {
      // Already a member? Resolve the invite without re-adding (addMember would
      // throw "already a member" and leave the row stuck pending).
      const alreadyMember = (await tenantRoleOf(db, invite.tenantId, userId)) !== null;
      if (!alreadyMember) {
        // Re-check seat capacity at ACCEPT time (members-only — this pending row
        // is about to be consumed). The invite-time guard already counted pending
        // seats, but a plan DOWNGRADE after the invites were queued can still
        // over-subscribe. If the plan can't seat it, leave the invite pending
        // (visible in the manager's invitations list, auto-retries once a seat
        // frees up or they upgrade) instead of silently auto-accepting past the cap.
        //
        // A CANVAS COLLABORATOR skips this entirely: their membership is the
        // mechanism that makes a shared board resolve, not a workspace seat, and
        // it was capped at invite time against `maxCreationSessionCollaborators`.
        // Gating it on `maxSeats` — 1 on both Free and Pro — is what made canvas
        // sharing impossible on the plans that advertise it.
        if (consumesSeat(invite.seatKind)) {
          // The invitee can't authorize their own membership — replay the add
          // under the manager who sent the invite (a manager or owner at invite
          // time, which `Tenant.addMember` re-checks).
          if (!invite.invitedByUserId) continue;
          let state = seatState.get(invite.tenantId);
          if (!state) {
            const cap = await seatCapacityForTenant(db, env, invite.tenantId);
            state = { plan: cap.plan, seated: cap.members };
            seatState.set(invite.tenantId, state);
          }
          if (!canAddSeat(state.plan, state.seated)) {
            continue; // over cap — leave pending, do not seat
          }
          state.seated += 1;
          await seating.addMember(
            invite.tenantId, invite.invitedByUserId, userId, invite.role, invite.seatKind,
          );
        } else {
          // A canvas guest is NOT replayed under the inviter: board ownership is
          // per-board and carries no workspace authority, so a developer who
          // creates a canvas and shares it would fail the manager check and leave
          // the invitation stuck pending forever. The board invite gate and the
          // redeemed token are the authorization — see `Tenant.admitCollaborator`.
          await seating.admitCollaborator(invite.tenantId, userId, invite.role);
        }
      }
      await acceptInvitation(db, env, { id: invite.id, tenantId: invite.tenantId, inviteeRef: userId });
      await invalidateTaskAssignees(env, invite.tenantId);
    } catch (error) {
      // A transient error on one tenant must not block the user's login or the
      // other tenants' invites — leave the row pending so it retries next visit.
      reportCaughtError(error, {
        source: 'application/tenant/pendingInvitationLanding.ts',
        operation: 'landPendingInvitations',
      });
    }
  }
}
