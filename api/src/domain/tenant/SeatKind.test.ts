import { describe, expect, it } from 'vitest';
import { SEAT_KIND, asSeatKind, consumesSeat } from './SeatKind';
import { PLAN_LIMITS, canAddSeat } from './PlanLimits';
import { TenantPlan } from '../shared/types';

describe('asSeatKind', () => {
  it('recognises a collaborator', () => {
    expect(asSeatKind('collaborator')).toBe(SEAT_KIND.COLLABORATOR);
  });

  it('treats anything it does not recognise as a paid seat', () => {
    // Under-counting seats gives the plan away; over-counting merely asks
    // somebody to upgrade. Unknown input takes the recoverable failure.
    for (const value of ['seat', 'guest', '', null, undefined]) {
      expect(asSeatKind(value)).toBe(SEAT_KIND.SEAT);
    }
  });
});

describe('consumesSeat', () => {
  it('is true for a workspace member and false for a canvas collaborator', () => {
    expect(consumesSeat(SEAT_KIND.SEAT)).toBe(true);
    expect(consumesSeat(SEAT_KIND.COLLABORATOR)).toBe(false);
  });
});

describe('the plan matrix a collaborator is measured against', () => {
  it('lets every plan that advertises canvas collaborators actually seat them', () => {
    // THE REGRESSION. Free and Pro both allow canvas collaborators and both cap
    // seats at 1 — already filled by the owner. While a collaborator consumed a
    // seat, the companion workspace invitation could never be accepted and the
    // invitee got 409 TENANT_SEAT_LIMIT on a plan that sells collaboration.
    for (const plan of [TenantPlan.FREE, TenantPlan.PRO, TenantPlan.TEAMS]) {
      const limits = PLAN_LIMITS[plan];
      if (limits.maxCreationSessionCollaborators === 1) continue;
      const seatsAllTaken = limits.maxSeats === -1 ? 0 : limits.maxSeats;
      expect(canAddSeat(plan, seatsAllTaken)).toBe(limits.maxSeats === -1);
      // …and the collaborator is admitted regardless, because they are not a seat.
      expect(consumesSeat(SEAT_KIND.COLLABORATOR)).toBe(false);
    }
  });
});
