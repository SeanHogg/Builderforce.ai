import { describe, expect, it } from 'vitest';
import { resolveReinvite } from './InvitationService';
import { SEAT_KIND } from '../../domain/tenant/SeatKind';

const seatRow = { role: 'manager', seatKind: SEAT_KIND.SEAT, invitedBy: 'owner-1' };
const guestRow = { role: 'viewer', seatKind: SEAT_KIND.COLLABORATOR, invitedBy: 'owner-1' };

describe('resolveReinvite', () => {
  it('upgrades a canvas guest to a seat when a workspace invite follows the share', () => {
    // Leaving the row saying 'collaborator' would seat that person without ever
    // counting them against maxSeats.
    const next = resolveReinvite(guestRow, {
      role: 'manager', seatKind: SEAT_KIND.SEAT, invitedBy: 'owner-2',
    });
    expect(next).toMatchObject({ role: 'manager', seatKind: SEAT_KIND.SEAT, invitedBy: 'owner-2', changed: true });
  });

  it('never demotes a pending seat because somebody shared one canvas', () => {
    // The companion workspace invitation a canvas share writes is not a decision
    // about the workspace, so it must not rewrite one that is.
    const next = resolveReinvite(seatRow, {
      role: 'developer', seatKind: SEAT_KIND.COLLABORATOR, invitedBy: 'dev-1',
    });
    expect(next).toMatchObject({
      role: 'manager', seatKind: SEAT_KIND.SEAT, invitedBy: 'owner-1', changed: false,
    });
  });

  it('refreshes the role and the sender on an ordinary re-invite', () => {
    const next = resolveReinvite(seatRow, {
      role: 'developer', seatKind: SEAT_KIND.SEAT, invitedBy: 'owner-2',
    });
    expect(next).toMatchObject({ role: 'developer', invitedBy: 'owner-2', changed: true });
  });

  it('reports no change when nothing moved, so an identical re-invite writes nothing', () => {
    expect(resolveReinvite(guestRow, {
      role: 'viewer', seatKind: SEAT_KIND.COLLABORATOR, invitedBy: 'owner-1',
    }).changed).toBe(false);
  });

  it('keeps the original sender when the re-invite names none', () => {
    const next = resolveReinvite(guestRow, { role: 'commenter', seatKind: SEAT_KIND.COLLABORATOR });
    expect(next).toMatchObject({ role: 'commenter', invitedBy: 'owner-1', changed: true });
  });
});
