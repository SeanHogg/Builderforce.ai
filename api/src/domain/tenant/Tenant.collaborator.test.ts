import { describe, expect, it } from 'vitest';
import { Tenant } from './Tenant';
import { SEAT_KIND } from './SeatKind';
import { TenantRole } from '../shared/types';
import { ForbiddenError, ValidationError } from '../shared/errors';

const workspace = () => Tenant.create('Acme', 'owner-1');

describe('admitCollaborator', () => {
  it('admits a canvas guest whose inviter holds no workspace authority', () => {
    // Board ownership is per-board and carries no workspace role, so replaying the
    // add under the inviter — what `addMember` does — left every invitation sent by
    // a developer-owned canvas stuck pending forever.
    const developerOwnedBoard = workspace().addMember('owner-1', 'dev-1', TenantRole.DEVELOPER);
    expect(() => developerOwnedBoard.addMember('dev-1', 'guest-1', TenantRole.VIEWER))
      .toThrow(ForbiddenError);

    const admitted = developerOwnedBoard.admitCollaborator('guest-1', TenantRole.VIEWER);
    const guest = admitted.members.find((m) => m.userId === 'guest-1');
    expect(guest?.role).toBe(TenantRole.VIEWER);
    expect(guest?.isActive).toBe(true);
  });

  it('can only ever create a collaborator, never a paid seat', () => {
    // The door with no role gate on it must not reach the thing `maxSeats` governs.
    const admitted = workspace().admitCollaborator('guest-1', TenantRole.DEVELOPER);
    expect(admitted.members.find((m) => m.userId === 'guest-1')?.seatKind)
      .toBe(SEAT_KIND.COLLABORATOR);
    expect(admitted.members.find((m) => m.userId === 'owner-1')?.seatKind)
      .toBe(SEAT_KIND.SEAT);
  });

  it('refuses to admit anyone as an owner or a manager', () => {
    for (const role of [TenantRole.OWNER, TenantRole.MANAGER]) {
      expect(() => workspace().admitCollaborator('guest-1', role)).toThrow(ValidationError);
    }
  });

  it('refuses somebody who is already a member', () => {
    const seated = workspace().addMember('owner-1', 'dev-1', TenantRole.DEVELOPER);
    expect(() => seated.admitCollaborator('dev-1', TenantRole.VIEWER)).toThrow(ValidationError);
  });
});
