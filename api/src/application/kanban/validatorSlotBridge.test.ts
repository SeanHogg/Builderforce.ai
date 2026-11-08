import { describe, expect, it } from 'vitest';
import {
  pickValidatorSlot, planValidatorBridge, reviewMarker, selectStaleReviews,
  type BridgeSlot, type BridgedReview,
} from './validatorSlotBridge';

const slot = (over: Partial<BridgeSlot> = {}): BridgeSlot => ({
  id: 'slot-1', stageKey: 'in_review', roleKey: 'validator', responsibility: 'reviewer',
  required: true, state: 'assigned', createdAt: new Date('2026-01-01'), ...over,
});

describe('pickValidatorSlot', () => {
  it('only ever picks the Validator slot - other roles are never bridged', () => {
    expect(pickValidatorSlot([slot({ id: 'dev', roleKey: 'developer' }), slot({ id: 'qa', roleKey: 'qa-tester' })])).toBeNull();
    expect(pickValidatorSlot([slot({ id: 'dev', roleKey: 'developer' }), slot()])?.id).toBe('slot-1');
  });

  it('leaves a waived or skipped Validator slot alone (a recorded decision)', () => {
    expect(pickValidatorSlot([slot({ state: 'waived' }), slot({ id: 's2', state: 'skipped' })])).toBeNull();
  });

  it('prefers a required reviewer slot, then the oldest', () => {
    const picked = pickValidatorSlot([
      slot({ id: 'optional', required: false }),
      slot({ id: 'newer', createdAt: new Date('2026-02-01') }),
      slot({ id: 'older' }),
    ]);
    expect(picked?.id).toBe('older');
  });
});

describe('planValidatorBridge', () => {
  it('links and records a sign-off for a complete verdict with a Validator slot', () => {
    expect(planValidatorBridge({ slots: [slot()], verdict: 'complete', alreadyBridged: false }))
      .toMatchObject({ recordSignoff: true, reason: 'bridge' });
  });

  it('is idempotent: a review that already has its marked sign-off records nothing more', () => {
    const plan = planValidatorBridge({ slots: [slot()], verdict: 'complete', alreadyBridged: true });
    expect(plan.recordSignoff).toBe(false);
    expect(plan.reason).toBe('already_bridged');
    expect(plan.slot?.id).toBe('slot-1'); // still linked
  });

  it('links but never approves a gaps verdict', () => {
    expect(planValidatorBridge({ slots: [slot()], verdict: 'gaps', alreadyBridged: false }))
      .toMatchObject({ recordSignoff: false, reason: 'verdict_not_complete' });
  });

  it('does nothing when the ticket has no Validator slot', () => {
    expect(planValidatorBridge({ slots: [slot({ roleKey: 'developer' })], verdict: 'complete', alreadyBridged: false }))
      .toEqual({ slot: null, recordSignoff: false, reason: 'no_validator_slot' });
  });

  it('marks the sign-off with the review id (the audit link and the idempotency key)', () => {
    expect(reviewMarker(42)).toBe('[task_review #42]');
  });
});

describe('selectStaleReviews (a newer PR head invalidates older acceptance)', () => {
  const review = (over: Partial<BridgedReview> = {}): BridgedReview => ({
    id: 1, taskId: 10, participantId: 'slot-1', reviewedHeadSha: 'aaa111', ...over,
  });

  it('flags a review made against an older head', () => {
    expect(selectStaleReviews([review()], new Map([[10, 'bbb222']])).map((r) => r.id)).toEqual([1]);
  });

  it('keeps acceptance valid when the head is unchanged', () => {
    expect(selectStaleReviews([review()], new Map([[10, 'aaa111']]))).toEqual([]);
  });

  it('judges only the LATEST review per slot (a re-review at the new head stands)', () => {
    const reviews = [review({ id: 1, reviewedHeadSha: 'aaa111' }), review({ id: 2, reviewedHeadSha: 'bbb222' })];
    expect(selectStaleReviews(reviews, new Map([[10, 'bbb222']]))).toEqual([]);
  });

  it('ignores tasks whose current head is unknown', () => {
    expect(selectStaleReviews([review()], new Map())).toEqual([]);
  });
});
