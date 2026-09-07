import { describe, it, expect, vi, beforeEach } from 'vitest';
import { landPendingInvitations, type MembershipSeating } from './pendingInvitationLanding';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { SEAT_KIND } from '../../domain/tenant/SeatKind';
import { TenantPlan, TenantRole } from '../../domain/shared/types';

vi.mock('../kernel/InvitationService', () => ({
  findPendingByEmail: vi.fn(),
  acceptInvitation: vi.fn().mockResolvedValue(null),
}));
vi.mock('./tenantRoles', () => ({ tenantRoleOf: vi.fn().mockResolvedValue(null) }));
vi.mock('./seatCapacity', () => ({ seatCapacityForTenant: vi.fn() }));
vi.mock('../task/taskAssigneeCache', () => ({ invalidateTaskAssignees: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { findPendingByEmail, acceptInvitation } from '../kernel/InvitationService';
import { tenantRoleOf } from './tenantRoles';
import { seatCapacityForTenant } from './seatCapacity';

const pending = vi.mocked(findPendingByEmail);
const accept = vi.mocked(acceptInvitation);
const roleOf = vi.mocked(tenantRoleOf);
const capacity = vi.mocked(seatCapacityForTenant);

const env = {} as Env;

/** `select→from→where→limit` resolves the account row the use case looks up. */
const stubDb = (email: string | null) => ({
  select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(email ? [{ email }] : []) }) }) }),
}) as unknown as Db;

function stubSeating() {
  const added: unknown[] = [];
  const admitted: unknown[] = [];
  const seating: MembershipSeating = {
    addMember: async (tenantId, actorUserId, newUserId, role, seatKind) => {
      added.push({ tenantId, actorUserId, newUserId, role, seatKind });
    },
    admitCollaborator: async (tenantId, newUserId, role) => {
      admitted.push({ tenantId, newUserId, role });
    },
  };
  return { seating, added, admitted };
}

const invite = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'inv-1', tenantId: 7, objectId: null, kind: 'tenant', email: 'ada@x.com', inviteeRef: null,
  role: TenantRole.DEVELOPER, seatKind: SEAT_KIND.SEAT, state: 'pending', invitedBy: 'mgr-1',
  message: null, expiresAt: null, acceptedAt: null, revokedAt: null, createdAt: new Date(),
  ...over,
});

describe('landPendingInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleOf.mockResolvedValue(null);
    capacity.mockResolvedValue({ plan: TenantPlan.TEAMS, maxSeats: 25, members: 1, pendingInvites: 1 });
  });

  it('resolves the account address itself when the caller does not supply one', async () => {
    // This is the whole point of the fix: the workspace-list endpoints call it
    // with a userId only, so it must find the address the invitation was sent to.
    pending.mockResolvedValue([] as never);
    await landPendingInvitations(stubDb('Ada@X.com'), env, stubSeating().seating, 'user-1');
    expect(pending).toHaveBeenCalledWith(expect.anything(), 'ada@x.com', 'tenant');
  });

  it('seats a cold invitee under the manager who invited them, then accepts the row', async () => {
    pending.mockResolvedValue([invite()] as never);
    const { seating, added } = stubSeating();
    await landPendingInvitations(stubDb('ada@x.com'), env, seating, 'user-1');
    expect(added).toEqual([
      { tenantId: 7, actorUserId: 'mgr-1', newUserId: 'user-1', role: TenantRole.DEVELOPER, seatKind: SEAT_KIND.SEAT },
    ]);
    expect(accept).toHaveBeenCalledWith(expect.anything(), env, { id: 'inv-1', tenantId: 7, inviteeRef: 'user-1' });
  });

  it('admits a canvas collaborator without spending a workspace seat', async () => {
    pending.mockResolvedValue([invite({ seatKind: SEAT_KIND.COLLABORATOR, role: TenantRole.VIEWER })] as never);
    const { seating, added, admitted } = stubSeating();
    await landPendingInvitations(stubDb('ada@x.com'), env, seating, 'user-1');
    expect(added).toEqual([]);
    expect(admitted).toEqual([{ tenantId: 7, newUserId: 'user-1', role: TenantRole.VIEWER }]);
    expect(capacity).not.toHaveBeenCalled();
  });

  it('accepts without re-adding when the person is already a member', async () => {
    roleOf.mockResolvedValue(TenantRole.MANAGER as never);
    pending.mockResolvedValue([invite()] as never);
    const { seating, added } = stubSeating();
    await landPendingInvitations(stubDb('ada@x.com'), env, seating, 'user-1');
    expect(added).toEqual([]);
    expect(accept).toHaveBeenCalledOnce();
  });

  it('leaves the invite pending rather than seating past a downgraded plan', async () => {
    capacity.mockResolvedValue({ plan: TenantPlan.FREE, maxSeats: 1, members: 1, pendingInvites: 1 });
    pending.mockResolvedValue([invite()] as never);
    const { seating, added } = stubSeating();
    await landPendingInvitations(stubDb('ada@x.com'), env, seating, 'user-1');
    expect(added).toEqual([]);
    expect(accept).not.toHaveBeenCalled();
  });

  it('counts seats it fills within one run, so a batch cannot collectively overshoot', async () => {
    // Free seats one member. Two pending invites for the SAME workspace must not
    // both land just because the tally was read before either of them was seated.
    capacity.mockResolvedValue({ plan: TenantPlan.FREE, maxSeats: 1, members: 0, pendingInvites: 2 });
    pending.mockResolvedValue([invite({ id: 'a' }), invite({ id: 'b' })] as never);
    const { seating, added } = stubSeating();
    await landPendingInvitations(stubDb('ada@x.com'), env, seating, 'user-1');
    expect(added).toHaveLength(1);           // the second overshoots maxSeats
    expect(capacity).toHaveBeenCalledOnce(); // tally fetched once per tenant, not per invite
    expect(accept).toHaveBeenCalledOnce();
  });

  it('does not block the other workspaces when one fails', async () => {
    pending.mockResolvedValue([invite({ id: 'a', tenantId: 7 }), invite({ id: 'b', tenantId: 8 })] as never);
    const { seating } = stubSeating();
    const failing: MembershipSeating = {
      ...seating,
      addMember: async (tenantId) => { if (tenantId === 7) throw new Error('transient'); },
    };
    await landPendingInvitations(stubDb('ada@x.com'), env, failing, 'user-1');
    expect(accept).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith(expect.anything(), env, { id: 'b', tenantId: 8, inviteeRef: 'user-1' });
  });

  it('is a no-op for an account with no address on file', async () => {
    await landPendingInvitations(stubDb(null), env, stubSeating().seating, 'user-1');
    expect(pending).not.toHaveBeenCalled();
  });
});
