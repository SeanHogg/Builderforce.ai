/**
 * Seat accounting for a tenant — the single source of truth for "how many seats
 * are taken or promised". A seat is consumed by an ACTIVE member OR a pending
 * invitation (a promise to seat someone on signup). Shared by the invite-time
 * guard (`presentation/middleware/planLimitsGuard` → `checkSeatLimit`) and the
 * accept-time re-check in `pendingInvitationLanding`, so both agree on the math.
 *
 * TWO things are deliberately NOT counted, and both used to be:
 *
 *  - A DEACTIVATED member. `is_active = false` is how a member is removed
 *    (`Tenant.removeMember` never deletes the row), so counting them meant
 *    removing somebody never gave the seat back — every membership check in the
 *    product requires `is_active`, and the tally is now the only thing that
 *    agreed the person was still there.
 *  - A CANVAS COLLABORATOR. Their membership exists so a shared board resolves,
 *    not so they can work in the workspace; their cap is
 *    `maxCreationSessionCollaborators`. See `domain/tenant/SeatKind.ts`.
 *
 * LAYER. This lived in `presentation/middleware/planLimitsGuard.ts`, which meant
 * the application-layer use case that re-checks capacity at ACCEPT time had to
 * import upwards out of presentation. It is a tenant-domain read, so it lives in
 * the tenant bounded context and both layers depend downwards on it.
 */
import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { tenantMembers } from '../../infrastructure/database/schema';
import { getLimits } from '../../domain/tenant/PlanLimits';
import { SEAT_KIND } from '../../domain/tenant/SeatKind';
import { countPending } from '../kernel/InvitationService';
import type { TenantPlan } from '../../domain/shared/types';
import { resolveTenantEffectivePlan } from './tenantPlanSnapshot';

export type SeatCapacity = {
  plan: TenantPlan;
  maxSeats: number;
  members: number;
  pendingInvites: number;
};

export async function seatCapacityForTenant(db: Db, env: Env, tenantId: number): Promise<SeatCapacity> {
  // The plan (cached snapshot) and the two counts are independent reads.
  const [plan, [memberRow], [inviteRow]] = await Promise.all([
    resolveTenantEffectivePlan(env, tenantId, db),
    db.select({ total: count() }).from(tenantMembers).where(and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.isActive, true),
      eq(tenantMembers.seatKind, SEAT_KIND.SEAT),
    )),
    // The SAME cached read the members page lists from, so a seat cap and the
    // roster it is derived from can never disagree about what "pending" means.
    countPending(db, env, tenantId, 'tenant', SEAT_KIND.SEAT).then((total) => [{ total }]),
  ]);
  return {
    plan,
    maxSeats: getLimits(plan).maxSeats,
    members: Number(memberRow?.total ?? 0),
    pendingInvites: Number(inviteRow?.total ?? 0),
  };
}
