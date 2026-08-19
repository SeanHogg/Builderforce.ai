/**
 * THE REFUSALS ARE THE FEATURE.
 *
 * Escrow's whole value is the moves it will NOT make: a client cannot mark work
 * delivered, a freelancer cannot mark it accepted, and neither can take the money back
 * out from under the other. A permissive bug here does not throw — it quietly lets one
 * party rob the other, and the test suite is the only place that gets caught.
 *
 * So every cell of the transition table is asserted, in both directions, including the
 * ones that look obviously impossible. "Obviously impossible" is what a refactor
 * removes.
 */
import { describe, expect, it } from 'vitest';
import {
  availableEscrowActions,
  escrowLedgerReference,
  escrowMovement,
  evaluateEscrow,
  evaluateWorkGate,
  isHoldingFunds,
  MILESTONE_STATUSES,
  summariseEscrow,
  type MilestoneAction,
  type MilestoneStatus,
} from './escrow';

const ask = (action: MilestoneAction, status: MilestoneStatus, party: 'client' | 'freelancer', amountCents = 50_000) =>
  evaluateEscrow({ action, status, party, amountCents });

describe('evaluateEscrow — the happy path', () => {
  it('walks draft → funded → submitted → approved → released', () => {
    expect(ask('fund', 'draft', 'client')).toEqual({ allowed: true, next: 'funded', movesMoney: true });
    expect(ask('submit', 'funded', 'freelancer')).toEqual({ allowed: true, next: 'submitted', movesMoney: false });
    expect(ask('approve', 'submitted', 'client')).toEqual({ allowed: true, next: 'approved', movesMoney: false });
    expect(ask('release', 'approved', 'client')).toEqual({ allowed: true, next: 'released', movesMoney: true });
  });

  it('lets a rejected milestone be fixed and resubmitted rather than stranding it', () => {
    expect(ask('reject', 'submitted', 'client')).toMatchObject({ allowed: true, next: 'disputed' });
    expect(ask('submit', 'disputed', 'freelancer')).toMatchObject({ allowed: true, next: 'submitted' });
  });
});

describe('evaluateEscrow — neither party can move the other\'s half', () => {
  it('a freelancer cannot fund, approve, release or cancel their own work', () => {
    for (const action of ['fund', 'approve', 'release', 'cancel', 'reject'] as MilestoneAction[]) {
      // Asked from the state where the CLIENT would be allowed, so the only thing
      // being tested is the party check.
      const status: MilestoneStatus =
        action === 'fund' || action === 'cancel' ? 'draft'
        : action === 'release' ? 'approved'
        : 'submitted';
      expect(ask(action, status, 'freelancer')).toEqual({ allowed: false, reason: 'wrong_party' });
    }
  });

  it('a client cannot submit work on the freelancer\'s behalf', () => {
    expect(ask('submit', 'funded', 'client')).toEqual({ allowed: false, reason: 'wrong_party' });
  });

  it('reports the wrong PARTY before the wrong STATUS, so the refusal points at the real fix', () => {
    // A freelancer approving a `draft` is wrong on both counts. Saying "wrong status"
    // would imply that approving becomes available to them later. It never does.
    expect(ask('approve', 'draft', 'freelancer')).toEqual({ allowed: false, reason: 'wrong_party' });
  });
});

describe('evaluateEscrow — the money cannot be taken back', () => {
  it('refuses to cancel once work has been submitted', () => {
    expect(ask('cancel', 'submitted', 'client')).toEqual({ allowed: false, reason: 'wrong_status' });
    expect(ask('cancel', 'approved', 'client')).toEqual({ allowed: false, reason: 'wrong_status' });
    expect(ask('cancel', 'disputed', 'client')).toEqual({ allowed: false, reason: 'wrong_status' });
  });

  it('refuses to release money that was never approved', () => {
    for (const status of ['draft', 'funded', 'submitted', 'disputed'] as MilestoneStatus[]) {
      expect(ask('release', status, 'client')).toEqual({ allowed: false, reason: 'wrong_status' });
    }
  });

  it('refuses to fund a milestone worth nothing', () => {
    expect(ask('fund', 'draft', 'client', 0)).toEqual({ allowed: false, reason: 'no_amount' });
    expect(ask('fund', 'draft', 'client', -1)).toEqual({ allowed: false, reason: 'no_amount' });
  });

  it('refuses every action on a released or cancelled milestone — both are terminal', () => {
    for (const status of ['released', 'cancelled'] as MilestoneStatus[]) {
      for (const party of ['client', 'freelancer'] as const) {
        expect(availableEscrowActions(status, party)).toEqual([]);
      }
    }
  });

  it('cancelling an unfunded draft moves no money', () => {
    expect(ask('cancel', 'draft', 'client')).toEqual({ allowed: true, next: 'cancelled', movesMoney: false });
    expect(ask('cancel', 'funded', 'client')).toEqual({ allowed: true, next: 'cancelled', movesMoney: true });
  });

  it('rejects an action nobody declared', () => {
    expect(evaluateEscrow({ action: 'settle' as MilestoneAction, status: 'funded', party: 'client', amountCents: 1 }))
      .toEqual({ allowed: false, reason: 'unknown_action' });
  });
});

describe('availableEscrowActions', () => {
  it('offers each party exactly what the machine would allow', () => {
    expect(availableEscrowActions('draft', 'client').sort()).toEqual(['cancel', 'fund']);
    expect(availableEscrowActions('draft', 'freelancer')).toEqual([]);
    expect(availableEscrowActions('funded', 'freelancer')).toEqual(['submit']);
    expect(availableEscrowActions('funded', 'client')).toEqual(['cancel']);
    expect(availableEscrowActions('submitted', 'client').sort()).toEqual(['approve', 'reject']);
    expect(availableEscrowActions('approved', 'client')).toEqual(['release']);
  });

  it('never offers an action the machine would then refuse — for every state and party', () => {
    for (const status of MILESTONE_STATUSES) {
      for (const party of ['client', 'freelancer'] as const) {
        for (const action of availableEscrowActions(status, party)) {
          expect(ask(action, status, party).allowed).toBe(true);
        }
      }
    }
  });
});

describe('isHoldingFunds / summariseEscrow', () => {
  it('counts approved-but-unreleased as still held — the amount most at risk', () => {
    expect(isHoldingFunds('approved')).toBe(true);
    expect(isHoldingFunds('disputed')).toBe(true);
    expect(isHoldingFunds('draft')).toBe(false);
    expect(isHoldingFunds('released')).toBe(false);
    expect(isHoldingFunds('cancelled')).toBe(false);
  });

  it('rolls a schedule up into the five numbers both sides ask about', () => {
    const summary = summariseEscrow([
      { status: 'released',  amountCents: 100_000 },
      { status: 'approved',  amountCents:  50_000 },
      { status: 'submitted', amountCents:  25_000 },
      { status: 'draft',     amountCents:  30_000 },
      { status: 'cancelled', amountCents: 999_999 },
    ]);

    expect(summary).toEqual({
      // Cancelled work is not part of the agreement any more.
      agreedCents: 205_000,
      // approved + submitted are both still held; released is not.
      heldCents: 75_000,
      releasedCents: 100_000,
      owedCents: 50_000,
      unfundedCents: 30_000,
    });
  });

  it('treats a broken amount as zero rather than poisoning the whole total with NaN', () => {
    const summary = summariseEscrow([
      { status: 'funded', amountCents: Number.NaN },
      { status: 'funded', amountCents: -5 },
      { status: 'funded', amountCents: 1_000 },
    ]);
    expect(summary.heldCents).toBe(1_000);
  });

  it('an empty schedule is all zeroes, not undefined', () => {
    expect(summariseEscrow([])).toEqual({
      agreedCents: 0, heldCents: 0, releasedCents: 0, owedCents: 0, unfundedCents: 0,
    });
  });
});

describe('evaluateWorkGate — funded before work', () => {
  it('does not govern hourly or FTE engagements, and says so', () => {
    expect(evaluateWorkGate('hourly', [])).toEqual({ authorised: true, reason: 'not_fixed_price' });
    expect(evaluateWorkGate('fte', [])).toEqual({ authorised: true, reason: 'not_fixed_price' });
    expect(evaluateWorkGate(null, [])).toEqual({ authorised: true, reason: 'not_fixed_price' });
  });

  it('refuses a fixed-price engagement with no schedule at all', () => {
    expect(evaluateWorkGate('fixed_bid', [])).toEqual({ authorised: false, reason: 'no_milestones' });
  });

  it('refuses a fixed-price engagement whose schedule is entirely unfunded', () => {
    expect(evaluateWorkGate('fixed_bid', [
      { status: 'draft', amountCents: 10_000 },
      { status: 'draft', amountCents: 20_000 },
    ])).toEqual({ authorised: false, reason: 'nothing_funded' });
  });

  it('authorises as soon as ONE milestone is funded — a schedule is funded incrementally', () => {
    expect(evaluateWorkGate('fixed_bid', [
      { status: 'funded', amountCents: 10_000 },
      { status: 'draft',  amountCents: 20_000 },
    ])).toEqual({ authorised: true, reason: 'funded' });
  });

  it('keeps authorising after the first milestone is paid out', () => {
    // Otherwise finishing milestone one would revoke access to the work that earns
    // milestone two.
    expect(evaluateWorkGate('fixed_bid', [
      { status: 'released', amountCents: 10_000 },
      { status: 'draft',    amountCents: 20_000 },
    ])).toEqual({ authorised: true, reason: 'funded' });
  });

  it('does not authorise on a cancelled schedule', () => {
    expect(evaluateWorkGate('fixed_bid', [{ status: 'cancelled', amountCents: 10_000 }]))
      .toEqual({ authorised: false, reason: 'nothing_funded' });
  });
});

describe('the ledger contract', () => {
  it('names a reference that is unique per milestone AND action, so a release is not a replay of the funding', () => {
    expect(escrowLedgerReference('m-1', 'fund')).toBe('escrow:m-1:fund');
    expect(escrowLedgerReference('m-1', 'release')).toBe('escrow:m-1:release');
    expect(escrowLedgerReference('m-1', 'fund')).not.toBe(escrowLedgerReference('m-1', 'release'));
  });

  it('maps each money-moving action onto entry kinds the ledger already has', () => {
    expect(escrowMovement('fund')).toEqual({ entryKind: 'hold', accountKind: 'tenant', sign: -1 });
    expect(escrowMovement('release')).toEqual({ entryKind: 'payout', accountKind: 'user', sign: 1 });
    expect(escrowMovement('cancel')).toEqual({ entryKind: 'refund', accountKind: 'tenant', sign: 1 });
  });

  it('writes nothing for the actions that move no money', () => {
    expect(escrowMovement('submit')).toBeNull();
    expect(escrowMovement('approve')).toBeNull();
    expect(escrowMovement('reject')).toBeNull();
  });
});
