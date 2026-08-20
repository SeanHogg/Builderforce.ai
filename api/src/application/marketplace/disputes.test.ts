/**
 * A RULING MOVES SOMEBODY ELSE'S MONEY. Every branch of it is asserted here.
 *
 * `escrow.test.ts` says it best about its own subject: the refusals are the feature,
 * and "obviously impossible" is what a refactor removes. The same applies with one
 * addition — a dispute resolution is the only place in this codebase where a THIRD
 * party decides where held funds go, so the arithmetic and the ledger references get
 * the same table treatment as the transitions.
 *
 * The property worth stating out loud, and asserted below: a ruling writes the SAME
 * ledger references an ordinary escrow release or cancellation writes. That is what
 * makes it structurally impossible to pay one milestone twice — the unique index on
 * (tenant, denomination, reference) refuses the second one, whichever path produced it.
 */
import { describe, expect, it } from 'vitest';
import {
  DISPUTE_OUTCOMES,
  awardFor,
  evaluateDisputeRaise,
  isDisputeOutcome,
  isStatementParty,
  mediatorAuthority,
  normaliseEvidence,
  rulingLedgerLines,
  statusAfterRuling,
  type DisputeOutcome,
} from './disputes';
import {
  MILESTONE_STATUSES,
  escrowLedgerReference,
  isHoldingFunds,
  type MilestoneStatus,
} from './escrow';

const AMOUNT = 50_000;

describe('evaluateDisputeRaise — who may open one, and over what', () => {
  it('allows both parties from every state where money is held', () => {
    for (const status of MILESTONE_STATUSES) {
      if (!isHoldingFunds(status) || status === 'disputed') continue;
      for (const party of ['client', 'freelancer'] as const) {
        expect(evaluateDisputeRaise({ status, party, amountCents: AMOUNT }))
          .toEqual({ allowed: true, next: 'disputed' });
      }
    }
  });

  it('is the ONE escrow-shaped move both parties share', () => {
    // The whole reason this lives outside `escrow.ts`: its transition table gives each
    // move a single `by` party, so this assertion is inexpressible there.
    expect(evaluateDisputeRaise({ status: 'funded', party: 'client', amountCents: AMOUNT }).allowed).toBe(true);
    expect(evaluateDisputeRaise({ status: 'funded', party: 'freelancer', amountCents: AMOUNT }).allowed).toBe(true);
  });

  it('refuses every state where no money is held', () => {
    for (const status of MILESTONE_STATUSES) {
      if (isHoldingFunds(status)) continue;
      expect(evaluateDisputeRaise({ status, party: 'client', amountCents: AMOUNT }))
        .toEqual({ allowed: false, reason: 'wrong_status' });
    }
  });

  it('refuses a second dispute with its own code, not a generic wrong_status', () => {
    // The surface has to be able to say "there is already a dispute open" — a caller
    // told `wrong_status` about a milestone that IS disputable goes looking for a bug.
    expect(evaluateDisputeRaise({ status: 'disputed', party: 'client', amountCents: AMOUNT }))
      .toEqual({ allowed: false, reason: 'already_disputed' });
  });

  it('refuses a zero-value milestone, with escrow\'s own code', () => {
    expect(evaluateDisputeRaise({ status: 'funded', party: 'client', amountCents: 0 }))
      .toEqual({ allowed: false, reason: 'no_amount' });
  });

  it('tracks escrow\'s definition of holding rather than a copied list', () => {
    // `approved` is the subtle one — approval does not move money, so an approved
    // milestone is still holding the client's funds and is still disputable. If escrow
    // ever changed that, this test fails rather than the two silently disagreeing.
    expect(isHoldingFunds('approved')).toBe(true);
    expect(evaluateDisputeRaise({ status: 'approved', party: 'freelancer', amountCents: AMOUNT }).allowed).toBe(true);
  });
});

describe('awardFor — the arithmetic of a ruling', () => {
  it('gives the whole amount to one side for the two full outcomes', () => {
    expect(awardFor('release_full', AMOUNT)).toEqual({ freelancerCents: AMOUNT, clientCents: 0 });
    expect(awardFor('refund_full', AMOUNT)).toEqual({ freelancerCents: 0, clientCents: AMOUNT });
  });

  it('moves nothing for a restore', () => {
    expect(awardFor('restore', AMOUNT)).toEqual({ freelancerCents: 0, clientCents: 0 });
  });

  it('computes the client share as the REMAINDER, never as a second input', () => {
    const award = awardFor('split', AMOUNT, 20_000);
    expect(award).toEqual({ freelancerCents: 20_000, clientCents: 30_000 });
    // The property that matters: the two halves always add up to the pot.
    expect((award?.freelancerCents ?? 0) + (award?.clientCents ?? 0)).toBe(AMOUNT);
  });

  it('refuses a split that is really one of the full outcomes', () => {
    // A "split" of everything to one side would put the wrong word in the record
    // somebody later reads to understand what the mediator decided.
    expect(awardFor('split', AMOUNT, AMOUNT)).toBeNull();
    expect(awardFor('split', AMOUNT, 0)).toBeNull();
  });

  it('refuses a split outside the pot, in either direction', () => {
    expect(awardFor('split', AMOUNT, AMOUNT + 1)).toBeNull();
    expect(awardFor('split', AMOUNT, -1)).toBeNull();
    expect(awardFor('split', AMOUNT, null)).toBeNull();
    expect(awardFor('split', AMOUNT, Number.NaN)).toBeNull();
  });

  it('never awards more than the pot, for any outcome', () => {
    for (const outcome of DISPUTE_OUTCOMES) {
      const award = awardFor(outcome, AMOUNT, 12_345);
      if (!award) continue;
      expect(award.freelancerCents + award.clientCents).toBeLessThanOrEqual(AMOUNT);
      expect(award.freelancerCents).toBeGreaterThanOrEqual(0);
      expect(award.clientCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('statusAfterRuling', () => {
  it('lands each outcome on a status escrow already knows', () => {
    const landings: Record<DisputeOutcome, MilestoneStatus> = {
      release_full: 'released',
      split: 'released',
      refund_full: 'cancelled',
      restore: 'submitted',
    };
    for (const outcome of DISPUTE_OUTCOMES) {
      const next = statusAfterRuling(outcome, outcome === 'restore' ? 'submitted' : null);
      expect(next).toBe(landings[outcome]);
      // No new milestone state is invented — the CHECK constraint in 0924 is unchanged.
      expect(MILESTONE_STATUSES).toContain(next);
    }
  });

  it('returns a restore to the state captured when the dispute was raised', () => {
    expect(statusAfterRuling('restore', 'funded')).toBe('funded');
    expect(statusAfterRuling('restore', 'approved')).toBe('approved');
  });

  it('falls back to submitted rather than funded when the prior state was lost', () => {
    // Falling back to `funded` would silently discard a submission that had been made.
    expect(statusAfterRuling('restore', null)).toBe('submitted');
  });
});

describe('rulingLedgerLines — the same references escrow writes', () => {
  const MILESTONE = 'm-1';

  it('pays the freelancer under escrow\'s OWN release reference', () => {
    const lines = rulingLedgerLines(MILESTONE, { freelancerCents: AMOUNT, clientCents: 0 });
    expect(lines).toEqual([{
      reference: escrowLedgerReference(MILESTONE, 'release'),
      entryKind: 'payout',
      accountKind: 'user',
      amountCents: AMOUNT,
    }]);
  });

  it('refunds the client under escrow\'s OWN cancel reference', () => {
    const lines = rulingLedgerLines(MILESTONE, { freelancerCents: 0, clientCents: AMOUNT });
    expect(lines).toEqual([{
      reference: escrowLedgerReference(MILESTONE, 'cancel'),
      entryKind: 'refund',
      accountKind: 'tenant',
      amountCents: AMOUNT,
    }]);
  });

  it('writes both halves of a split, and they reconcile to the pot', () => {
    const lines = rulingLedgerLines(MILESTONE, { freelancerCents: 20_000, clientCents: 30_000 });
    expect(lines).toHaveLength(2);
    expect(lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(AMOUNT);
  });

  it('makes double payment structurally impossible, not merely unlikely', () => {
    // THE point of reusing escrow's references. A milestone released the ordinary way
    // and then ruled `release_full` produces the SAME reference, which the unique index
    // on (tenant, denomination, reference) refuses. A dispute-specific reference would
    // not have collided, and the freelancer would have been paid twice.
    const viaRuling = rulingLedgerLines(MILESTONE, { freelancerCents: AMOUNT, clientCents: 0 })[0];
    expect(viaRuling?.reference).toBe(escrowLedgerReference(MILESTONE, 'release'));
  });

  it('writes no row for a zero share', () => {
    // A ledger full of zero-value entries is a ledger nobody can reconcile.
    expect(rulingLedgerLines(MILESTONE, { freelancerCents: 0, clientCents: 0 })).toEqual([]);
  });
});

describe('mediatorAuthority — who may rule', () => {
  it('names a platform operator as the neutral mediator', () => {
    expect(mediatorAuthority('viewer', true)).toBe('platform');
    expect(mediatorAuthority(null, true)).toBe('platform');
  });

  it('falls back to the workspace owner, and says that is what happened', () => {
    // Recorded as `workspace` rather than collapsed into "mediator", because the client
    // IS the workspace: the freelancer must be able to see which kind of mediator ruled.
    expect(mediatorAuthority('owner', false)).toBe('workspace');
  });

  it('refuses everybody else', () => {
    for (const role of ['manager', 'developer', 'viewer', '', null, undefined]) {
      expect(mediatorAuthority(role, false)).toBe('none');
    }
  });
});

describe('normaliseEvidence — a jsonb column is not a type', () => {
  it('keeps well-formed entries and labels an unlabelled one with its url', () => {
    expect(normaliseEvidence([{ label: 'Screenshot', url: 'https://x/1.png' }, { url: 'https://x/2.png' }]))
      .toEqual([
        { label: 'Screenshot', url: 'https://x/1.png' },
        { label: 'https://x/2.png', url: 'https://x/2.png' },
      ]);
  });

  it('drops anything a surface would crash on', () => {
    expect(normaliseEvidence(null)).toEqual([]);
    expect(normaliseEvidence('not an array')).toEqual([]);
    expect(normaliseEvidence([null, 3, { label: 'no url' }, {}])).toEqual([]);
  });

  it('bounds the list so one filing cannot be an unbounded payload', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ url: `https://x/${i}` }));
    expect(normaliseEvidence(many)).toHaveLength(20);
  });
});

describe('the closed vocabularies', () => {
  it('accepts only the four outcomes', () => {
    for (const outcome of DISPUTE_OUTCOMES) expect(isDisputeOutcome(outcome)).toBe(true);
    for (const bad of ['release', 'partial', '', null, 7, {}]) expect(isDisputeOutcome(bad)).toBe(false);
  });

  it('accepts only the three filing parties', () => {
    for (const party of ['client', 'freelancer', 'mediator']) expect(isStatementParty(party)).toBe(true);
    for (const bad of ['admin', 'owner', '', null]) expect(isStatementParty(bad)).toBe(false);
  });
});
