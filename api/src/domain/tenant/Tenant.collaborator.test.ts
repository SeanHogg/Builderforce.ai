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

describe('readmitting somebody who was removed', () => {
  // `removeMember` deactivates in place, so the roster still carries their row. A
  // second entry for the same user is not a stale-looking roster: the repository
  // persists it with one `INSERT … ON CONFLICT DO UPDATE`, which Postgres refuses
  // when two values hit the same conflicting row, so the whole membership write
  // failed and nobody who had ever been removed could come back.
  const removed = () => workspace()
    .addMember('owner-1', 'dev-1', TenantRole.DEVELOPER)
    .removeMember('owner-1', 'dev-1');

  it('reactivates the existing row rather than appending a second one', () => {
    const readded = removed().addMember('owner-1', 'dev-1', TenantRole.VIEWER);
    const rows = readded.members.filter((m) => m.userId === 'dev-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isActive).toBe(true);
    expect(rows[0]?.role).toBe(TenantRole.VIEWER);
  });

  it('lets a removed canvas guest be admitted to the board again', () => {
    const readmitted = removed().admitCollaborator('dev-1', TenantRole.VIEWER);
    const rows = readmitted.members.filter((m) => m.userId === 'dev-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isActive).toBe(true);
    expect(rows[0]?.seatKind).toBe(SEAT_KIND.COLLABORATOR);
  });

  it('keeps the original joinedAt, which the repository upsert never rewrites', () => {
    const before = removed();
    const joinedAt = before.members.find((m) => m.userId === 'dev-1')?.joinedAt;
    const readded = before.addMember('owner-1', 'dev-1', TenantRole.DEVELOPER);
    expect(readded.members.find((m) => m.userId === 'dev-1')?.joinedAt).toEqual(joinedAt);
  });
});
